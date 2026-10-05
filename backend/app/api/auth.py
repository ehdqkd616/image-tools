from fastapi import APIRouter, BackgroundTasks, Request, Response
from sqlalchemy import func, select

from app.config import settings
from app.db import utcnow
from app.deps import DB, SESSION_COOKIE, CurrentUser, client_ip
from app.errors import AppError
from app.models import User
from app.redis_conn import rate_limit
from app.schemas.auth import LoginIn, PasswordChangeIn, SignupIn, UserOut
from app.services import auth_service as auth
from app.services.audit import audit
from app.services.notify import send_signup_notification

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


@router.post("/signup", status_code=201)
def signup(body: SignupIn, request: Request, db: DB, background_tasks: BackgroundTasks):
    ip = client_ip(request)
    rate_limit("signup", ip or "-", limit=10, window_seconds=3600)
    if not (body.agree_terms and body.agree_privacy):
        raise AppError("VALIDATION_ERROR", "이용약관과 개인정보 처리방침에 동의해 주세요.", 422)
    email = body.email.lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise AppError("EMAIL_TAKEN", "이미 가입된 이메일입니다.", 409)
    user = User(
        email=email,
        password_hash=auth.hash_password(body.password),
        name=body.name,
        signup_note=(body.signup_note or "").strip() or None,
        role="user",
        status="pending",
    )
    db.add(user)
    db.flush()
    audit(db, "user.signup", actor_id=user.id, target_type="user", target_id=user.id, ip=ip)
    db.commit()
    # 응답을 보낸 뒤 발송 — SMTP가 느리거나 실패해도 가입은 그대로 성공한다.
    background_tasks.add_task(
        send_signup_notification, str(user.id), user.email, user.name, user.signup_note, user.created_at
    )
    return {"status": "pending", "message": "가입 신청이 완료되었습니다. 관리자 승인 후 이용할 수 있습니다."}


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: DB):
    ip = client_ip(request)
    email = body.email.lower()
    rate_limit("login", ip or "-", limit=30, window_seconds=60)
    auth.check_login_locked(email, ip)

    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not auth.verify_password(user.password_hash if user else None, body.password):
        auth.record_login_failure(email, ip)
        audit(db, "login.failure", actor_id=user.id if user else None, target_type="user",
              target_id=user.id if user else None, detail={"email": email}, ip=ip)
        db.commit()
        raise AppError("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.", 401)

    auth.clear_login_failures(email)
    # 비밀번호가 맞을 때만 계정 상태를 알려준다
    if user.status != "approved":
        code, message = auth.STATUS_ERRORS[user.status]
        extra = {"reason": user.reject_reason} if user.status == "rejected" and user.reject_reason else {}
        audit(db, "login.blocked", actor_id=user.id, target_type="user", target_id=user.id,
              detail={"status": user.status}, ip=ip)
        db.commit()
        raise AppError(code, message, 403, **extra)

    token = auth.create_session(db, user, request.headers.get("user-agent"), ip)
    user.last_login_at = utcnow()
    audit(db, "login.success", actor_id=user.id, target_type="user", target_id=user.id, ip=ip)
    db.commit()
    _set_session_cookie(response, token)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DB):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        auth.delete_session(db, token)
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.patch("/password", status_code=204)
def change_password(body: PasswordChangeIn, request: Request, user: CurrentUser, db: DB):
    if not auth.verify_password(user.password_hash, body.current_password):
        raise AppError("INVALID_CREDENTIALS", "현재 비밀번호가 올바르지 않습니다.", 400)
    user.password_hash = auth.hash_password(body.new_password)
    # 다른 기기의 세션은 종료
    auth.revoke_user_sessions(db, user.id, except_token=request.cookies.get(SESSION_COOKIE))
    audit(db, "user.password_change", actor_id=user.id, target_type="user", target_id=user.id,
          ip=client_ip(request))
    db.commit()
