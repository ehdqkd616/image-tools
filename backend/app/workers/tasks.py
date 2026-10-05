"""RQ 작업 함수"""

import logging
import time
import uuid

from sqlalchemy import update

from app.db import SessionLocal, utcnow
from app.errors import AppError
from app.models import Batch, Job
from app.schemas.jobs import CompressParams, ResizeParams, UpscaleParams
from app.services import image_io
from app.services.assets import result_filename, store_result
from app.services.compress import run_compress
from app.services.resize import ProcessResult, run_resize
from app.services.storage import get_storage
from app.services.upscale import get_engine

log = logging.getLogger(__name__)


class _Progress:
    """진행률을 DB에 너무 자주 쓰지 않도록 묶어서 갱신"""

    def __init__(self, job_id: uuid.UUID):
        self.job_id = job_id
        self.last_value = 0
        self.last_time = 0.0

    def __call__(self, value: int) -> None:
        value = max(0, min(99, int(value)))
        now = time.monotonic()
        if value - self.last_value < 3 and now - self.last_time < 1.0:
            return
        self.last_value, self.last_time = value, now
        with SessionLocal() as db:
            db.execute(update(Job).where(Job.id == self.job_id).values(progress=value))
            db.commit()


def _run_upscale(src: image_io.Loaded, params: UpscaleParams, progress) -> ProcessResult:
    out = get_engine().upscale(src.image, params, progress)
    progress(92)
    data = image_io.encode(out, params.format, quality=90, icc_profile=src.icc_profile)
    return ProcessResult(data=data, format=params.format, width=out.width, height=out.height,
                         meta={"engine": get_engine().name})


def _bump_batch(db, batch_id, field: str) -> None:
    if batch_id:
        db.execute(update(Batch).where(Batch.id == batch_id).values({field: getattr(Batch, field) + 1}))


def process_job(job_id: str) -> None:
    jid = uuid.UUID(job_id)
    with SessionLocal() as db:
        # queued → processing 을 원자적으로 (취소된 작업은 건너뜀)
        claimed = db.execute(
            update(Job)
            .where(Job.id == jid, Job.status == "queued", Job.deleted_at.is_(None))
            .values(status="processing", started_at=utcnow(), progress=1, error_message=None)
            .returning(Job.id)
        ).first()
        db.commit()
        if not claimed:
            log.info("job %s skipped (not queued)", job_id)
            return
        job = db.get(Job, jid)
        try:
            progress = _Progress(jid)
            original = get_storage().get_bytes(job.input_asset.storage_key)
            src = image_io.load(original)
            progress(5)
            if job.tool == "resize":
                res = run_resize(src, ResizeParams.model_validate(job.params))
            elif job.tool == "compress":
                res = run_compress(src, CompressParams.model_validate(job.params), original)
            elif job.tool == "upscale":
                res = _run_upscale(src, UpscaleParams.model_validate(job.params), progress)
            else:
                raise ValueError(f"unknown tool {job.tool}")
            progress(95)
            result_img = image_io.load(res.data).image
            name = result_filename(job.input_asset.original_filename, job.tool, job.params,
                                   res.format, res.width, res.height)
            asset = store_result(db, job.user_id, res.data, res.format, result_img, name)
            db.flush()
            job.output_asset_id = asset.id
            job.status = "done"
            job.progress = 100
            job.result = res.meta
            job.finished_at = utcnow()
            _bump_batch(db, job.batch_id, "done")
            db.commit()
        except Exception as e:
            db.rollback()
            log.exception("job %s failed", job_id)
            _mark_failed(jid, e)


def _mark_failed(jid: uuid.UUID, e: BaseException | str) -> None:
    if isinstance(e, AppError):
        message = e.message
    elif isinstance(e, str):
        message = e
    elif isinstance(e, MemoryError) or "out of memory" in str(e).lower():
        message = "메모리가 부족해 처리하지 못했습니다. 더 작은 이미지로 다시 시도해 주세요."
    else:
        message = f"처리 중 오류가 발생했습니다. ({type(e).__name__}: {str(e)[:300]})"
    with SessionLocal() as db:
        row = db.execute(
            update(Job)
            .where(Job.id == jid, Job.status.in_(("queued", "processing")))
            .values(status="failed", error_message=message, finished_at=utcnow())
            .returning(Job.batch_id)
        ).first()
        if row:
            _bump_batch(db, row[0], "failed")
        db.commit()


def on_rq_failure(job, connection, type, value, traceback):  # noqa: A002 - RQ 콜백 시그니처
    """RQ가 작업을 강제 종료(시간 초과 등)했을 때 상태를 실패로 돌린다."""
    try:
        jid = uuid.UUID(job.args[0])
    except (IndexError, ValueError):
        return
    reason = "처리 시간이 초과되었습니다." if type is not None and "Timeout" in type.__name__ else str(value)
    _mark_failed(jid, reason or "작업이 비정상 종료되었습니다.")
