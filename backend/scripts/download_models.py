"""Real-ESRGAN 모델 가중치 다운로드 (표준 라이브러리만 사용)

    python3 backend/scripts/download_models.py

출처: https://github.com/xinntao/Real-ESRGAN/releases (라이선스는 docs/decisions.md 참고)
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/xinntao/Real-ESRGAN/releases/download"
MODELS = {
    "realesr-general-x4v3.pth": f"{BASE}/v0.2.5.0/realesr-general-x4v3.pth",
    "realesr-general-wdn-x4v3.pth": f"{BASE}/v0.2.5.0/realesr-general-wdn-x4v3.pth",
    "RealESRGAN_x4plus_anime_6B.pth": f"{BASE}/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
}

DEST = Path(__file__).resolve().parent.parent / "models_weights"


def main() -> None:
    DEST.mkdir(exist_ok=True)
    for name, url in MODELS.items():
        path = DEST / name
        if path.exists() and path.stat().st_size > 0:
            print(f"있음: {name}")
            continue
        print(f"다운로드: {url}")
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(url) as resp, open(tmp, "wb") as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)
        tmp.rename(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        print(f"  완료 {path.stat().st_size / 1e6:.1f}MB sha256={digest[:16]}…")
    print(f"모델 위치: {DEST}")


if __name__ == "__main__":
    sys.exit(main())
