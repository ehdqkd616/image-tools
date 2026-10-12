import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _check_password(v: str) -> str:
    if len(v) < 8 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.")
    if len(v) > 128:
        raise ValueError("비밀번호가 너무 깁니다.")
    return v


# 아이디: 영문 소문자로 시작하는 4~20자 영문·숫자 (모든 프로젝트 공통)
USERNAME_RE = re.compile(r"^[a-z][a-z0-9]{3,19}$")


class SignupIn(BaseModel):
    username: str
    password: str
    name: str = Field(min_length=1, max_length=50)
    signup_note: str | None = Field(default=None, max_length=1000)
    agree_terms: bool
    agree_privacy: bool

    _pw = field_validator("password")(_check_password)

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.fullmatch(v):
            raise ValueError("아이디는 영문 소문자로 시작하는 4~20자 영문·숫자입니다.")
        return v

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("이름을 입력하세요.")
        return v


class LoginIn(BaseModel):
    # 형식은 검사하지 않는다 — 예전 가입자는 이메일 형태 아이디를 그대로 쓴다
    username: str = Field(max_length=320)
    password: str = Field(max_length=128)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str

    _pw = field_validator("new_password")(_check_password)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    name: str
    role: str
    status: str
    storage_quota_bytes: int
    storage_used_bytes: int
    created_at: datetime
    last_login_at: datetime | None
    password_managed: bool = False
