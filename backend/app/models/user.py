import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.db import Base, utcnow

USER_STATUSES = ("pending", "approved", "rejected", "suspended")
USER_ROLES = ("user", "admin")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_status", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(100))
    signup_note: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20), default="user", server_default="user")
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    reject_reason: Mapped[str | None] = mapped_column(Text)
    storage_quota_bytes: Mapped[int] = mapped_column(
        BigInteger, default=lambda: settings.default_user_quota_mb * 1024 * 1024
    )
    storage_used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
