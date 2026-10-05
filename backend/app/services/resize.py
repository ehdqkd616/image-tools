"""크기 조절 (§5.2)"""

from dataclasses import dataclass, field

from PIL import Image, ImageOps

from app.schemas.jobs import ResizeParams
from app.services.image_io import Loaded, encode, output_format_for


@dataclass
class ProcessResult:
    data: bytes
    format: str
    width: int
    height: int
    meta: dict = field(default_factory=dict)


def target_size(src_w: int, src_h: int, p: ResizeParams) -> tuple[int, int, str]:
    """결과 크기와 실제 적용할 맞춤 방식을 계산한다.

    - 퍼센트: 각 이미지 원본 크기에 비례
    - 가로/세로 중 하나만: 원본 비율 유지
    - 둘 다: fit 적용 (contain=안에 맞춤, stretch=늘이기, cover=잘라서 채우기)
    """
    if p.mode == "percent":
        ratio = (p.percent or 100) / 100
        return max(1, round(src_w * ratio)), max(1, round(src_h * ratio)), "stretch"
    w, h = p.width, p.height
    if w and not h:
        return w, max(1, round(src_h * w / src_w)), "stretch"
    if h and not w:
        return max(1, round(src_w * h / src_h)), h, "stretch"
    assert w and h
    if p.fit == "contain":
        scale = min(w / src_w, h / src_h)
        return max(1, round(src_w * scale)), max(1, round(src_h * scale)), "stretch"
    return w, h, p.fit


def resize_image(img: Image.Image, width: int, height: int, fit: str) -> Image.Image:
    if fit == "cover":
        return ImageOps.fit(img, (width, height), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    if (width, height) == img.size:
        return img
    # 축소·확대 모두 LANCZOS
    return img.resize((width, height), Image.Resampling.LANCZOS)


def run_resize(src: Loaded, p: ResizeParams) -> ProcessResult:
    img = src.image
    w, h, fit = target_size(img.width, img.height, p)
    out = resize_image(img, w, h, fit)
    fmt = output_format_for(src.format, p.format)
    data = encode(out, fmt, quality=p.quality, icc_profile=src.icc_profile)
    return ProcessResult(
        data=data,
        format=fmt,
        width=out.width,
        height=out.height,
        meta={"upscaled": w * h > img.width * img.height},
    )
