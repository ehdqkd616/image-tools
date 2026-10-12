import logging
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import admin, assets, auth, jobs
from app.config import settings
from app.db import SessionLocal
from app.errors import install_error_handlers
from app.services.auth_service import ensure_admin

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Image Studio API",
    docs_url=None if settings.is_production else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/api/openapi.json",
)
install_error_handlers(app)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def origin_check(request: Request, call_next):
    """CSRF 방어: SameSite=Strict 쿠키 + 상태 변경 요청의 Origin(없으면 Referer) 검사"""
    if request.method in UNSAFE_METHODS:
        source = request.headers.get("origin") or request.headers.get("referer")
        ok = False
        if source:
            parts = urlsplit(source)
            origin = f"{parts.scheme}://{parts.netloc}"
            ok = parts.netloc == request.headers.get("host") or origin in settings.origins
        if not ok:
            return JSONResponse(
                {"error": {"code": "FORBIDDEN", "message": "허용되지 않은 요청 출처입니다."}}, status_code=403
            )
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.path.startswith("/api/") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


for router in (auth.router, assets.router, jobs.router, admin.router):
    app.include_router(router, prefix="/api")


@app.on_event("startup")
def _sync_admin() -> None:
    with SessionLocal() as db:
        result = ensure_admin(db)
    if result:
        logging.getLogger("app").info("관리자 계정 %s: %s", "생성" if result == "created" else "동기화", settings.admin_username)


@app.get("/api/health")
def health():
    return {"ok": True}
