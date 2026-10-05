from app.tests.conftest import image_bytes, login, make_user, new_client, run_job, upload_ok


def test_normal_user_cannot_access_admin(user_client):
    for path in ("/api/admin/stats", "/api/admin/users", "/api/admin/jobs", "/api/admin/audit-logs"):
        res = user_client.get(path)
        assert res.status_code == 403, path
    pending = make_user("p@example.com", status="pending")
    assert user_client.post(f"/api/admin/users/{pending.id}/approve").status_code == 403


def test_approval_flow(admin_client):
    pending = make_user("p@example.com", status="pending")
    c = new_client()
    assert login(c, "p@example.com").status_code == 403
    users = admin_client.get("/api/admin/users", params={"status": "pending"}).json()
    assert users["total"] == 1
    assert admin_client.post(f"/api/admin/users/{pending.id}/approve").status_code == 200
    assert login(c, "p@example.com").status_code == 200


def test_reject_with_reason(admin_client):
    pending = make_user("p@example.com", status="pending")
    res = admin_client.post(f"/api/admin/users/{pending.id}/reject", json={"reason": "목적 불명확"})
    assert res.status_code == 200
    res = login(new_client(), "p@example.com")
    assert res.json()["error"]["code"] == "ACCOUNT_REJECTED"
    assert res.json()["error"]["reason"] == "목적 불명확"


def test_bulk_approve(admin_client):
    ids = [str(make_user(f"p{i}@example.com", status="pending").id) for i in range(3)]
    res = admin_client.post("/api/admin/users/bulk-approve", json={"user_ids": ids})
    assert res.json() == {"approved": 3}


def test_admin_actions_are_audited(admin_client, user_client):
    pending = make_user("p@example.com", status="pending")
    admin_client.post(f"/api/admin/users/{pending.id}/approve")
    asset = upload_ok(user_client, image_bytes())
    admin_client.get(f"/api/assets/{asset['id']}/file")
    admin_client.get(f"/api/assets/{asset['id']}/file", params={"download": 1})
    actions = [log["action"] for log in admin_client.get("/api/admin/audit-logs").json()["items"]]
    assert "admin.user.approve" in actions
    assert "admin.file.view" in actions
    assert "admin.file.download" in actions
    assert "login.success" in actions


def test_admin_sees_user_jobs(admin_client, user_client):
    asset = upload_ok(user_client, image_bytes())
    run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [asset["id"]])
    users = admin_client.get("/api/admin/users", params={"q": "user@"}).json()["items"]
    jobs = admin_client.get(f"/api/admin/users/{users[0]['id']}/jobs").json()
    assert jobs["total"] == 1
    all_jobs = admin_client.get("/api/admin/jobs").json()
    assert all_jobs["items"][0]["user"]["email"] == "user@example.com"
    stats = admin_client.get("/api/admin/stats").json()
    assert stats["jobs_today"] == 1


def test_admin_cannot_suspend_self(admin_client):
    me = admin_client.get("/api/auth/me").json()
    # 관리자는 approved 상태이므로 suspend 시도
    assert admin_client.post(f"/api/admin/users/{me['id']}/suspend").status_code == 409
