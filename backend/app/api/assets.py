import uuid

from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.api.common import content_disposition, get_owned_asset
from app.config import settings
from app.deps import DB, CurrentUser, client_ip
from app.errors import AppError
from app.redis_conn import rate_limit
from app.schemas.jobs import AssetOut
from app.services.assets import store_original
from app.services.audit import audit
from app.services.storage import get_storage

router = APIRouter(prefix="/assets", tags=["assets"])


def _read_limited(file: UploadFile, limit: int) -> bytes | None:
    # 동기 엔드포인트(스레드풀)에서 읽는다. Pillow 처리가 이벤트 루프를 막지 않도록.
    data = file.file.read(limit + 1)
    return None if len(data) > limit else data


@router.post("")
def upload(files: list[UploadFile], user: CurrentUser, db: DB):
    """이미지 업로드(다중). 파일별 성공/실패를 함께 돌려준다."""
    rate_limit("upload", str(user.id), limit=120, window_seconds=60)
    if len(files) > settings.max_files_per_request:
        raise AppError("TOO_MANY_FILES", f"한 번에 최대 {settings.max_files_per_request}장까지 올릴 수 있습니다.")
    items, errors = [], []
    for f in files:
        data = _read_limited(f, settings.max_upload_bytes)
        if data is None:
            errors.append({"filename": f.filename, "code": "FILE_TOO_LARGE",
                           "message": f"파일당 최대 {settings.max_upload_mb}MB까지 올릴 수 있습니다."})
            continue
        try:
            asset = store_original(db, user, f.filename, data)
            db.commit()
            items.append(AssetOut.model_validate(asset))
        except AppError as e:
            db.rollback()
            errors.append({"filename": f.filename, "code": e.code, "message": e.message})
            if e.code == "QUOTA_EXCEEDED":
                break
    return {"items": items, "errors": errors}


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: uuid.UUID, user: CurrentUser, db: DB):
    return get_owned_asset(db, asset_id, user)


def _stream(key: str, media_type: str, headers: dict) -> StreamingResponse:
    headers = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", **headers}
    return StreamingResponse(get_storage().iter_chunks(key), media_type=media_type, headers=headers)


@router.get("/{asset_id}/file")
def get_file(asset_id: uuid.UUID, request: Request, user: CurrentUser, db: DB, download: bool = False):
    asset = get_owned_asset(db, asset_id, user)
    if not asset.file_available:
        raise AppError("FILE_EXPIRED", "파일이 만료되었거나 삭제되었습니다.", 410)
    if asset.user_id != user.id:
        audit(db, "admin.file.download" if download else "admin.file.view", actor_id=user.id,
              target_type="asset", target_id=asset.id, detail={"owner_id": str(asset.user_id)},
              ip=client_ip(request))
        db.commit()
    filename = asset.original_filename or f"{asset.id}"
    return _stream(asset.storage_key, asset.mime_type or "application/octet-stream",
                   {"Content-Disposition": content_disposition(filename, attachment=download)})


@router.get("/{asset_id}/thumb")
def get_thumb(asset_id: uuid.UUID, user: CurrentUser, db: DB):
    asset = get_owned_asset(db, asset_id, user)
    if not asset.file_available or not asset.thumb_key:
        raise AppError("FILE_EXPIRED", "파일이 만료되었거나 삭제되었습니다.", 410)
    return _stream(asset.thumb_key, "image/webp", {})
