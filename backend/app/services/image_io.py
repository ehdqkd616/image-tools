"""이미지 검증, EXIF 방향 보정, 썸네일, 인코딩 공통 함수"""

import io
import struct
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps

from app.config import settings
from app.errors import AppError

try:  # [선택] HEIC/HEIF 입력
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover
    pass

# 압축 폭탄 방지: 이 값의 2배를 넘으면 Pillow가 DecompressionBombError를 던진다.
# 아래 probe()에서 헤더의 가로×세로를 먼저 확인하므로 실제 기준은 settings.max_image_pixels.
Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
warnings.simplefilter("error", Image.DecompressionBombWarning)

# Pillow format 이름 → 내부 이름
PIL_FORMATS = {
    "JPEG": "jpg",
    "MPO": "jpg",  # 일부 휴대폰 JPEG
    "PNG": "png",
    "WEBP": "webp",
    "GIF": "gif",
    "BMP": "bmp",
    "TIFF": "tiff",
    "HEIF": "heif",
}
MIME_TYPES = {
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
    "bmp": "image/bmp",
    "tiff": "image/tiff",
    "heif": "image/heic",
}
EXTENSIONS = {"jpg": "jpg", "png": "png", "webp": "webp", "gif": "gif", "bmp": "bmp", "tiff": "tif", "heif": "heic"}
OUTPUT_FORMATS = ("jpg", "png", "webp")

# 매직 바이트 1차 확인 (확장자 무시)
_MAGIC = (
    (b"\xff\xd8\xff", 0),
    (b"\x89PNG\r\n\x1a\n", 0),
    (b"GIF87a", 0),
    (b"GIF89a", 0),
    (b"BM", 0),
    (b"II*\x00", 0),
    (b"MM\x00*", 0),
)


def _magic_ok(data: bytes) -> bool:
    if any(data[off : off + len(sig)] == sig for sig, off in _MAGIC):
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    # HEIF/HEIC: ....ftypheic / mif1 / msf1 등
    return data[4:8] == b"ftyp"


@dataclass
class ImageInfo:
    format: str
    mime_type: str
    width: int
    height: int


def probe(data: bytes) -> ImageInfo:
    """파일 내용으로 형식 판별 + 크기 확인 + 실제 디코딩 가능 여부 검증."""
    if not _magic_ok(data):
        raise AppError("UNSUPPORTED_FORMAT", "지원하지 않는 파일 형식입니다.", 415)
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = PIL_FORMATS.get(img.format or "")
            if fmt is None:
                raise AppError("UNSUPPORTED_FORMAT", "지원하지 않는 파일 형식입니다.", 415)
            w, h = img.size
            # 디코딩 전 헤더 크기로 압축 폭탄 차단
            if w * h > settings.max_image_pixels:
                raise AppError(
                    "IMAGE_TOO_LARGE",
                    f"이미지 해상도가 너무 큽니다(최대 {settings.max_image_pixels // 1_000_000}MP).",
                    413,
                )
            orientation = img.getexif().get(0x0112, 1)
            img.load()  # 손상 파일 검출
    except AppError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise AppError("IMAGE_TOO_LARGE", "이미지 해상도가 너무 큽니다.", 413)
    except Exception:
        raise AppError("UNSUPPORTED_FORMAT", "이미지를 열 수 없습니다. 손상되었거나 지원하지 않는 형식입니다.", 415)
    if orientation in (5, 6, 7, 8):
        w, h = h, w
    return ImageInfo(format=fmt, mime_type=MIME_TYPES[fmt], width=w, height=h)


@dataclass
class Loaded:
    image: Image.Image
    format: str
    icc_profile: bytes | None
    exif: bytes | None


def load(data: bytes) -> Loaded:
    """처리용으로 열기: 첫 프레임, EXIF 방향 적용, RGB/RGBA로 정규화."""
    img = Image.open(io.BytesIO(data))
    fmt = PIL_FORMATS.get(img.format or "", "png")
    img.seek(0)  # GIF 등은 첫 프레임만
    img = ImageOps.exif_transpose(img)
    icc = img.info.get("icc_profile") if img.mode != "CMYK" else None
    exif = img.getexif()
    exif_bytes = exif.tobytes() if len(exif) else None
    return Loaded(image=normalize_mode(img), format=fmt, icc_profile=icc, exif=exif_bytes)


