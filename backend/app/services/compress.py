"""용량 줄이기 (§5.3)"""

from PIL import Image

from app.schemas.jobs import CompressParams
from app.services.image_io import Loaded, encode, output_format_for, strip_metadata_lossless
from app.services.resize import ProcessResult

QUALITY_MIN, QUALITY_MAX = 5, 95
SEARCH_STEPS = 7
PNG_COLOR_STEPS = (0, 256, 128, 64, 32, 16)
MAX_DOWNSCALE_STEPS = 6
MIN_SIDE = 16


def _shrink(img: Image.Image, max_side: int) -> Image.Image:
    if max(img.size) <= max_side:
        return img
    out = img.copy()
    out.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return out


def _search_quality(img, fmt, target, icc, exif) -> tuple[bytes, int, bool]:
    """목표 이하 중 최고 품질을 이진 탐색. (데이터, 품질, 달성여부)"""
    lo, hi = QUALITY_MIN, QUALITY_MAX
    best: tuple[bytes, int] | None = None
    smallest: tuple[bytes, int] | None = None
    for _ in range(SEARCH_STEPS):
        if lo > hi:
            break
        q = (lo + hi) // 2
        data = encode(img, fmt, quality=q, icc_profile=icc, exif=exif)
        if smallest is None or len(data) < len(smallest[0]):
            smallest = (data, q)
        if len(data) <= target:
            best = (data, q)
            lo = q + 1
        else:
            hi = q - 1
    if best is None and smallest[1] != QUALITY_MIN:
        # 최저 품질 확인
        data = encode(img, fmt, quality=QUALITY_MIN, icc_profile=icc, exif=exif)
        if len(data) <= target:
            best = (data, QUALITY_MIN)
        elif len(data) < len(smallest[0]):
            smallest = (data, QUALITY_MIN)
    if best:
        return best[0], best[1], True
    return smallest[0], smallest[1], False


def _search_png(img, target, icc, exif) -> tuple[bytes, int, bool]:
    """PNG는 품질 개념이 없으므로 색상 수를 줄여가며 시도."""
    smallest: tuple[bytes, int] | None = None
    for colors in PNG_COLOR_STEPS:
        data = encode(img, "png", png_colors=colors, icc_profile=icc, exif=exif)
        if len(data) <= target:
            return data, colors, True
        if smallest is None or len(data) < len(smallest[0]):
            smallest = (data, colors)
    return smallest[0], smallest[1], False


def run_compress(src: Loaded, p: CompressParams, original: bytes) -> ProcessResult:
    img = src.image
    if p.max_side:
        img = _shrink(img, p.max_side)
    fmt = output_format_for(src.format, p.format)
    exif = None if p.strip_metadata else src.exif
    icc = src.icc_profile
    meta: dict = {}

    if p.mode == "quality":
        data = encode(img, fmt, quality=p.quality, icc_profile=icc, exif=exif, png_colors=p.png_colors)
        meta["quality"] = p.quality if fmt != "png" else None
    else:
        target = p.target_bytes or 0
        search = (lambda im: _search_png(im, target, icc, exif)) if fmt == "png" else (
            lambda im: _search_quality(im, fmt, target, icc, exif)
        )
        data, setting, met = search(img)
        steps = 0
        downscaled = False
        best_img = img
        # 최저 품질로도 안 되면 해상도를 단계적으로 줄인다
        while not met and p.allow_downscale and steps < MAX_DOWNSCALE_STEPS:
            ratio = max(0.3, min(0.9, (target / len(data)) ** 0.5 * 0.95))
            new_size = (round(best_img.width * ratio), round(best_img.height * ratio))
            if min(new_size) < MIN_SIDE:
                break
            best_img = best_img.resize(new_size, Image.Resampling.LANCZOS)
            cand, cand_setting, met = search(best_img)
            if len(cand) < len(data) or met:
                data, setting = cand, cand_setting
                img = best_img
                downscaled = True
            steps += 1
        meta.update(
            target_bytes=target,
            target_met=len(data) <= target,
            downscaled=downscaled,
        )
        if fmt == "png":
            meta["png_colors"] = setting
        else:
            meta["quality"] = setting

    # 원본보다 커지면 원본 유지 (같은 형식이고 크기 변경이 없을 때만)
    if (
        len(data) >= len(original)
        and fmt == src.format
        and img.size == src.image.size
    ):
        kept = original if not p.strip_metadata else strip_metadata_lossless(original, fmt)
        if kept is not None and len(kept) <= len(data):
            meta["kept_original"] = True
            if p.mode == "target_size":
                meta["target_met"] = len(kept) <= (p.target_bytes or 0)
            return ProcessResult(data=kept, format=fmt, width=img.width, height=img.height, meta=meta)

    meta["larger_than_original"] = len(data) >= len(original)
    return ProcessResult(data=data, format=fmt, width=img.width, height=img.height, meta=meta)
