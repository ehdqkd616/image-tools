import secrets
import string
import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.common import job_filters, list_jobs, paginate
from app.api.jobs import job_detail
from app.db import utcnow
from app.deps import DB, AdminUser, client_ip
from app.errors import AppError
from app.models import USER_STATUSES, AuditLog, Job, User
from app.redis_conn import get_redis
from app.schemas.auth import UserOut
from app.services import auth_service
from app.services.audit import audit

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminUserOut(UserOut):
    signup_note: str | None
    reject_reason: str | None
    approved_at: datetime | None = None
    job_count: int = 0


def _user_out(user: User, job_count: int = 0) -> AdminUserOut:
    out = AdminUserOut.model_validate(user)
    out.job_count = job_count
    return out


# --- 대시보드 -------------------------------------------------------------------

@router.get("/stats")
def stats(admin: AdminUser, db: DB):
    now = utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = now - timedelta(days=7)
    count = lambda *conds: db.scalar(select(func.count()).select_from(Job).where(*conds)) or 0  # noqa: E731
    by_tool = dict(db.execute(select(Job.tool, func.count()).where(Job.created_at >= now - timedelta(days=30))
                              .group_by(Job.tool)).all())
    finished_week = count(Job.created_at >= week, Job.status.in_(("done", "failed")))
    failed_week = count(Job.created_at >= week, Job.status == "failed")
    users_by_status = dict(db.execute(select(User.status, func.count()).group_by(User.status)).all())
    try:
        from rq import Queue

        r = get_redis()
        queue_lengths = {name: len(Queue(name, connection=r)) for name in ("fast", "upscale")}
    except Exception:
        queue_lengths = {}
    return {
        "pending_users": users_by_status.get("pending", 0),
        "users_by_status": users_by_status,
        "jobs_today": count(Job.created_at >= today),
        "jobs_week": count(Job.created_at >= week),
        "jobs_by_tool_30d": by_tool,
        "failure_rate_week": (failed_week / finished_week) if finished_week else 0,
        "queued_jobs": count(Job.status == "queued"),
        "processing_jobs": count(Job.status == "processing"),
        "queue_lengths": queue_lengths,
        "storage_used_bytes": db.scalar(select(func.coalesce(func.sum(User.storage_used_bytes), 0))),
    }


# --- 회원 관리 ------------------------------------------------------------------

