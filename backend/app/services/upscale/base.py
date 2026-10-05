from abc import ABC, abstractmethod
from collections.abc import Callable

from PIL import Image

from app.schemas.jobs import UpscaleParams

ProgressFn = Callable[[int], None]


class UpscaleEngine(ABC):
    name: str = "base"

    @abstractmethod
    def upscale_rgb(self, img: Image.Image, params: UpscaleParams, progress: ProgressFn) -> Image.Image:
        """RGB 이미지를 params.scale 배로 확대한다."""

    def upscale(self, img: Image.Image, params: UpscaleParams, progress: ProgressFn) -> Image.Image:
        """알파 채널·흑백 처리를 포함한 공통 진입점."""
        mode = img.mode
        alpha = None
        if mode == "RGBA":
            alpha = img.getchannel("A")
            img = img.convert("RGB")
        elif mode != "RGB":
            img = img.convert("RGB")

        out = self.upscale_rgb(img, params, progress)
        target = (img.width * params.scale, img.height * params.scale)
        if out.size != target:
            out = out.resize(target, Image.Resampling.LANCZOS)

        if alpha is not None:
            # 알파 채널은 분리해서 별도로 확대 후 합성
            out.putalpha(alpha.resize(target, Image.Resampling.LANCZOS))
        elif mode == "L":
            out = out.convert("L")
        return out


_engine: UpscaleEngine | None = None


def get_engine() -> UpscaleEngine:
    """워커 프로세스당 1회 생성(모델 1회 로드)."""
    global _engine
    if _engine is None:
        from app.config import settings

        if settings.upscale_engine == "realesrgan":
            from app.services.upscale.realesrgan import RealEsrganEngine

            _engine = RealEsrganEngine()
        else:
            from app.services.upscale.lanczos import LanczosEngine

            _engine = LanczosEngine()
    return _engine
