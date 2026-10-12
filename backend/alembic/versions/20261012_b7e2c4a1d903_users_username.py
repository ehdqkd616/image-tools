"""users: sign up with a username instead of an email

Existing rows keep their value (older accounts simply use their email as the id).

Revision ID: b7e2c4a1d903
Revises: 9461086fa3ad
Create Date: 2026-10-12 12:00:00.000000
"""
from alembic import op

revision = 'b7e2c4a1d903'
down_revision = '9461086fa3ad'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('users', 'email', new_column_name='username')


def downgrade() -> None:
    op.alter_column('users', 'username', new_column_name='email')
