import uuid
from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

OutputFormat = Literal["original", "jpg", "png", "webp"]


class UpscaleParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scale: Literal[2, 4] = 2
    style: Literal["photo", "illust"] = "photo"
    denoise: Literal["none", "low", "medium", "high"] = "medium"
    format: Literal["png", "webp", "jpg"] = "png"
    face: bool = False


class ResizeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["pixel", "percent"] = "pixel"
    width: int | None = Field(default=None, ge=1, le=20000)
    height: int | None = Field(default=None, ge=1, le=20000)
    percent: float | None = Field(default=None, gt=0, le=1000)
    # 화면 표시용. 실제 계산은 width/height 중 하나만 있으면 비율 유지, 둘 다 있으면 fit 적용
    lock_ratio: bool = True
    fit: Literal["contain", "stretch", "cover"] = "contain"
    format: OutputFormat = "original"
    quality: int = Field(default=90, ge=1, le=100)
    preset: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "pixel" and not (self.width or self.height):
            raise ValueError("가로 또는 세로 크기를 입력하세요.")
        if self.mode == "percent" and not self.percent:
            raise ValueError("비율(%)을 입력하세요.")
        return self


class CompressParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["quality", "target_size"] = "quality"
    quality: int = Field(default=75, ge=1, le=100)
    target_bytes: int | None = Field(default=None, ge=1024, le=100 * 1024 * 1024)
    format: OutputFormat = "original"
    max_side: int | None = Field(default=None, ge=16, le=20000)
    strip_metadata: bool = True
    # PNG 색상 수 줄이기. 0이면 무손실
    png_colors: Literal[0, 256, 128, 64, 32, 16] = 0
    # 목표 용량 모드에서 최저 품질로도 안 되면 해상도를 줄일지
    allow_downscale: bool = True

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "target_size" and not self.target_bytes:
            raise ValueError("목표 용량을 입력하세요.")
        return self


PARAM_MODELS: dict[str, type[BaseModel]] = {
    "upscale": UpscaleParams,
    "resize": ResizeParams,
    "compress": CompressParams,
}


class JobCreateIn(BaseModel):
    tool: Literal["upscale", "resize", "compress"]
    params: dict
    asset_ids: list[uuid.UUID] = Field(min_length=1)
    parent_job_id: uuid.UUID | None = None


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    original_filename: str | None
    mime_type: str | None
    format: str | None
    width: int | None
    height: int | None
    size_bytes: int
    expires_at: datetime | None
    created_at: datetime
    file_available: bool


class JobUser(BaseModel):
    id: uuid.UUID
    email: str
    name: str


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tool: str
    params: dict
    status: str
    progress: int
    error_message: str | None
    result: dict | None
    batch_id: uuid.UUID | None
    parent_job_id: uuid.UUID | None
    input_asset: AssetOut
    output_asset: AssetOut | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    deleted_at: datetime | None = None
    queue_position: int | None = None
    user: JobUser | None = None


class JobDetailOut(JobOut):
    parent: JobOut | None = None
    children: list[JobOut] = []


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tool: str
    total: int
    done: int
    failed: int


class JobCreateOut(BaseModel):
    batch: BatchOut | None
    jobs: list[JobOut]


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
