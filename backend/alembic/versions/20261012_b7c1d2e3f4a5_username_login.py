"""이메일 가입 → 아이디 가입: users.email → users.username

기존 값(이메일 형태 아이디)은 그대로 두고 컬럼·제약 이름만 바꾼다.

Revision ID: b7c1d2e3f4a5
Revises: 9461086fa3ad
Create Date: 2026-10-12
"""
from alembic import op

revision = "b7c1d2e3f4a5"
down_revision = "9461086fa3ad"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "email", new_column_name="username")
    op.execute("ALTER TABLE users RENAME CONSTRAINT users_email_key TO users_username_key")


def downgrade() -> None:
    op.execute("ALTER TABLE users RENAME CONSTRAINT users_username_key TO users_email_key")
    op.alter_column("users", "username", new_column_name="email")
