import io

import pytest
from PIL import Image

from app.schemas.jobs import ResizeParams
from app.services.resize import target_size
from app.services.storage import get_storage
from app.tests.conftest import image_bytes, noisy_image_bytes, run_job, upload, upload_ok


def fetch_image(client, asset_id) -> Image.Image:
    res = client.get(f"/api/assets/{asset_id}/file")
    assert res.status_code == 200
    return Image.open(io.BytesIO(res.content))


# --- 업로드 검증 ------------------------------------------------------------------

def test_upload_valid_formats(user_client):
    for fmt, name in (("PNG", "a.png"), ("JPEG", "a.jpg"), ("WEBP", "a.webp"), ("GIF", "a.gif"), ("BMP", "a.bmp")):
        asset = upload_ok(user_client, image_bytes(fmt=fmt), name)
        assert asset["width"] == 64 and asset["height"] == 48
    assert user_client.get("/api/me/storage").json()["used_bytes"] > 0


def test_renamed_non_image_rejected(user_client):
    res = upload(user_client, b"%PDF-1.4 fake pdf content here", "photo.jpg")
    assert res.json()["errors"][0]["code"] == "UNSUPPORTED_FORMAT"
    res = upload(user_client, b"\xff\xd8\xff\xe0garbage-not-a-real-jpeg", "photo.jpg")
    assert res.json()["errors"][0]["code"] == "UNSUPPORTED_FORMAT"


def test_decompression_bomb_rejected(user_client):
    buf = io.BytesIO()
    Image.new("1", (10000, 10000)).save(buf, "PNG")  # 100MP, 파일은 작음
    assert len(buf.getvalue()) < 1_000_000
    res = upload(user_client, buf.getvalue(), "bomb.png")
    assert res.json()["errors"][0]["code"] == "IMAGE_TOO_LARGE"


