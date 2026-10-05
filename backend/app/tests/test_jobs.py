import io
import zipfile
from datetime import timedelta
from urllib.parse import unquote

from sqlalchemy import select, update

from app.db import SessionLocal, utcnow
from app.models import Asset, Job
from app.services.storage import get_storage
from app.tests.conftest import image_bytes, login, make_user, new_client, run_job, upload_ok
from app.workers.cleanup import run_cleanup


def other_client():
    make_user("other@example.com")
    c = new_client()
    assert login(c, "other@example.com").status_code == 200
    return c


def test_idor_other_users_job_and_asset(user_client):
    asset = upload_ok(user_client, image_bytes())
    job = run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [asset["id"]])[0]
    other = other_client()
    for path in (
        f"/api/jobs/{job['id']}",
        f"/api/assets/{asset['id']}",
        f"/api/assets/{asset['id']}/file",
        f"/api/assets/{asset['id']}/thumb",
        f"/api/assets/{job['output_asset']['id']}/file",
    ):
        assert other.get(path).status_code == 404, path
    assert other.post(f"/api/jobs/{job['id']}/retry").status_code == 404
    assert other.delete(f"/api/jobs/{job['id']}").status_code == 404
    assert other.post("/api/downloads/zip", json={"job_ids": [job["id"]]}).status_code == 404
    # 남의 에셋으로 작업 생성 불가
    res = other.post("/api/jobs", json={"tool": "resize", "params": {"mode": "percent", "percent": 50},
                                        "asset_ids": [asset["id"]]})
    assert res.status_code == 404
    assert other.get("/api/jobs").json()["total"] == 0


def test_job_list_filters(user_client):
    a = upload_ok(user_client, image_bytes(), "고양이.png")
    b = upload_ok(user_client, image_bytes(), "dog.png")
    run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [a["id"]])
    run_job(user_client, "compress", {"mode": "quality", "quality": 50}, [b["id"]])
    assert user_client.get("/api/jobs").json()["total"] == 2
    assert user_client.get("/api/jobs", params={"tool": "resize"}).json()["total"] == 1
    assert user_client.get("/api/jobs", params={"q": "고양"}).json()["total"] == 1
    assert user_client.get("/api/jobs", params={"status": "failed"}).json()["total"] == 0


def test_chain_parent_derived_from_result_asset(user_client):
    asset = upload_ok(user_client, image_bytes((40, 40)))
    up = run_job(user_client, "upscale", {"scale": 2}, [asset["id"]])[0]
    comp = run_job(user_client, "compress", {"mode": "quality", "quality": 50}, [up["output_asset"]["id"]])[0]
    assert comp["parent_job_id"] == up["id"]
    detail = user_client.get(f"/api/jobs/{up['id']}").json()
    assert [c["id"] for c in detail["children"]] == [comp["id"]]
    assert user_client.get(f"/api/jobs/{comp['id']}").json()["parent"]["id"] == up["id"]


def test_retry_failed_job(user_client):
    asset = upload_ok(user_client, image_bytes())
    job = run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [asset["id"]])[0]
    assert user_client.post(f"/api/jobs/{job['id']}/retry").status_code == 409  # done은 재시도 불가
    with SessionLocal() as s:
        s.execute(update(Job).where(Job.id == job["id"]).values(status="failed", error_message="x"))
        s.commit()
    res = user_client.post(f"/api/jobs/{job['id']}/retry")
    assert res.status_code == 200
    assert user_client.get(f"/api/jobs/{job['id']}").json()["status"] == "done"


def test_cancel_queued_job(user_client, monkeypatch):
    from app.services import jobs as job_service

    monkeypatch.setattr(job_service, "enqueue", lambda job: None)  # 큐에 넣지 않음 = 대기 상태 유지
    asset = upload_ok(user_client, image_bytes())
    res = user_client.post("/api/jobs", json={"tool": "resize", "params": {"mode": "percent", "percent": 50},
                                              "asset_ids": [asset["id"]]})
    job_id = res.json()["jobs"][0]["id"]
    detail = user_client.get(f"/api/jobs/{job_id}").json()
    assert detail["status"] == "queued" and detail["queue_position"] == 1
    assert user_client.post(f"/api/jobs/{job_id}/cancel").json()["status"] == "canceled"
    # 워커가 나중에 집어가도 처리하지 않음
    from app.workers.tasks import process_job

    process_job(job_id)
    assert user_client.get(f"/api/jobs/{job_id}").json()["status"] == "canceled"