def has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)


def normalize_mode(img: Image.Image) -> Image.Image:
    if has_alpha(img):
        img = img.convert("RGBA")
        # 완전히 불투명하면 알파 채널 제거
        if img.getchannel("A").getextrema() == (255, 255):
            img = img.convert("RGB")
        return img
    if img.mode in ("RGB", "L"):
        return img
    return img.convert("RGB")


def flatten(img: Image.Image, background=(255, 255, 255)) -> Image.Image:
    if img.mode != "RGBA":
        return img if img.mode in ("RGB", "L") else img.convert("RGB")
    bg = Image.new("RGB", img.size, background)
    bg.paste(img, mask=img.getchannel("A"))
    return bg


def output_format_for(input_format: str, requested: str) -> str:
    if requested in OUTPUT_FORMATS:
        return requested
    return {"jpg": "jpg", "png": "png", "webp": "webp", "heif": "jpg"}.get(input_format, "png")


def encode(
    img: Image.Image,
    fmt: str,
    *,
    quality: int = 90,
    icc_profile: bytes | None = None,
    exif: bytes | None = None,
    png_colors: int = 0,
) -> bytes:
    buf = io.BytesIO()
    extra: dict = {}
    if icc_profile:
        extra["icc_profile"] = icc_profile
    if exif:
        extra["exif"] = exif
    if fmt == "jpg":
        flatten(img).save(buf, "JPEG", quality=quality, optimize=True, progressive=True, **extra)
    elif fmt == "webp":
        img.save(buf, "WEBP", quality=quality, method=6, **extra)
    elif fmt == "png":
        if png_colors:
            method = Image.Quantize.FASTOCTREE if img.mode == "RGBA" else Image.Quantize.MEDIANCUT
            img = img.quantize(colors=png_colors, method=method, dither=Image.Dither.FLOYDSTEINBERG)
        img.save(buf, "PNG", optimize=True, **extra)
    else:
        raise ValueError(f"unsupported output format: {fmt}")
    return buf.getvalue()


def make_thumbnail(img: Image.Image, max_side: int = 800) -> bytes:
    thumb = img.copy()
    thumb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, "WEBP", quality=80, method=4)
    return buf.getvalue()


# --- 무손실 메타데이터 제거 (원본 유지 시 EXIF/GPS 제거용) ------------------------

_JPEG_DROP = {0xE1, 0xED, 0xFE}  # APP1(EXIF/XMP), APP13(IPTC), COM
_PNG_DROP = {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}


def strip_metadata_lossless(data: bytes, fmt: str) -> bytes | None:
    """재인코딩 없이 메타데이터만 제거. 지원하지 않는 형식이면 None."""
    try:
        if fmt == "jpg":
            return _strip_jpeg(data)
        if fmt == "png":
            return _strip_png(data)
    except (struct.error, IndexError, ValueError):
        return None
    return None


def _strip_jpeg(data: bytes) -> bytes:
    if data[:2] != b"\xff\xd8":
        raise ValueError
    out = bytearray(b"\xff\xd8")
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            raise ValueError
        marker = data[i + 1]
        if marker == 0xDA:  # SOS 이후는 그대로
            out += data[i:]
            return bytes(out)
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out += data[i : i + 2]
            i += 2
            continue
        (length,) = struct.unpack(">H", data[i + 2 : i + 4])
        seg = data[i : i + 2 + length]
        if marker not in _JPEG_DROP:
            out += seg
        i += 2 + length
    raise ValueError


def _strip_png(data: bytes) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(sig):
        raise ValueError
    out = bytearray(sig)
    i = len(sig)
    while i < len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        ctype = data[i + 4 : i + 8]
        end = i + 12 + length
        if ctype not in _PNG_DROP:
            out += data[i:end]
        i = end
        if ctype == b"IEND":
            break
    return bytes(out)
