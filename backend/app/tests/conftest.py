import io
import os

# 앱 import 전에 테스트 설정
os.environ.update(
    APP_ENV="test",
    QUEUE_SYNC="true",
    UPSCALE_ENGINE="lanczos",
    LOCAL_STORAGE_PATH="/tmp/image-studio-test-storage",
    REDIS_URL=os.environ.get("TEST_REDIS_URL", "redis://redis:6379/15"),
    DATABASE_URL=os.environ.get(
        "TEST_DATABASE_URL", "postgresql+psycopg://app:app@postgres:5432/imagestudio_test"
    ),
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.config import settings  # noqa: E402


def _ensure_database() -> None:
    url = make_url(settings.database_url)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": url.database}):
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    admin.dispose()


_ensure_database()

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.redis_conn import get_redis  # noqa: E402
from app.services.auth_service import hash_password  # noqa: E402
from app.services.storage import get_storage  # noqa: E402

PASSWORD = "password123"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def _clean():
    with engine.begin() as conn:
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    get_redis().flushdb()
    get_storage().wipe()
    yield


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


def make_user(email="user@example.com", status="approved", role="user", quota_bytes=None) -> User:
    with SessionLocal() as s:
        user = User(email=email, name=email.split("@")[0], password_hash=hash_password(PASSWORD),
                    status=status, role=role)
        if quota_bytes is not None:
            user.storage_quota_bytes = quota_bytes
        s.add(user)
        s.commit()
        s.refresh(user)
        return user


def new_client() -> TestClient:
    return TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})


def login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


@pytest.fixture
def client():
    return new_client()


@pytest.fixture
def user_client():
    make_user("user@example.com")
    c = new_client()
    assert login(c, "user@example.com").status_code == 200
    return c


@pytest.fixture
def admin_client():
    make_user("admin@example.com", role="admin")
    c = new_client()
    assert login(c, "admin@example.com").status_code == 200
    return c


def image_bytes(size=(64, 48), fmt="PNG", mode="RGB", color=(200, 80, 40), **save_kwargs) -> bytes:
    img = Image.new(mode, size, color if mode != "RGBA" else (*color[:3], 128))
    # 약간의 무늬 (압축 테스트용)
    for x in range(0, size[0], 7):
        for y in range(0, size[1], 5):
            img.putpixel((x, y), (0, 0, 0) if mode == "RGB" else (0, 0, 0, 255) if mode == "RGBA" else 0)
    buf = io.BytesIO()
    img.save(buf, fmt, **save_kwargs)
    return buf.getvalue()


def noisy_image_bytes(size=(800, 600), fmt="JPEG", **kw) -> bytes:
    img = Image.effect_noise(size, 60).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def upload(client: TestClient, data: bytes, filename="photo.png"):
    return client.post("/api/assets", files=[("files", (filename, data, "application/octet-stream"))])


def upload_ok(client: TestClient, data: bytes, filename="photo.png") -> dict:
    res = upload(client, data, filename)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["errors"] == [], body
    return body["items"][0]


def run_job(client: TestClient, tool: str, params: dict, asset_ids: list[str]) -> list[dict]:
    res = client.post("/api/jobs", json={"tool": tool, "params": params, "asset_ids": asset_ids})
    assert res.status_code == 201, res.text
    return [client.get(f"/api/jobs/{j['id']}").json() for j in res.json()["jobs"]]
