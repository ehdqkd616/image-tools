import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _check_password(v: str) -> str:
    if len(v) < 8 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.")
    if len(v) > 128:
        raise ValueError("비밀번호가 너무 깁니다.")
    return v


class SignupIn(BaseModel):
    email: EmailStr
    password: str
    name: str = Field(min_length=1, max_length=50)
    signup_note: str | None = Field(default=None, max_length=1000)
    agree_terms: bool
    agree_privacy: bool

    _pw = field_validator("password")(_check_password)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("이름을 입력하세요.")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str

    _pw = field_validator("new_password")(_check_password)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    role: str
    status: str
    storage_quota_bytes: int
    storage_used_bytes: int
    created_at: datetime
    last_login_at: datetime | None
