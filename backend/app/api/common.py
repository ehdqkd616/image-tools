import uuid
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import quote

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, aliased

from app.errors import AppError
from app.models import Asset, Job, User
from app.schemas.jobs import JobOut, JobUser


def content_disposition(filename: str, attachment: bool = True) -> str:
    """한글 파일명도 깨지지 않도록 RFC 5987 filename* 함께 지정"""
    kind = "attachment" if attachment else "inline"
    ascii_name = filename.encode("ascii", "ignore").decode().replace('"', "") or "download"
    if ascii_name.startswith("."):
        ascii_name = "download" + ascii_name
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"


def paginate(page: int, page_size: int) -> tuple[int, int]:
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    return page, page_size


def job_filters(
    stmt: Select,
    *,
    tool: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    include_deleted: bool = False,
) -> Select:
    if not include_deleted:
        stmt = stmt.where(Job.deleted_at.is_(None))
    if tool:
        stmt = stmt.where(Job.tool == tool)
    if status == "expired":
        out = aliased(Asset)
        stmt = stmt.join(out, out.id == Job.output_asset_id).where(out.purged_at.is_not(None))
    elif status:
        stmt = stmt.where(Job.status == status)
    if date_from:
        stmt = stmt.where(Job.created_at >= datetime.combine(date_from, time.min, timezone.utc))
    if date_to:
        stmt = stmt.where(Job.created_at < datetime.combine(date_to + timedelta(days=1), time.min, timezone.utc))
    if q:
        inp = aliased(Asset)
        stmt = stmt.join(inp, inp.id == Job.input_asset_id).where(inp.original_filename.ilike(f"%{q}%"))
    return stmt


def list_jobs(db: Session, stmt: Select, page: int, page_size: int, with_user: bool = False) -> dict:
    page, page_size = paginate(page, page_size)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    jobs = db.scalars(
        stmt.order_by(Job.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).unique().all()
    users = {}
    if with_user and jobs:
        users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({j.user_id for j in jobs})))}
    items = [job_out(j, users.get(j.user_id)) for j in jobs]
    return {"items": items, "total": total or 0, "page": page, "page_size": page_size}


def job_out(job: Job, user: User | None = None, **extra) -> JobOut:
    out = JobOut.model_validate(job)
    if user is not None:
        out.user = JobUser(id=user.id, email=user.email, name=user.name)
    for k, v in extra.items():
        setattr(out, k, v)
    return out


def get_owned_job(db: Session, job_id: uuid.UUID, user: User) -> Job:
    job = db.get(Job, job_id)
    # 다른 회원의 작업은 존재 여부도 알리지 않는다 (IDOR 방지)
    if job is None or job.deleted_at is not None or (job.user_id != user.id and not user.is_admin):
        raise AppError("NOT_FOUND", "작업을 찾을 수 없습니다.", 404)
    return job


def get_owned_asset(db: Session, asset_id: uuid.UUID, user: User) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None or (asset.user_id != user.id and not user.is_admin):
        raise AppError("NOT_FOUND", "파일을 찾을 수 없습니다.", 404)
    return asset
