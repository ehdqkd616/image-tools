import uuid

from sqlalchemy.orm import Session

from app.models import AuditLog


def audit(
    db: Session,
    action: str,
    *,
    actor_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    detail: dict | None = None,
    ip: str | None = None,
) -> None:
    """감사 로그 1건 추가. 커밋은 호출하는 쪽에서."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            detail=detail,
            ip=ip,
        )
    )
