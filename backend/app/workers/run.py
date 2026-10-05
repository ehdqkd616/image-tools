"""워커 실행: python -m app.workers.run <queue> [<queue> ...]

SimpleWorker(포크 없음)를 써서 업스케일 모델을 프로세스 시작 시 1회만 로드하고 계속 재사용한다.
"""

import logging
import sys

from rq import Queue, SimpleWorker

from app.redis_conn import get_redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    names = sys.argv[1:] or ["fast"]
    if "upscale" in names:
        from app.services.upscale import get_engine

        engine = get_engine()
        logging.info("upscale engine loaded: %s", engine.name)
    conn = get_redis()
    worker = SimpleWorker([Queue(n, connection=conn) for n in names], connection=conn)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
