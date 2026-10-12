"""관리 명령

    python -m app.cli create-admin [--password ...]   # 관리자 아이디는 항상 admin
    python -m app.cli cleanup
"""

import argparse
import getpass
import sys

from sqlalchemy import func, select

from app.db import SessionLocal, utcnow
from app.models import User
from app.services.audit import audit
from app.services.auth_service import hash_password, verify_password

ADMIN_USERNAME = "admin"


def sync_admin(db, password: str) -> str:
    """공통 관리자 계정 admin을 만들거나, 이미 있으면 관리자·승인 상태와 비밀번호를 맞춘다."""
    user = db.scalar(select(User).where(func.lower(User.username) == ADMIN_USERNAME))
    if user is None:
        user = User(username=ADMIN_USERNAME, name="관리자", password_hash=hash_password(password),
                    role="admin", status="approved", approved_at=utcnow())
        db.add(user)
        action = "cli.admin.create"
    else:
        user.role, user.status = "admin", "approved"
        if not verify_password(user.password_hash, password):
            user.password_hash = hash_password(password)
        action = "cli.admin.promote"
    db.flush()
    audit(db, action, target_type="user", target_id=user.id)
    db.commit()
    return action


def create_admin(password: str | None) -> None:
    if password is None:
        password = getpass.getpass("비밀번호: ")
        if getpass.getpass("비밀번호 확인: ") != password:
            sys.exit("비밀번호가 일치하지 않습니다.")
    if len(password) < 8:
        sys.exit("비밀번호는 8자 이상이어야 합니다.")
    with SessionLocal() as db:
        action = sync_admin(db, password)
    print(("관리자 계정을 만들었습니다" if action == "cli.admin.create" else "관리자 계정을 갱신했습니다")
          + f": {ADMIN_USERNAME}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="관리자 계정 admin 생성(이미 있으면 비밀번호 재설정)")
    p.add_argument("--password", help="생략하면 입력 프롬프트")
    sub.add_parser("cleanup", help="만료 파일 정리 작업을 즉시 실행")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        create_admin(args.password)
    elif args.command == "cleanup":
        from app.workers.cleanup import run_cleanup

        print(run_cleanup())


if __name__ == "__main__":
    main()
