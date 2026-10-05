"""매일 1회 정리 작업 (§6.3)

1. 보관 기간이 지난 파일 삭제 (작업 기록은 유지 → '파일 만료' 상태)
2. 소프트 삭제 후 유예기간이 지난 파일 실제 삭제
3. 작업에 쓰이지 않은 업로드 파일 정리
4. 오래 멈춰 있는 처리 중 작업을 실패 처리
5. 만료된 세션 삭제
"""

import logging
from datetime import timedelta

from sqlalchemy import delete, exists, or_, select, update

from app.config import settings
from app.db import SessionLocal, utcnow
from app.models import Asset, Job, UserSession
from app.services.assets import purge_asset_files

log = logging.getLogger(__name__)
BATCH = 500


def run_cleanup() -> dict:
    now = utcnow()
    stats = {"expired": 0, "purged_deleted": 0, "unused_uploads": 0, "stale_jobs": 0, "sessions": 0}
    with SessionLocal() as db:
        used_by_job = exists().where(
            or_(Job.input_asset_id == Asset.id, Job.output_asset_id == Asset.id)
        )
        conditions = {
            "expired": Asset.expires_at <= now,
            "purged_deleted": Asset.deleted_at <= now - timedelta(days=settings.deleted_grace_days),
            "unused_uploads": (Asset.kind == "original")
            & (Asset.created_at <= now - timedelta(hours=settings.unused_upload_hours))
            & ~used_by_job,
        }
        for name, cond in conditions.items():
            while True:
                assets = db.scalars(
                    select(Asset).where(Asset.purged_at.is_(None), cond).limit(BATCH)
                ).all()
                if not assets:
                    break
                for asset in assets:
                    try:
                        purge_asset_files(db, asset)
                        stats[name] += 1
                    except Exception:
                        log.exception("failed to purge asset %s", asset.id)
                        asset.purged_at = now  # 무한 반복 방지
                db.commit()

        stats["stale_jobs"] = db.execute(
            update(Job)
            .where(Job.status == "processing", Job.started_at <= now - timedelta(hours=2))
            .values(status="failed", error_message="처리가 중단되었습니다. 다시 시도해 주세요.", finished_at=now)
        ).rowcount
        stats["sessions"] = db.execute(delete(UserSession).where(UserSession.expires_at <= now)).rowcount
        db.commit()
    log.info("cleanup done: %s", stats)
    return stats
