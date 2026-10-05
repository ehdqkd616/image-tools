from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """API 오류. 응답 형식: {"error": {"code": ..., "message": ...}}"""

    def __init__(self, code: str, message: str, status_code: int = 400, **extra):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra


def not_found(what: str = "대상") -> AppError:
    return AppError("NOT_FOUND", f"{what}을(를) 찾을 수 없습니다.", 404)


def forbidden() -> AppError:
    return AppError("FORBIDDEN", "권한이 없습니다.", 403)


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


_HTTP_CODES = {
    401: ("UNAUTHORIZED", "로그인이 필요합니다."),
    403: ("FORBIDDEN", "권한이 없습니다."),
    404: ("NOT_FOUND", "찾을 수 없습니다."),
    405: ("METHOD_NOT_ALLOWED", "허용되지 않은 요청입니다."),
    413: ("FILE_TOO_LARGE", "요청이 너무 큽니다."),
    429: ("RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도하세요."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(_body(exc.code, exc.message, **exc.extra), status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code, message = _HTTP_CODES.get(exc.status_code, ("ERROR", str(exc.detail)))
        return JSONResponse(_body(code, message), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        fields = [
            {"loc": [str(p) for p in e.get("loc", ())], "message": e.get("msg", "")} for e in exc.errors()
        ]
        return JSONResponse(
            _body("VALIDATION_ERROR", "입력값을 확인해 주세요.", fields=fields), status_code=422
        )
