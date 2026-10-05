"""관리 명령

    python -m app.cli create-admin --email admin@example.com --name 관리자 [--password ...]
    python -m app.cli cleanup
"""

import argparse
import getpass
import re
import sys

from sqlalchemy import func, select

from app.db import SessionLocal, utcnow
from app.models import User
from app.services.audit import audit
from app.services.auth_service import hash_password


def create_admin(email: str, name: str, password: str | None) -> None:
    email = email.strip().lower()
    if password is None:
        password = getpass.getpass("비밀번호: ")
        if getpass.getpass("비밀번호 확인: ") != password:
            sys.exit("비밀번호가 일치하지 않습니다.")
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        sys.exit("비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(func.lower(User.email) == email))
        if user:
            user.role, user.status = "admin", "approved"
            user.password_hash = hash_password(password)
            action = "cli.admin.promote"
            print(f"기존 계정을 관리자로 변경했습니다: {email}")
        else:
            user = User(email=email, name=name, password_hash=hash_password(password),
                        role="admin", status="approved", approved_at=utcnow())
            db.add(user)
            action = "cli.admin.create"
            print(f"관리자 계정을 만들었습니다: {email}")
        db.flush()
        audit(db, action, target_type="user", target_id=user.id)
        db.commit()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="관리자 계정 생성(이미 있으면 관리자로 승격)")
    p.add_argument("--email", required=True)
    p.add_argument("--name", default="관리자")
    p.add_argument("--password", help="생략하면 입력 프롬프트")
    sub.add_parser("cleanup", help="만료 파일 정리 작업을 즉시 실행")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        create_admin(args.email, args.name, args.password)
    elif args.command == "cleanup":
        from app.workers.cleanup import run_cleanup

        print(run_cleanup())


if __name__ == "__main__":
    main()
