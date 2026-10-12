import pytest

from app.tests.conftest import PASSWORD, login, make_user, new_client


def test_signup_creates_pending_user(client):
    res = client.post("/api/auth/signup", json={
        "username": "NewUser1", "password": "abcd1234", "name": "새회원",
        "signup_note": "블로그용", "agree_terms": True, "agree_privacy": True,
    })
    assert res.status_code == 201
    res = login(client, "newuser1", "abcd1234")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "ACCOUNT_PENDING"


@pytest.mark.parametrize("username", ["a@example.com", "1abcd", "abc", "a" * 21, "ab_cd"])
def test_signup_username_rules(client, username):
    """아이디는 영문 소문자로 시작하는 4~20자 영문·숫자 — 이메일 형태는 새로 만들 수 없다"""
    res = client.post("/api/auth/signup", json={
        "username": username, "password": "abcd1234", "name": "a",
        "agree_terms": True, "agree_privacy": True,
    })
    assert res.status_code == 422


@pytest.mark.parametrize("password", ["short1", "onlyletters", "12345678"])
def test_signup_password_rules(client, password):
    res = client.post("/api/auth/signup", json={
        "username": "auser", "password": password, "name": "a",
        "agree_terms": True, "agree_privacy": True,
    })
    assert res.status_code == 422


def test_signup_requires_agreement(client):
    res = client.post("/api/auth/signup", json={
        "username": "auser", "password": "abcd1234", "name": "a",
        "agree_terms": True, "agree_privacy": False,
    })
    assert res.status_code == 422


def test_signup_duplicate_username(client):
    make_user("dupuser")
    res = client.post("/api/auth/signup", json={
        "username": "DUPUSER", "password": "abcd1234", "name": "a",
        "agree_terms": True, "agree_privacy": True,
    })
    assert res.status_code == 409


@pytest.mark.parametrize("status,code", [
    ("pending", "ACCOUNT_PENDING"),
    ("rejected", "ACCOUNT_REJECTED"),
    ("suspended", "ACCOUNT_SUSPENDED"),
])
def test_login_blocked_by_status(client, status, code):
    make_user("s@example.com", status=status)
    res = login(client, "s@example.com")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == code
    assert "is_session" not in res.cookies


def test_status_not_revealed_with_wrong_password(client):
    make_user("s@example.com", status="pending")
    res = login(client, "s@example.com", "wrongpass1")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_approved_success_and_me(client):
    make_user("ok@example.com")
    res = login(client, "ok@example.com")
    assert res.status_code == 200
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "ok@example.com"


def test_unauthenticated_requests_rejected(client):
    for path in ("/api/auth/me", "/api/jobs", "/api/me/storage", "/api/presets/resize"):
        assert client.get(path).status_code == 401


def test_logout(user_client):
    assert user_client.post("/api/auth/logout").status_code == 204
    assert user_client.get("/api/auth/me").status_code == 401


def test_login_lockout_after_5_failures(client):
    make_user("lock@example.com")
    for _ in range(5):
        assert login(client, "lock@example.com", "wrongpass1").status_code == 401
    res = login(client, "lock@example.com")  # 비밀번호가 맞아도 잠김
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "RATE_LIMITED"


def test_suspend_invalidates_existing_session(user_client, admin_client):
    assert user_client.get("/api/auth/me").status_code == 200
    users = admin_client.get("/api/admin/users", params={"q": "user@"}).json()["items"]
    res = admin_client.post(f"/api/admin/users/{users[0]['id']}/suspend")
    assert res.status_code == 200
    res = user_client.get("/api/auth/me")
    assert res.status_code == 401
    # 해제 후에도 기존 세션은 이미 무효
    admin_client.post(f"/api/admin/users/{users[0]['id']}/unsuspend")
    assert user_client.get("/api/auth/me").status_code == 401


def test_password_change(user_client):
    res = user_client.patch("/api/auth/password", json={"current_password": "wrong1234", "new_password": "newpass123"})
    assert res.status_code == 400
    res = user_client.patch("/api/auth/password", json={"current_password": PASSWORD, "new_password": "newpass123"})
    assert res.status_code == 204
    c = new_client()
    assert login(c, "user@example.com", "newpass123").status_code == 200


def test_csrf_origin_check(user_client):
    res = user_client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    c = new_client()
    c.headers.pop("Origin")
    assert c.post("/api/auth/login", json={"username": "x@example.com", "password": "x"}).status_code == 403


def test_managed_admin_password(client, monkeypatch):
    """관리자 비밀번호는 .env가 기준 — 화면에서 바꿀 수 없고, 기동할 때 .env 값으로 맞춘다"""
    from app.config import settings
    from app.db import SessionLocal
    from app.services.auth_service import ensure_admin

    monkeypatch.setattr(settings, "admin_username", "admin")
    monkeypatch.setattr(settings, "admin_password", "AdminPass123")
    with SessionLocal() as db:
        assert ensure_admin(db) == "created"
        assert ensure_admin(db) is None
    assert login(client, "admin", "AdminPass123").status_code == 200
    res = client.patch("/api/auth/password", json={"current_password": "AdminPass123", "new_password": "Other1234"})
    assert res.status_code == 409

    monkeypatch.setattr(settings, "admin_password", "Changed123")
    with SessionLocal() as db:
        assert ensure_admin(db) == "synced"
    assert client.get("/api/auth/me").status_code == 401  # 예전 비밀번호로 만든 세션은 종료
    assert login(new_client(), "admin", "Changed123").status_code == 200
