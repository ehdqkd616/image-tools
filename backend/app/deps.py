from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import AppError
from app.models import User
from app.services.auth_service import STATUS_ERRORS, delete_session, resolve_session

SESSION_COOKIE = "is_session"

DB = Annotated[Session, Depends(get_db)]


def client_ip(request: Request) -> str | None:
    # uvicorn --proxy-headers 로 nginx의 X-Forwarded-For가 반영된다
    return request.client.host if request.client else None


def get_current_user(request: Request, db: DB) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise AppError("UNAUTHORIZED", "로그인이 필요합니다.", 401)
    resolved = resolve_session(db, token)
    if resolved is None:
        raise AppError("UNAUTHORIZED", "로그인이 만료되었습니다. 다시 로그인하세요.", 401)
    _, user = resolved
    if user.status != "approved":
        # 정지 등으로 상태가 바뀌면 기존 세션도 즉시 무효
        delete_session(db, token)
        db.commit()
        code, message = STATUS_ERRORS.get(user.status, ("UNAUTHORIZED", "로그인이 필요합니다."))
        raise AppError(code, message, 401)
    request.state.user = user
    return user


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_admin:
        raise AppError("FORBIDDEN", "관리자만 접근할 수 있습니다.", 403)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
