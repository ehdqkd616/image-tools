# 이미지 스튜디오

> 🔗 **배포 주소:** https://image-tools.hotgarlic.dedyn.io

사진 업로드 → **해상도 높이기(AI 업스케일) / 크기 조절 / 용량 줄이기**를 제공하는 회원 승인제 반응형 웹 서비스.
명세: [image-studio-guide.md](image-studio-guide.md) · 구현 결정: [docs/decisions.md](docs/decisions.md)

## 빠른 시작

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --email admin@example.com --name 관리자
```

브라우저에서 http://localhost:8088 (포트는 `.env`의 `WEB_PORT`).
회원가입 → 관리자 계정으로 **관리자 > 회원 관리**에서 승인 → 로그인.

기본 업스케일 엔진은 개발용 `lanczos`(AI 없음)다.

### AI 업스케일 (Real-ESRGAN, NVIDIA GPU)

```bash
python3 backend/scripts/download_models.py
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

NVIDIA Container Toolkit이 필요하다. GTX 10xx(Pascal)는 `TORCH_INDEX=cu126`(기본값)을 써야 한다.
GPU 없이 CPU로 돌리려면 `TORCH_INDEX=cpu UPSCALE_DEVICE=cpu`로 바꾸고 `docker-compose.gpu.yml`의 `deploy` 블록을 지운다.

## 구성

| 서비스 | 역할 |
|---|---|
| nginx | React 정적 파일 + `/api` 프록시, 보안 헤더 |
| api | FastAPI (`backend/app`) |
| migrate | 시작 시 `alembic upgrade head` |
| worker-fast | 크기 조절·용량 줄이기 (`fast` 큐) |
| worker | 업스케일 (`upscale` 큐, 모델 1회 로드) |
| scheduler | 매일 만료 파일 정리 (`rq cron`) |
| postgres, redis | DB, 큐 |

## 개발

```bash
# 백엔드 테스트 (postgres/redis 컨테이너 필요)
docker compose run --rm --no-deps -v "$PWD/backend:/app" api python -m pytest -q

# 프론트엔드: nginx(8088)로 /api 프록시
cd frontend && npm install && npm run dev      # http://localhost:5173
npm run typecheck && npm test

# 정리 작업 즉시 실행
docker compose exec api python -m app.cli cleanup

# 모델 변경 후 마이그레이션 생성
docker compose run --rm --no-deps -v "$PWD/backend/alembic/versions:/app/alembic/versions" migrate \
  alembic revision --autogenerate -m "설명"
```

## 운영 배포 (Caddy)

nginx는 `127.0.0.1:8088`에만 열리고, 호스트의 Caddy가 HTTPS를 맡는다.
[deploy/Caddyfile.image-tools](deploy/Caddyfile.image-tools)를 `/etc/caddy/Caddyfile`에 추가한 뒤 `sudo systemctl reload caddy`.

## 운영 전 체크
- `.env`: `APP_ENV=production`, `COOKIE_SECURE=true`, `ALLOWED_ORIGINS=https://도메인`, DB 비밀번호 변경
- HTTPS 종단 후 `nginx/default.conf`의 HSTS 주석 해제
- `STORAGE_BACKEND=s3` 및 S3 설정, DB·스토리지 백업
- 모델 가중치 상업적 이용 가능 여부 검토 ([docs/decisions.md](docs/decisions.md) §1.3)
- 약관·개인정보 처리방침 문구 전문가 검토 (`frontend/src/features/auth/AuthPages.tsx`)
