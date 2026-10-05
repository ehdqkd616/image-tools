import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, utcnow


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # original | result
    storage_key: Mapped[str] = mapped_column(String(512))
    thumb_key: Mapped[str | None] = mapped_column(String(512))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(100))
    format: Mapped[str | None] = mapped_column(String(20))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 실제 파일이 저장소에서 지워진 시각 (지침서 스키마에 추가한 컬럼, docs/decisions.md 참고)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def file_available(self) -> bool:
        return self.deleted_at is None and self.purged_at is None
