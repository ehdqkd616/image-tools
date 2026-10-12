import pytest

from app.tests.conftest import PASSWORD, login, make_user, new_client


def test_signup_creates_pending_user(client):
    res = client.post("/api/auth/signup", json={
        "username": "NewUser", "password": "abcd1234", "name": "새회원",
    })
    assert res.status_code == 201
    res = login(client, "newuser", "abcd1234")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "ACCOUNT_PENDING"


@pytest.mark.parametrize("password", ["short1", "1234567"])
def test_signup_password_rules(client, password):
    res = client.post("/api/auth/signup", json={"username": "abc", "password": password, "name": "a"})
    assert res.status_code == 422


@pytest.mark.parametrize("username", ["ab", "a@example.com", "한글아이디", "x" * 33])
def test_signup_username_rules(client, username):
    res = client.post("/api/auth/signup", json={"username": username, "password": "abcd1234", "name": "a"})
    assert res.status_code == 422


def test_signup_duplicate_username(client):
    make_user("dup")
    res = client.post("/api/auth/signup", json={"username": "DUP", "password": "abcd1234", "name": "a"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "USERNAME_TAKEN"


def test_legacy_email_username_can_login(client):
    make_user("old@example.com")
    assert login(client, "old@example.com").status_code == 200


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


def test_sync_admin_creates_and_resets_password(db):
    from app.cli import sync_admin

    assert sync_admin(db, "firstpass1") == "cli.admin.create"
    c = new_client()
    me = login(c, "admin", "firstpass1")
    assert me.status_code == 200 and me.json()["role"] == "admin"

    sync_admin(db, "secondpass2")  # .env 값이 바뀌면 비밀번호도 따라간다
    assert login(new_client(), "admin", "firstpass1").status_code == 401
    assert login(new_client(), "admin", "secondpass2").status_code == 200