def test_delete_job_soft_deletes_and_frees_quota(user_client):
    asset = upload_ok(user_client, image_bytes())
    job = run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [asset["id"]])[0]
    used_before = user_client.get("/api/me/storage").json()["used_bytes"]
    assert used_before > 0
    assert user_client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert user_client.get(f"/api/jobs/{job['id']}").status_code == 404
    assert user_client.get("/api/me/storage").json()["used_bytes"] == 0
    # 유예기간 동안 파일은 남아있다가 정리 작업 후 삭제
    with SessionLocal() as s:
        out = s.get(Asset, job["output_asset"]["id"])
        assert get_storage().exists(out.storage_key)
        s.execute(update(Asset).values(deleted_at=utcnow() - timedelta(days=30)))
        s.commit()
    run_cleanup()
    with SessionLocal() as s:
        assert not get_storage().exists(s.get(Asset, job["output_asset"]["id"]).storage_key)


def test_quota_exceeded_blocks_jobs(user_client):
    asset = upload_ok(user_client, image_bytes())
    with SessionLocal() as s:
        from app.models import User

        s.execute(update(User).where(User.email == "user@example.com").values(storage_quota_bytes=10))
        s.commit()
    res = user_client.post("/api/jobs", json={"tool": "resize", "params": {"mode": "percent", "percent": 50},
                                              "asset_ids": [asset["id"]]})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "QUOTA_EXCEEDED"
    res = user_client.post("/api/assets", files=[("files", ("a.png", image_bytes(), "image/png"))])
    assert res.json()["errors"][0]["code"] == "QUOTA_EXCEEDED"


def test_cleanup_expires_files_keeps_records(user_client):
    asset = upload_ok(user_client, image_bytes())
    job = run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [asset["id"]])[0]
    with SessionLocal() as s:
        s.execute(update(Asset).values(expires_at=utcnow() - timedelta(minutes=1)))
        s.commit()
        keys = [a.storage_key for a in s.scalars(select(Asset))]
    stats = run_cleanup()
    assert stats["expired"] == 2
    assert all(not get_storage().exists(k) for k in keys)
    detail = user_client.get(f"/api/jobs/{job['id']}").json()
    assert detail["status"] == "done"
    assert detail["output_asset"]["file_available"] is False
    assert user_client.get(f"/api/assets/{job['output_asset']['id']}/file").status_code == 410
    assert user_client.get("/api/jobs", params={"status": "expired"}).json()["total"] == 1
    assert user_client.get("/api/me/storage").json()["used_bytes"] == 0


def test_cleanup_unused_uploads(user_client):
    upload_ok(user_client, image_bytes())
    with SessionLocal() as s:
        s.execute(update(Asset).values(created_at=utcnow() - timedelta(days=2)))
        s.commit()
    assert run_cleanup()["unused_uploads"] == 1


def test_zip_download_and_korean_filename(user_client):
    a = upload_ok(user_client, image_bytes(), "고양이 사진.png")
    b = upload_ok(user_client, image_bytes(), "고양이 사진.png")
    jobs = [run_job(user_client, "resize", {"mode": "percent", "percent": 50}, [x["id"]])[0] for x in (a, b)]
    res = user_client.get(f"/api/assets/{jobs[0]['output_asset']['id']}/file", params={"download": 1})
    cd = res.headers["content-disposition"]
    assert cd.startswith("attachment;")
    assert unquote(cd.split("filename*=UTF-8''")[1]) == "고양이 사진_32x24.png"
    res = user_client.post("/api/downloads/zip", json={"job_ids": [j["id"] for j in jobs], "include_original": True})
    assert res.status_code == 200
    names = sorted(zipfile.ZipFile(io.BytesIO(res.content)).namelist())
    assert names == ["original/고양이 사진 (2).png", "original/고양이 사진.png",
                     "고양이 사진_32x24 (2).png", "고양이 사진_32x24.png"]