@router.get("/users")
def list_users(admin: AdminUser, db: DB, status: str | None = None, q: str | None = None,
               page: int = 1, page_size: int = 20):
    page, page_size = paginate(page, page_size)
    stmt = select(User)
    if status:
        stmt = stmt.where(User.status == status)
    if q:
        stmt = stmt.where(or_(User.email.ilike(f"%{q}%"), User.name.ilike(f"%{q}%")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = db.scalars(stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    counts = dict(db.execute(
        select(Job.user_id, func.count()).where(Job.user_id.in_([u.id for u in users]), Job.deleted_at.is_(None))
        .group_by(Job.user_id)
    ).all()) if users else {}
    return {"items": [_user_out(u, counts.get(u.id, 0)) for u in users], "total": total,
            "page": page, "page_size": page_size}


def _get_user(db, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("NOT_FOUND", "회원을 찾을 수 없습니다.", 404)
    return user


@router.get("/users/{user_id}")
def get_user(user_id: uuid.UUID, admin: AdminUser, db: DB):
    user = _get_user(db, user_id)
    job_count = db.scalar(select(func.count()).select_from(Job)
                          .where(Job.user_id == user.id, Job.deleted_at.is_(None))) or 0
    history = db.execute(
        select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.target_type == "user", AuditLog.target_id == str(user.id),
               AuditLog.action.like("admin.user.%") | (AuditLog.action == "user.signup"))
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    ).all()
    return {
        "user": _user_out(user, job_count),
        "history": [_log_out(log, email) for log, email in history],
    }


class RejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class BulkIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class QuotaIn(BaseModel):
    quota_mb: int = Field(ge=0, le=10_000_000)


def _change_status(db, admin: User, user: User, new_status: str, ip: str | None,
                   reason: str | None = None) -> None:
    if user.id == admin.id:
        raise AppError("INVALID_STATE", "자기 자신의 상태는 바꿀 수 없습니다.", 409)
    if user.is_admin and new_status != "approved":
        raise AppError("INVALID_STATE", "관리자 계정은 거절·정지할 수 없습니다.", 409)
    old = user.status
    user.status = new_status
    if new_status == "approved":
        user.approved_by, user.approved_at = admin.id, utcnow()
        user.reject_reason = None
    if new_status == "rejected":
        user.reject_reason = reason
    if new_status in ("rejected", "suspended"):
        auth_service.revoke_user_sessions(db, user.id)
    audit(db, f"admin.user.{_ACTION[new_status, old]}", actor_id=admin.id, target_type="user",
          target_id=user.id, detail={"from": old, "to": new_status, **({"reason": reason} if reason else {})},
          ip=ip)


_ACTION = {
    **{("approved", s): "approve" for s in USER_STATUSES},
    ("approved", "suspended"): "unsuspend",
    **{("rejected", s): "reject" for s in USER_STATUSES},
    **{("suspended", s): "suspend" for s in USER_STATUSES},
}


@router.post("/users/{user_id}/approve")
def approve(user_id: uuid.UUID, request: Request, admin: AdminUser, db: DB):
    user = _get_user(db, user_id)
    if user.status not in ("pending", "rejected"):
        raise AppError("INVALID_STATE", "대기 또는 거절 상태의 회원만 승인할 수 있습니다.", 409)
    _change_status(db, admin, user, "approved", client_ip(request))
    db.commit()
    return _user_out(user)


@router.post("/users/{user_id}/reject")
def reject(user_id: uuid.UUID, body: RejectIn, request: Request, admin: AdminUser, db: DB):
    user = _get_user(db, user_id)
    if user.status != "pending":
        raise AppError("INVALID_STATE", "승인 대기 중인 회원만 거절할 수 있습니다.", 409)
    _change_status(db, admin, user, "rejected", client_ip(request), (body.reason or "").strip() or None)
    db.commit()
    return _user_out(user)


@router.post("/users/{user_id}/suspend")
def suspend(user_id: uuid.UUID, request: Request, admin: AdminUser, db: DB):
    user = _get_user(db, user_id)
    if user.status != "approved":
        raise AppError("INVALID_STATE", "승인된 회원만 정지할 수 있습니다.", 409)
    _change_status(db, admin, user, "suspended", client_ip(request))
    db.commit()
    return _user_out(user)


@router.post("/users/{user_id}/unsuspend")
def unsuspend(user_id: uuid.UUID, request: Request, admin: AdminUser, db: DB):
    user = _get_user(db, user_id)
    if user.status != "suspended":
        raise AppError("INVALID_STATE", "정지된 회원만 해제할 수 있습니다.", 409)
    _change_status(db, admin, user, "approved", client_ip(request))
    db.commit()
    return _user_out(user)


@router.post("/users/bulk-approve")
def bulk_approve(body: BulkIn, request: Request, admin: AdminUser, db: DB):
    users = db.scalars(select(User).where(User.id.in_(body.user_ids), User.status == "pending")).all()
    for user in users:
        _change_status(db, admin, user, "approved", client_ip(request))
    db.commit()
    return {"approved": len(users)}


@router.patch("/users/{user_id}/quota")
def set_quota(user_id: uuid.UUID, body: QuotaIn, request: Request, admin: AdminUser, db: DB):
    user = _get_user(db, user_id)
    old = user.storage_quota_bytes
    user.storage_quota_bytes = body.quota_mb * 1024 * 1024
    audit(db, "admin.user.quota", actor_id=admin.id, target_type="user", target_id=user.id,
          detail={"from": old, "to": user.storage_quota_bytes}, ip=client_ip(request))
    db.commit()
    return _user_out(user)


@router.post("/users/{user_id}/temp-password")
def temp_password(user_id: uuid.UUID, request: Request, admin: AdminUser, db: DB):
    """[선택] 임시 비밀번호 발급. 응답으로 한 번만 보여준다."""
    user = _get_user(db, user_id)
    if user.id == admin.id:
        raise AppError("INVALID_STATE", "본인 비밀번호는 내 정보에서 변경하세요.", 409)
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(12))
        if any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw):
            break
    user.password_hash = auth_service.hash_password(pw)
    auth_service.revoke_user_sessions(db, user.id)
    audit(db, "admin.user.temp_password", actor_id=admin.id, target_type="user", target_id=user.id,
          ip=client_ip(request))
    db.commit()
    return {"temp_password": pw}


# --- 작업 조회 ------------------------------------------------------------------

@router.get("/users/{user_id}/jobs")
def user_jobs(user_id: uuid.UUID, admin: AdminUser, db: DB, tool: str | None = None,
              status: str | None = None, date_from: date | None = None, date_to: date | None = None,
              q: str | None = None, page: int = 1, page_size: int = 20):
    _get_user(db, user_id)
    stmt = job_filters(select(Job).where(Job.user_id == user_id), tool=tool, status=status,
                       date_from=date_from, date_to=date_to, q=q, include_deleted=True)
    return list_jobs(db, stmt, page, page_size)


@router.get("/jobs")
def all_jobs(admin: AdminUser, db: DB, user: str | None = None, tool: str | None = None,
             status: str | None = None, date_from: date | None = None, date_to: date | None = None,
             q: str | None = None, page: int = 1, page_size: int = 20):
    stmt = select(Job)
    if user:
        stmt = stmt.join(User, User.id == Job.user_id).where(
            or_(User.email.ilike(f"%{user}%"), User.name.ilike(f"%{user}%"))
        )
    stmt = job_filters(stmt, tool=tool, status=status, date_from=date_from, date_to=date_to, q=q,
                       include_deleted=True)
    return list_jobs(db, stmt, page, page_size, with_user=True)


@router.get("/jobs/{job_id}")
def admin_job(job_id: uuid.UUID, admin: AdminUser, db: DB):
    job = db.get(Job, job_id)
    if job is None:
        raise AppError("NOT_FOUND", "작업을 찾을 수 없습니다.", 404)
    return job_detail(db, job, admin)


# --- 감사 로그 ------------------------------------------------------------------

def _log_out(log: AuditLog, actor_email: str | None) -> dict:
    return {
        "id": log.id,
        "actor_id": log.actor_id,
        "actor_email": actor_email,
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "detail": log.detail,
        "ip": log.ip,
        "created_at": log.created_at,
    }


@router.get("/audit-logs")
def audit_logs(admin: AdminUser, db: DB, action: str | None = None, actor: str | None = None,
               target_id: str | None = None, date_from: date | None = None, date_to: date | None = None,
               page: int = 1, page_size: int = 50):
    page, page_size = paginate(page, page_size)
    stmt = select(AuditLog, User.email).outerjoin(User, User.id == AuditLog.actor_id)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if actor:
        stmt = stmt.where(User.email.ilike(f"%{actor}%"))
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min, timezone.utc))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min,
                                                                 timezone.utc))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_log_out(log, email) for log, email in rows], "total": total, "page": page,
            "page_size": page_size}
