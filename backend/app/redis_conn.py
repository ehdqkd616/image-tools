import time
from functools import lru_cache

from redis import Redis

from app.config import settings
from app.errors import AppError


@lru_cache
def get_redis() -> Redis:
    return Redis.from_url(settings.redis_url)


def rate_limit(name: str, key: str, limit: int, window_seconds: int) -> None:
    """고정 창(fixed window) 속도 제한. 초과 시 RATE_LIMITED."""
    r = get_redis()
    bucket = int(time.time() // window_seconds)
    rkey = f"rl:{name}:{key}:{bucket}"
    count = r.incr(rkey)
    if count == 1:
        r.expire(rkey, window_seconds + 5)
    if count > limit:
        raise AppError("RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", 429)
