import json
import tempfile
import uuid
import zipfile
from datetime import date
from pathlib import Path, PurePath

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from app.api.common import content_disposition, get_owned_job, job_filters, job_out, list_jobs
from app.config import settings
from app.db import utcnow
from app.deps import DB, CurrentUser, client_ip
from app.errors import AppError
from app.models import Batch, Job, User
from app.redis_conn import rate_limit
from app.schemas.jobs import JobCreateIn, JobCreateOut, JobDetailOut, JobOut, JobUser
from app.services import jobs as job_service
from app.services.assets import asset_in_use, ensure_quota, soft_delete_asset
from app.services.audit import audit
from app.services.storage import get_storage

router = APIRouter(tags=["jobs"])

PRESETS_FILE = Path(__file__).resolve().parent.parent / "presets.json"


@router.post("/jobs", response_model=JobCreateOut, status_code=201)
def create_jobs(body: JobCreateIn, user: CurrentUser, db: DB):
    rate_limit("jobs", str(user.id), limit=60, window_seconds=60)
    batch, jobs = job_service.create_jobs(db, user, body.tool, body.params, body.asset_ids, body.parent_job_id)
    return {"batch": batch, "jobs": [job_out(j) for j in jobs]}


@router.get("/jobs")
def my_jobs(
    user: CurrentUser,
    db: DB,
    tool: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    stmt = job_filters(select(Job).where(Job.user_id == user.id), tool=tool, status=status,
                       date_from=date_from, date_to=date_to, q=q)
    return list_jobs(db, stmt, page, page_size)


def job_detail(db, job: Job, viewer: User) -> JobDetailOut:
    detail = JobDetailOut.model_validate(job)
    detail.queue_position = job_service.queue_position(db, job)
    if job.parent_job_id:
        parent = db.get(Job, job.parent_job_id)
        if parent and parent.deleted_at is None:
            detail.parent = JobOut.model_validate(parent)
    children = db.scalars(
        select(Job).where(Job.parent_job_id == job.id, Job.deleted_at.is_(None)).order_by(Job.created_at)
    ).unique().all()
    detail.children = [JobOut.model_validate(c) for c in children]
    if viewer.is_admin and job.user_id != viewer.id:
        owner = db.get(User, job.user_id)
        if owner:
            detail.user = JobUser(id=owner.id, email=owner.email, name=owner.name)
    return detail


@router.get("/jobs/{job_id}", response_model=JobDetailOut)
def get_job(job_id: uuid.UUID, user: CurrentUser, db: DB):
    return job_detail(db, get_owned_job(db, job_id, user), user)


@router.post("/jobs/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: uuid.UUID, user: CurrentUser, db: DB):
    job = get_owned_job(db, job_id, user)
    if job.user_id != user.id:
        raise AppError("FORBIDDEN", "본인 작업만 재시도할 수 있습니다.", 403)
    if job.status not in ("failed", "canceled"):
        raise AppError("INVALID_STATE", "실패하거나 취소된 작업만 재시도할 수 있습니다.", 409)
    if not job.input_asset.file_available:
        raise AppError("FILE_EXPIRED", "원본 파일이 만료되어 재시도할 수 없습니다.", 410)
    ensure_quota(user)
    if job.tool == "upscale":
        job_service.check_upscale_input(job.input_asset, job.params)
    was_failed = job.status == "failed"
    job.status, job.progress, job.error_message = "queued", 0, None
    job.started_at = job.finished_at = None
    job.created_at = utcnow()  # 대기 순번 계산용
    if was_failed and job.batch_id:
        db.execute(update(Batch).where(Batch.id == job.batch_id, Batch.failed > 0)
                   .values(failed=Batch.failed - 1))
    db.commit()
    job_service.enqueue(job)
    db.refresh(job)
    return job_out(job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: uuid.UUID, user: CurrentUser, db: DB):
    job = get_owned_job(db, job_id, user)
    if job.user_id != user.id:
        raise AppError("FORBIDDEN", "본인 작업만 취소할 수 있습니다.", 403)
    if job.status != "queued":
        raise AppError("INVALID_STATE", "대기 중인 작업만 취소할 수 있습니다.", 409)
    # 워커는 queued 상태인 작업만 가져가므로 상태만 바꾸면 된다
    job.status, job.finished_at = "canceled", utcnow()
    db.commit()
    return job_out(job)


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: uuid.UUID, user: CurrentUser, db: DB):
    job = get_owned_job(db, job_id, user)
    if job.user_id != user.id:
        raise AppError("FORBIDDEN", "본인 작업만 삭제할 수 있습니다.", 403)
    if job.status == "processing":
        raise AppError("INVALID_STATE", "처리 중인 작업은 삭제할 수 없습니다.", 409)
    if job.status == "queued":
        job.status = "canceled"
    job.deleted_at = utcnow()
    db.flush()
    for asset in (job.output_asset, job.input_asset):
        if asset is not None and not asset_in_use(db, asset.id, exclude_job_id=job.id):
            soft_delete_asset(db, asset)
    db.commit()


class ZipIn(BaseModel):
    job_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    include_original: bool = False


def _unique_name(name: str, used: set[str]) -> str:
    path = PurePath(name)
    candidate, n = name, 1
    while candidate in used:
        n += 1
        candidate = str(path.with_name(f"{path.stem} ({n}){path.suffix}"))
    used.add(candidate)
    return candidate


@router.post("/downloads/zip")
def download_zip(body: ZipIn, request: Request, user: CurrentUser, db: DB):
    rate_limit("zip", str(user.id), limit=20, window_seconds=60)
    jobs = [get_owned_job(db, jid, user) for jid in dict.fromkeys(body.job_ids)]
    storage = get_storage()
    files = []
    for job in jobs:
        if job.output_asset and job.output_asset.file_available:
            files.append(job.output_asset)
        if body.include_original and job.input_asset.file_available:
            files.append(job.input_asset)
    if not files:
        raise AppError("NOT_FOUND", "다운로드할 수 있는 결과 파일이 없습니다.", 404)

    tmp = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024)
    used: set[str] = set()
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as zf:  # 이미지는 이미 압축되어 있으므로 STORED
        for asset in dict.fromkeys(files):
            folder = "original/" if asset.kind == "original" and body.include_original else ""
            name = _unique_name(folder + (asset.original_filename or f"{asset.id}.{asset.format}"), used)
            zf.writestr(name, storage.get_bytes(asset.storage_key))
    if any(j.user_id != user.id for j in jobs):
        audit(db, "admin.file.download", actor_id=user.id, target_type="zip",
              detail={"job_ids": [str(j.id) for j in jobs]}, ip=client_ip(request))
        db.commit()
    size = tmp.tell()
    tmp.seek(0)

    def _iter():
        try:
            while chunk := tmp.read(256 * 1024):
                yield chunk
        finally:
            tmp.close()

    filename = f"image-studio_{utcnow():%Y%m%d_%H%M%S}.zip"
    return StreamingResponse(_iter(), media_type="application/zip", headers={
        "Content-Disposition": content_disposition(filename),
        "Content-Length": str(size),
    })


@router.get("/me/storage")
def my_storage(user: CurrentUser):
    return {"used_bytes": user.storage_used_bytes, "quota_bytes": user.storage_quota_bytes}


@router.get("/presets/resize")
def resize_presets(user: CurrentUser):
    return json.loads(PRESETS_FILE.read_text(encoding="utf-8"))


@router.get("/limits")
def limits(user: CurrentUser):
    return {
        "max_upload_mb": settings.max_upload_mb,
        "max_files_per_request": settings.max_files_per_request,
        "upscale_max_input_pixels_2x": settings.upscale_max_input_pixels_2x,
        "upscale_max_input_pixels_4x": settings.upscale_max_input_pixels_4x,
        "upscale_max_output_side": settings.upscale_max_output_side,
        "file_retention_days": settings.file_retention_days,
    }
