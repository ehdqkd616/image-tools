import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow
from app.models.asset import Asset

TOOLS = ("upscale", "resize", "compress")
JOB_STATUSES = ("queued", "processing", "done", "failed", "canceled")


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tool: Mapped[str] = mapped_column(String(20))
    params: Mapped[dict] = mapped_column(JSONB)
    total: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_user_created", "user_id", "created_at"),
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_tool", "tool"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"))
    parent_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    tool: Mapped[str] = mapped_column(String(20))
    params: Mapped[dict] = mapped_column(JSONB)
    input_asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assets.id"))
    output_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    progress: Mapped[int] = mapped_column(SmallInteger, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    # 처리 결과 부가정보: 사용 품질값, 목표 용량 달성 여부, 원본 유지 여부 등 (지침서에 추가)
    result: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    input_asset: Mapped[Asset] = relationship(foreign_keys=[input_asset_id], lazy="joined")
    output_asset: Mapped[Asset | None] = relationship(foreign_keys=[output_asset_id], lazy="joined")
