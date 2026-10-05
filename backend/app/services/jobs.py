"""작업 생성·큐 등록"""

import logging
import uuid

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models import Asset, Batch, Job, User
from app.schemas.jobs import PARAM_MODELS, UpscaleParams
from app.services.assets import ensure_quota

log = logging.getLogger(__name__)

QUEUE_FOR_TOOL = {"upscale": "upscale", "resize": "fast", "compress": "fast"}
TIMEOUT_FOR_QUEUE = {"upscale": 30 * 60, "fast": 5 * 60}


def validate_params(tool: str, params: dict) -> dict:
    try:
        model = PARAM_MODELS[tool].model_validate(params)
    except ValidationError as e:
        msg = e.errors()[0].get("msg", "옵션을 확인해 주세요.").removeprefix("Value error, ")
        raise AppError("VALIDATION_ERROR", msg, 422)
    if tool == "upscale" and model.face:
        raise AppError("VALIDATION_ERROR", "얼굴 보정은 아직 지원하지 않습니다.", 422)
    return model.model_dump()


def check_upscale_input(asset: Asset, params: dict) -> None:
    p = UpscaleParams.model_validate(params)
    pixels = (asset.width or 0) * (asset.height or 0)
    limit = settings.upscale_max_input_pixels_2x if p.scale == 2 else settings.upscale_max_input_pixels_4x
    max_side = max(asset.width or 0, asset.height or 0) * p.scale
    if pixels > limit or max_side > settings.upscale_max_output_side:
        raise AppError(
            "IMAGE_TOO_LARGE_FOR_UPSCALE",
            f"{asset.original_filename}: {p.scale}배 확대는 약 {limit / 1_000_000:g}MP"
            f"(결과 긴 변 {settings.upscale_max_output_side}px) 이하 이미지만 가능합니다. 먼저 크기를 줄여 주세요.",
            422,
            asset_id=str(asset.id),
        )


def create_jobs(
    db: Session,
    user: User,
    tool: str,
    params: dict,
    asset_ids: list[uuid.UUID],
    parent_job_id: uuid.UUID | None = None,
) -> tuple[Batch | None, list[Job]]:
    params = validate_params(tool, params)
    if len(asset_ids) > settings.max_files_per_request:
        raise AppError("TOO_MANY_FILES", f"한 번에 최대 {settings.max_files_per_request}장까지 처리할 수 있습니다.")
    ensure_quota(user)

    ids = list(dict.fromkeys(asset_ids))
    assets = {
        a.id: a
        for a in db.scalars(select(Asset).where(Asset.id.in_(ids), Asset.user_id == user.id))
    }
    for aid in ids:
        asset = assets.get(aid)
        if asset is None:
            raise AppError("NOT_FOUND", "이미지를 찾을 수 없습니다.", 404)
        if not asset.file_available:
            raise AppError("FILE_EXPIRED", f"{asset.original_filename}: 파일이 만료되었거나 삭제되었습니다.", 410)
        if tool == "upscale":
            check_upscale_input(asset, params)

    if parent_job_id is not None:
        parent = db.get(Job, parent_job_id)
        if parent is None or parent.user_id != user.id:
            raise AppError("NOT_FOUND", "이전 작업을 찾을 수 없습니다.", 404)

    # 결과 에셋을 입력으로 쓰면 그 결과를 만든 작업을 부모로 자동 연결
    producers = dict(
        db.execute(
            select(Job.output_asset_id, Job.id).where(Job.output_asset_id.in_(ids), Job.user_id == user.id)
        ).all()
    )

    batch = None
    if len(ids) > 1:
        batch = Batch(user_id=user.id, tool=tool, params=params, total=len(ids))
        db.add(batch)
        db.flush()

    jobs = []
    for aid in ids:
        job = Job(
            user_id=user.id,
            batch_id=batch.id if batch else None,
            parent_job_id=producers.get(aid, parent_job_id),
            tool=tool,
            params=params,
            input_asset_id=aid,
            status="queued",
            progress=0,
        )
        db.add(job)
        jobs.append(job)
    db.commit()
    for job in jobs:
        enqueue(job)
    return batch, jobs


def enqueue(job: Job) -> None:
    if settings.queue_sync:
        from app.workers.tasks import process_job

        process_job(str(job.id))
        return
    from rq import Callback, Queue

    from app.redis_conn import get_redis

    qname = QUEUE_FOR_TOOL[job.tool]
    Queue(qname, connection=get_redis()).enqueue(
        "app.workers.tasks.process_job",
        str(job.id),
        job_timeout=TIMEOUT_FOR_QUEUE[qname],
        result_ttl=3600,
        failure_ttl=24 * 3600,
        on_failure=Callback("app.workers.tasks.on_rq_failure"),
    )


def queue_position(db: Session, job: Job) -> int | None:
    """대기 순번 (1부터). 같은 큐에서 먼저 들어온 대기 작업 수 + 1"""
    if job.status != "queued":
        return None
    tools = [t for t, q in QUEUE_FOR_TOOL.items() if q == QUEUE_FOR_TOOL[job.tool]]
    ahead = db.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.status.in_(("queued", "processing")), Job.tool.in_(tools), Job.created_at < job.created_at)
    )
    return (ahead or 0) + 1
