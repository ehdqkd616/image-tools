"""Real-ESRGAN 계열 모델 엔진 (PyTorch + spandrel 로더). 모델 선택 근거는 docs/decisions.md 참고."""

import logging
import math
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from spandrel import ImageModelDescriptor, ModelLoader

from app.config import settings
from app.services.upscale.base import ProgressFn, UpscaleEngine

log = logging.getLogger(__name__)

MODEL_FILES = {
    "general": "realesr-general-x4v3.pth",
    "general_wdn": "realesr-general-wdn-x4v3.pth",
    "anime": "RealESRGAN_x4plus_anime_6B.pth",
}
# 사진 노이즈 제거 강도 → realesr-general-x4v3 와 wdn 모델의 가중치 보간 비율 (Real-ESRGAN의 -dn 옵션과 동일 방식)
DENOISE_STRENGTH = {"none": 0.0, "low": 0.35, "medium": 0.7, "high": 1.0}
TILE_PAD = 10
MIN_TILE = 64


def _load_state_dict(path: Path) -> dict:
    sd = torch.load(path, map_location="cpu", weights_only=True)
    for key in ("params_ema", "params"):
        if isinstance(sd, dict) and key in sd:
            return sd[key]
    return sd


class RealEsrganEngine(UpscaleEngine):
    name = "realesrgan"

    def __init__(self):
        want_cuda = settings.upscale_device == "cuda"
        if want_cuda and not torch.cuda.is_available():
            log.warning("CUDA를 사용할 수 없어 CPU로 업스케일합니다.")
        self.device = torch.device("cuda" if want_cuda and torch.cuda.is_available() else "cpu")
        self.half = settings.upscale_half and self.device.type == "cuda"
        self.tile = settings.upscale_tile_size
        self.dir = Path(settings.models_dir)
        self._general_sd = _load_state_dict(self._path("general"))
        self._wdn_sd = _load_state_dict(self._path("general_wdn"))
        self._general_cache: dict[float, ImageModelDescriptor] = {}
        self._anime = self._to_device(ModelLoader().load_from_file(self._path("anime")))
        log.info("Real-ESRGAN 엔진 준비 완료 (device=%s, half=%s)", self.device, self.half)

    def _path(self, name: str) -> Path:
        path = self.dir / MODEL_FILES[name]
        if not path.is_file():
            raise FileNotFoundError(f"모델 파일이 없습니다: {path} (scripts/download_models.py 실행)")
        return path

    def _to_device(self, desc) -> ImageModelDescriptor:
        assert isinstance(desc, ImageModelDescriptor)
        desc.to(self.device).eval()
        if self.half:
            desc.half()
        return desc

    def _general(self, strength: float) -> ImageModelDescriptor:
        if strength not in self._general_cache:
            sd = {k: strength * v + (1 - strength) * self._wdn_sd[k] for k, v in self._general_sd.items()}
            self._general_cache[strength] = self._to_device(ModelLoader().load_from_state_dict(sd))
        return self._general_cache[strength]

    def upscale_rgb(self, img, params, progress: ProgressFn):
        if params.style == "illust":
            model = self._anime
        else:
            model = self._general(DENOISE_STRENGTH[params.denoise])
        tile = self.tile
        while True:
            try:
                out = self._run_tiled(model, img, tile, progress)
                break
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                if tile // 2 < MIN_TILE:
                    raise
                tile //= 2
                log.warning("GPU 메모리 부족 → 타일 크기 %d로 재시도", tile)
        # 4x 모델로 처리했으므로 2x 요청이면 고품질 축소 (base.upscale에서 처리)
        return out

    @torch.inference_mode()
    def _run_tiled(self, model: ImageModelDescriptor, img: Image.Image, tile: int, progress: ProgressFn):
        scale = model.scale
        arr = np.asarray(img, dtype=np.float32) / 255.0
        x = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
        _, _, h, w = x.shape
        out = np.empty((h * scale, w * scale, 3), dtype=np.uint8)
        tiles_y, tiles_x = math.ceil(h / tile), math.ceil(w / tile)
        total = tiles_x * tiles_y
        dtype = torch.float16 if self.half else torch.float32
        done = 0
        for ty in range(tiles_y):
            for tx in range(tiles_x):
                x0, y0 = tx * tile, ty * tile
                x1, y1 = min(x0 + tile, w), min(y0 + tile, h)
                # 경계 이음새를 줄이기 위해 겹침 영역(pad)을 붙여서 처리 후 잘라낸다
                px0, py0 = max(x0 - TILE_PAD, 0), max(y0 - TILE_PAD, 0)
                px1, py1 = min(x1 + TILE_PAD, w), min(y1 + TILE_PAD, h)
                patch = x[:, :, py0:py1, px0:px1].to(self.device, dtype)
                res = model(patch)
                cx0, cy0 = (x0 - px0) * scale, (y0 - py0) * scale
                cx1, cy1 = cx0 + (x1 - x0) * scale, cy0 + (y1 - y0) * scale
                res = res[0, :, cy0:cy1, cx0:cx1].float().clamp_(0, 1).mul_(255).round_()
                out[y0 * scale : y1 * scale, x0 * scale : x1 * scale] = (
                    res.byte().permute(1, 2, 0).cpu().numpy()
                )
                done += 1
                progress(5 + int(done / total * 85))
        return Image.fromarray(out, "RGB")
