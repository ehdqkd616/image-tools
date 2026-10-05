"""에셋 저장·삭제와 저장 용량 관리"""

import uuid
from datetime import timedelta
from pathlib import PurePath

from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.errors import AppError
from app.models import Asset, Job, User
from app.services import image_io
from app.services.storage import get_storage


def ensure_quota(user: User, extra_bytes: int = 0) -> None:
    if user.storage_used_bytes + extra_bytes > user.storage_quota_bytes:
        raise AppError(
            "QUOTA_EXCEEDED",
            "저장 용량 한도를 초과했습니다. 작업 기록에서 필요 없는 파일을 삭제해 주세요.",
            403,
        )


def add_usage(db: Session, user_id: uuid.UUID, delta: int) -> None:
    db.execute(
        update(User)
        .where(User.id == user_id)
        .values(storage_used_bytes=User.storage_used_bytes + delta)
    )


def _keys(user_id: uuid.UUID, asset_id: uuid.UUID, ext: str) -> tuple[str, str]:
    now = utcnow()
    base = f"{user_id}/{now:%Y/%m}/{asset_id}"
    return f"{base}.{ext}", f"{base}_thumb.webp"


def safe_filename(name: str | None) -> str:
    name = PurePath((name or "image").replace("\\", "/")).name.strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"/\\|?*')
    return name[:200] or "image"


def store_original(db: Session, user: User, filename: str | None, data: bytes) -> Asset:
    info = image_io.probe(data)
    ensure_quota(user, len(data))
    loaded = image_io.load(data)
    asset_id = uuid.uuid4()
    key, thumb_key = _keys(user.id, asset_id, image_io.EXTENSIONS[info.format])
    storage = get_storage()
    storage.put_bytes(key, data, info.mime_type)
    storage.put_bytes(thumb_key, image_io.make_thumbnail(loaded.image), "image/webp")
    asset = Asset(
        id=asset_id,
        user_id=user.id,
        kind="original",
        storage_key=key,
        thumb_key=thumb_key,
        original_filename=safe_filename(filename),
        mime_type=info.mime_type,
        format=info.format,
        width=info.width,
        height=info.height,
        size_bytes=len(data),
        expires_at=utcnow() + timedelta(days=settings.file_retention_days),
    )
    db.add(asset)
    add_usage(db, user.id, len(data))
    db.expire(user, ["storage_used_bytes"])
    return asset


def store_result(
    db: Session,
    user_id: uuid.UUID,
    data: bytes,
    fmt: str,
    image,
    filename: str,
) -> Asset:
    asset_id = uuid.uuid4()
    key, thumb_key = _keys(user_id, asset_id, image_io.EXTENSIONS[fmt])
    storage = get_storage()
    storage.put_bytes(key, data, image_io.MIME_TYPES[fmt])
    storage.put_bytes(thumb_key, image_io.make_thumbnail(image), "image/webp")
    asset = Asset(
        id=asset_id,
        user_id=user_id,
        kind="result",
        storage_key=key,
        thumb_key=thumb_key,
        original_filename=filename,
        mime_type=image_io.MIME_TYPES[fmt],
        format=fmt,
        width=image.width,
        height=image.height,
        size_bytes=len(data),
        expires_at=utcnow() + timedelta(days=settings.file_retention_days),
    )
    db.add(asset)
    add_usage(db, user_id, len(data))
    return asset


def result_filename(input_name: str | None, tool: str, params: dict, fmt: str, width: int, height: int) -> str:
    stem = PurePath(input_name or "image").stem or "image"
    if tool == "upscale":
        suffix = f"upscale_{params.get('scale', 2)}x"
    elif tool == "resize":
        suffix = f"{width}x{height}"
    else:
        suffix = "compressed"
    return f"{stem}_{suffix}.{image_io.EXTENSIONS[fmt]}"


def asset_in_use(db: Session, asset_id: uuid.UUID, exclude_job_id: uuid.UUID | None = None) -> bool:
    """삭제되지 않은 다른 작업이 이 에셋을 입력 또는 결과로 쓰고 있는지"""
    cond = (Job.deleted_at.is_(None)) & ((Job.input_asset_id == asset_id) | (Job.output_asset_id == asset_id))
    if exclude_job_id:
        cond &= Job.id != exclude_job_id
    return db.scalar(select(exists().where(cond))) or False


def soft_delete_asset(db: Session, asset: Asset) -> None:
    """소프트 삭제. 사용량은 즉시 반환하고, 실제 파일은 정리 작업이 유예기간 후 지운다."""
    if asset.deleted_at is not None:
        return
    asset.deleted_at = utcnow()
    if asset.purged_at is None:
        add_usage(db, asset.user_id, -asset.size_bytes)


def purge_asset_files(db: Session, asset: Asset) -> None:
    storage = get_storage()
    for key in (asset.storage_key, asset.thumb_key):
        if key:
            storage.delete(key)
    if asset.deleted_at is None:
        asset.deleted_at = utcnow()
        add_usage(db, asset.user_id, -asset.size_bytes)
    asset.purged_at = utcnow()
