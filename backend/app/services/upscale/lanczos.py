"""개발·GPU 없는 환경용 대체 엔진. AI 화질 개선 없이 LANCZOS 확대만 한다."""

from PIL import Image, ImageFilter

from app.services.upscale.base import ProgressFn, UpscaleEngine

_DENOISE_RADIUS = {"none": 0, "low": 0.4, "medium": 0.7, "high": 1.0}


class LanczosEngine(UpscaleEngine):
    name = "lanczos"

    def upscale_rgb(self, img, params, progress: ProgressFn):
        radius = _DENOISE_RADIUS[params.denoise]
        if radius:
            img = img.filter(ImageFilter.GaussianBlur(radius))
        progress(30)
        out = img.resize((img.width * params.scale, img.height * params.scale), Image.Resampling.LANCZOS)
        progress(80)
        if params.style == "illust":
            out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
        else:
            out = out.filter(ImageFilter.UnsharpMask(radius=1.5, percent=50, threshold=3))
        return out
