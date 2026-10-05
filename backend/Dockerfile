# syntax=docker/dockerfile:1

# ---- base: API, 빠른 작업 워커, 스케줄러 -------------------------------------------
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_ROOT_USER_ACTION=ignore
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN useradd --create-home --uid 1000 app && mkdir -p /data/storage /app/models_weights \
    && chown -R app:app /data /app
COPY --chown=app:app . .
USER app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

# ---- ml: AI 업스케일 워커 (PyTorch + spandrel) -------------------------------------
FROM base AS ml
USER root
# cpu | cu126 등. GTX 10xx(Pascal) 지원 여부는 docs/decisions.md 참고
ARG TORCH_INDEX=cpu
ARG TORCH_VERSION=2.14.1
ARG TORCHVISION_VERSION=0.29.1
COPY requirements-ml.txt .
# torchvision(spandrel 의존성)도 같은 인덱스에서 받아야 torch 빌드와 맞는다
RUN pip install --index-url https://download.pytorch.org/whl/${TORCH_INDEX} \
        torch==${TORCH_VERSION} torchvision==${TORCHVISION_VERSION} \
    && pip install -r requirements-ml.txt
USER app
CMD ["python", "-m", "app.workers.run", "upscale"]