def test_file_too_large(user_client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_upload_mb", 0)
    res = upload(user_client, image_bytes())
    assert res.json()["errors"][0]["code"] == "FILE_TOO_LARGE"


def test_exif_orientation_applied(user_client):
    img = Image.new("RGB", (60, 30), (255, 0, 0))
    exif = Image.Exif()
    exif[0x0112] = 6  # 90도 회전 필요
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    asset = upload_ok(user_client, buf.getvalue(), "phone.jpg")
    assert (asset["width"], asset["height"]) == (30, 60)
    job = run_job(user_client, "resize", {"mode": "percent", "percent": 100}, [asset["id"]])[0]
    out = fetch_image(user_client, job["output_asset"]["id"])
    assert out.size == (30, 60)
    assert 0x0112 not in out.getexif()


def test_metadata_stripped_by_default(user_client):
    exif = Image.Exif()
    exif[0x010F] = "CameraMaker"
    asset = upload_ok(user_client, noisy_image_bytes(exif=exif.tobytes(), quality=95), "a.jpg")
    job = run_job(user_client, "compress", {"mode": "quality", "quality": 60}, [asset["id"]])[0]
    assert len(fetch_image(user_client, job["output_asset"]["id"]).getexif()) == 0
    job = run_job(user_client, "compress", {"mode": "quality", "quality": 60, "strip_metadata": False},
                  [asset["id"]])[0]
    assert fetch_image(user_client, job["output_asset"]["id"]).getexif().get(0x010F) == "CameraMaker"


# --- 크기 조절 -------------------------------------------------------------------

@pytest.mark.parametrize("params,expected", [
    ({"mode": "pixel", "width": 400}, (400, 300)),                    # 비율 잠금: 가로만
    ({"mode": "pixel", "height": 150}, (200, 150)),                   # 비율 잠금: 세로만
    ({"mode": "percent", "percent": 25}, (200, 150)),
    ({"mode": "pixel", "width": 500, "height": 500, "fit": "contain"}, (500, 375)),
    ({"mode": "pixel", "width": 500, "height": 500, "fit": "stretch"}, (500, 500)),
    ({"mode": "pixel", "width": 500, "height": 500, "fit": "cover"}, (500, 500)),
])
def test_target_size(params, expected):
    p = ResizeParams.model_validate(params)
    w, h, _ = target_size(800, 600, p)
    assert (w, h) == expected


def test_resize_job_sizes_and_format(user_client):
    asset = upload_ok(user_client, image_bytes((800, 600)), "big.png")
    cases = [
        ({"mode": "pixel", "width": 1080, "height": 1080, "fit": "cover", "format": "jpg"}, (1080, 1080), "JPEG"),
        ({"mode": "pixel", "width": 400, "lock_ratio": True, "format": "webp"}, (400, 300), "WEBP"),
        ({"mode": "percent", "percent": 50}, (400, 300), "PNG"),
        ({"mode": "pixel", "width": 300, "height": 300, "fit": "contain"}, (300, 225), "PNG"),
    ]
    for params, size, fmt in cases:
        job = run_job(user_client, "resize", params, [asset["id"]])[0]
        assert job["status"] == "done", job
        out = fetch_image(user_client, job["output_asset"]["id"])
        assert out.size == size and out.format == fmt, params


def test_resize_batch_percent_per_image(user_client):
    a = upload_ok(user_client, image_bytes((100, 100)))
    b = upload_ok(user_client, image_bytes((300, 100)))
    res = user_client.post("/api/jobs", json={"tool": "resize", "params": {"mode": "percent", "percent": 50},
                                              "asset_ids": [a["id"], b["id"]]})
    body = res.json()
    assert body["batch"]["total"] == 2
    sizes = sorted((j["output_asset"]["width"], j["output_asset"]["height"])
                   for j in (user_client.get(f"/api/jobs/{x['id']}").json() for x in body["jobs"]))
    assert sizes == [(50, 50), (150, 50)]


def test_resize_invalid_params(user_client):
    asset = upload_ok(user_client, image_bytes())
    res = user_client.post("/api/jobs", json={"tool": "resize", "params": {"mode": "pixel"}, "asset_ids": [asset["id"]]})
    assert res.status_code == 422


# --- 용량 줄이기 -----------------------------------------------------------------

def test_compress_quality_reduces_size(user_client):
    data = noisy_image_bytes(quality=95)
    asset = upload_ok(user_client, data, "n.jpg")
    job = run_job(user_client, "compress", {"mode": "quality", "quality": 40}, [asset["id"]])[0]
    assert job["status"] == "done"
    assert job["output_asset"]["size_bytes"] < len(data)


def test_compress_target_size_met(user_client):
    data = noisy_image_bytes(quality=95)
    asset = upload_ok(user_client, data, "n.jpg")
    target = 60_000
    job = run_job(user_client, "compress", {"mode": "target_size", "target_bytes": target, "format": "webp"},
                  [asset["id"]])[0]
    assert job["status"] == "done"
    assert job["output_asset"]["size_bytes"] <= target
    assert job["result"]["target_met"] is True


def test_compress_target_impossible(user_client):
    asset = upload_ok(user_client, noisy_image_bytes(quality=95), "n.jpg")
    job = run_job(user_client, "compress", {"mode": "target_size", "target_bytes": 1024, "allow_downscale": False},
                  [asset["id"]])[0]
    assert job["status"] == "done"
    assert job["result"]["target_met"] is False


def test_compress_target_with_downscale(user_client):
    asset = upload_ok(user_client, noisy_image_bytes(quality=95), "n.jpg")
    job = run_job(user_client, "compress", {"mode": "target_size", "target_bytes": 8000}, [asset["id"]])[0]
    assert job["output_asset"]["size_bytes"] <= 8000
    assert job["result"]["downscaled"] is True
    assert job["output_asset"]["width"] < 800


def test_compress_keeps_original_when_bigger(user_client):
    data = noisy_image_bytes(quality=20)
    asset = upload_ok(user_client, data, "small.jpg")
    job = run_job(user_client, "compress", {"mode": "quality", "quality": 100}, [asset["id"]])[0]
    assert job["result"]["kept_original"] is True
    assert job["output_asset"]["size_bytes"] <= len(data)


def test_compress_png_colors(user_client):
    data = noisy_image_bytes(size=(300, 300), fmt="PNG")
    asset = upload_ok(user_client, data, "n.png")
    job = run_job(user_client, "compress", {"mode": "quality", "png_colors": 64}, [asset["id"]])[0]
    assert job["output_asset"]["format"] == "png"
    assert job["output_asset"]["size_bytes"] < len(data)


# --- 업스케일 --------------------------------------------------------------------

@pytest.mark.parametrize("scale", [2, 4])
def test_upscale_size_and_alpha(user_client, scale):
    asset = upload_ok(user_client, image_bytes((50, 40), mode="RGBA"), "alpha.png")
    job = run_job(user_client, "upscale", {"scale": scale, "format": "png"}, [asset["id"]])[0]
    assert job["status"] == "done", job
    out = fetch_image(user_client, job["output_asset"]["id"])
    assert out.size == (50 * scale, 40 * scale)
    assert out.mode == "RGBA"
    assert out.getchannel("A").getextrema()[0] < 255


def test_upscale_input_limit(user_client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upscale_max_input_pixels_4x", 1000)
    asset = upload_ok(user_client, image_bytes((50, 40)))
    res = user_client.post("/api/jobs", json={"tool": "upscale", "params": {"scale": 4}, "asset_ids": [asset["id"]]})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "IMAGE_TOO_LARGE_FOR_UPSCALE"


def test_upscale_result_files_written(user_client):
    asset = upload_ok(user_client, image_bytes((30, 30)))
    job = run_job(user_client, "upscale", {"scale": 2, "format": "webp"}, [asset["id"]])[0]
    assert job["output_asset"]["format"] == "webp"
    assert user_client.get(f"/api/assets/{job['output_asset']['id']}/thumb").status_code == 200
    assert get_storage().exists  # 저장소 접근 가능
