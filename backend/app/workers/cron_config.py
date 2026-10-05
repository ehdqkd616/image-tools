"""`rq cron app/workers/cron_config.py` 로 실행되는 스케줄 정의"""

from rq import cron

from app.workers.cleanup import run_cleanup

# 매일 04:00 (컨테이너 시간대, 기본 UTC)
cron.register(run_cleanup, queue_name="fast", cron="0 4 * * *", job_timeout=3600)
