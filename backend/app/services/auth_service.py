import hashlib
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.errors import AppError
from app.models import User, UserSession
from app.redis_conn import get_redis

_hasher = PasswordHasher()  # argon2id 기본값

# 비밀번호가 틀렸을 때도 해시 검증 시간을 맞추기 위한 더미 해시
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")

STATUS_ERRORS = {
    "pending": ("ACCOUNT_PENDING", "관리자 승인 대기 중입니다. 승인 후 이용할 수 있습니다."),
    "rejected": ("ACCOUNT_REJECTED", "가입이 거절되었습니다."),
    "suspended": ("ACCOUNT_SUSPENDED", "이용이 정지된 계정입니다. 관리자에게 문의하세요."),
}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- 로그인 시도 제한 ---------------------------------------------------------

def _fail_keys(username: str, ip: str | None) -> list[str]:
    keys = [f"loginfail:user:{username}"]
    if ip:
        keys.append(f"loginfail:ip:{ip}")
    return keys


def check_login_locked(username: str, ip: str | None) -> None:
    r = get_redis()
    for key in _fail_keys(username, ip):
        count = int(r.get(key) or 0)
        if count >= settings.login_max_failures:
            ttl = max(r.ttl(key), 1)
            minutes = (ttl + 59) // 60
            raise AppError(
                "RATE_LIMITED",
                f"로그인 시도가 너무 많습니다. 약 {minutes}분 후 다시 시도하세요.",
                429,
            )


def record_login_failure(username: str, ip: str | None) -> None:
    r = get_redis()
    for key in _fail_keys(username, ip):
        count = r.incr(key)
        if count == 1:
            r.expire(key, settings.login_lock_minutes * 60)


def clear_login_failures(username: str) -> None:
    get_redis().delete(f"loginfail:user:{username}")


# --- .env 관리자 계정 ------------------------------------------------------------

ADMIN_USERNAME = "admin"  # 모든 프로젝트 공통 관리자 아이디


def is_managed_admin(user: User) -> bool:
    """비밀번호를 .env의 ADMIN_PASSWORD로 관리하는 공통 관리자 계정(admin)인지"""
    return user.username == ADMIN_USERNAME


def ensure_admin(db: Session) -> str | None:
    """기동할 때마다 .env의 ADMIN_PASSWORD로 공통 관리자 계정 admin을 맞춘다.
    없으면 만들고, 있으면 관리자·승인 상태와 비밀번호를 .env 값으로 되돌린다 — 비밀번호는 .env가 기준."""
    username, password = ADMIN_USERNAME, settings.admin_password
    if not password:
        return None
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        db.add(User(username=username, name="관리자", password_hash=hash_password(password),
                    role="admin", status="approved", approved_at=utcnow()))
        db.commit()
        return "created"
    same_password = verify_password(user.password_hash, password)
    if same_password and user.role == "admin" and user.status == "approved":
        return None
    user.role, user.status = "admin", "approved"
    user.approved_at = user.approved_at or utcnow()
    if not same_password:
        user.password_hash = hash_password(password)
        revoke_user_sessions(db, user.id)  # 예전 비밀번호로 만든 세션 종료
    db.commit()
    return "synced"


# --- 세션 ---------------------------------------------------------------------

def create_session(db: Session, user: User, user_agent: str | None, ip: str | None) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=_token_hash(token),
            user_agent=(user_agent or "")[:500],
            ip=ip,
            expires_at=utcnow() + timedelta(days=settings.session_days),
        )
    )
    return token


def resolve_session(db: Session, token: str) -> tuple[UserSession, User] | None:
    row = db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == _token_hash(token))
    ).first()
    if row is None:
        return None
    sess, user = row
    if sess.expires_at <= utcnow():
        db.delete(sess)
        db.commit()
        return None
    return sess, user


def delete_session(db: Session, token: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))


def revoke_user_sessions(db: Session, user_id, except_token: str | None = None) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if except_token:
        stmt = stmt.where(UserSession.token_hash != _token_hash(except_token))
    db.execute(stmt)
