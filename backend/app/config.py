from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 공통
    app_env: Literal["development", "production", "test"] = "development"
    secret_key: str = "change-me"
    frontend_origin: str = "http://localhost:5173"
    # 쉼표로 구분한 추가 허용 Origin (nginx 접속 주소 등)
    allowed_origins: str = ""
    # HTTPS 운영 시 true (Secure 쿠키)
    cookie_secure: bool = False

    # DB / Redis
    database_url: str = "postgresql+psycopg://app:app@postgres:5432/imagestudio"
    redis_url: str = "redis://redis:6379/0"
    # 테스트에서 큐 대신 즉시 실행
    queue_sync: bool = False

    # 저장소
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_path: str = "/data/storage"
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_region: str = "auto"

    # 제한
    max_upload_mb: int = 20
    max_files_per_request: int = 20
    max_image_pixels: int = 50_000_000
    upscale_max_input_pixels_2x: int = 4_000_000
    upscale_max_input_pixels_4x: int = 1_000_000
    upscale_max_output_side: int = 8000
    default_user_quota_mb: int = 2048
    file_retention_days: int = 30
    deleted_grace_days: int = 7
    unused_upload_hours: int = 24
    session_days: int = 7
    login_max_failures: int = 5
    login_lock_minutes: int = 15

    # 업스케일
    upscale_engine: Literal["lanczos", "realesrgan"] = "lanczos"
    upscale_device: Literal["cuda", "cpu"] = "cuda"
    upscale_tile_size: int = 400
    upscale_half: bool = False
    models_dir: str = "/app/models_weights"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def origins(self) -> set[str]:
        extra = {o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()}
        return {self.frontend_origin.rstrip("/")} | extra


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
