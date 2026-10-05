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

def _fail_keys(email: str, ip: str | None) -> list[str]:
    keys = [f"loginfail:email:{email}"]
    if ip:
        keys.append(f"loginfail:ip:{ip}")
    return keys


def check_login_locked(email: str, ip: str | None) -> None:
    r = get_redis()
    for key in _fail_keys(email, ip):
        count = int(r.get(key) or 0)
        if count >= settings.login_max_failures:
            ttl = max(r.ttl(key), 1)
            minutes = (ttl + 59) // 60
            raise AppError(
                "RATE_LIMITED",
                f"로그인 시도가 너무 많습니다. 약 {minutes}분 후 다시 시도하세요.",
                429,
            )


def record_login_failure(email: str, ip: str | None) -> None:
    r = get_redis()
    for key in _fail_keys(email, ip):
        count = r.incr(key)
        if count == 1:
            r.expire(key, settings.login_lock_minutes * 60)


def clear_login_failures(email: str) -> None:
    get_redis().delete(f"loginfail:email:{email}")


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
