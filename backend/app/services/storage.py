"""파일 저장소 추상화. STORAGE_BACKEND=local | s3"""

import os
import shutil
import tempfile
from abc import ABC, abstractmethod
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from app.config import settings

CHUNK = 1024 * 256


class Storage(ABC):
    @abstractmethod
    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None: ...

    @abstractmethod
    def get_bytes(self, key: str) -> bytes: ...

    @abstractmethod
    def iter_chunks(self, key: str) -> Iterator[bytes]: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...


class LocalStorage(Storage):
    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("invalid storage key")
        return path

    def put_bytes(self, key, data, content_type=None):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # 원자적 쓰기: 임시 파일 후 이동
        fd, tmp = tempfile.mkstemp(dir=path.parent)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)

    def get_bytes(self, key):
        return self._path(key).read_bytes()

    def iter_chunks(self, key):
        with open(self._path(key), "rb") as f:
            while chunk := f.read(CHUNK):
                yield chunk

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def exists(self, key):
        return self._path(key).is_file()

    def wipe(self):
        """테스트 전용"""
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True, exist_ok=True)


class S3Storage(Storage):
    def __init__(self):
        import boto3

        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint or None,
            aws_access_key_id=settings.s3_access_key or None,
            aws_secret_access_key=settings.s3_secret_key or None,
            region_name=settings.s3_region or None,
        )

    def put_bytes(self, key, data, content_type=None):
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)

    def get_bytes(self, key):
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def iter_chunks(self, key):
        body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        yield from body.iter_chunks(CHUNK)

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key):
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False


@lru_cache
def get_storage() -> Storage:
    if settings.storage_backend == "s3":
        return S3Storage()
    return LocalStorage(settings.local_storage_path)
