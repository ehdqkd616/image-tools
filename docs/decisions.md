# 구현 결정 기록

지침서(`image-studio-guide.md`)의 [확인 필요] 항목 확인 결과와, 지침서에 없거나 보완한 부분을 기록한다.
확인일: 2026-10-04

## 1. [확인 필요] 항목 확인 결과

### 1.1 업스케일 모델 (§5.1.3)

| 용도 | 모델 | 비고 |
|---|---|---|
| 사진 | `realesr-general-x4v3` + `realesr-general-wdn-x4v3` 가중치 보간 | 노이즈 제거 강도 = 두 모델 보간 비율 (Real-ESRGAN `-dn` 옵션과 같은 방식) |
| 일러스트 | `RealESRGAN_x4plus_anime_6B` | 노이즈 제거가 모델에 포함되어 있어 노이즈 옵션은 비활성 |

- **지침서 권장안과의 차이**: 사진에 `RealESRGAN_x4plus`/`x2plus` 대신 `realesr-general-x4v3`를 썼다.
  지침서가 검토를 요청한 "denoise strength 옵션"을 쓰려면 이 모델이어야 하고, 파라미터가 약 1.2M으로 RRDB(약 16.7M)보다 훨씬 가벼워
  GTX 1050 Ti(4GB) 같은 작은 GPU에서도 실용적이다. 노이즈 단계: 없음 0.0 / 낮음 0.35 / 중간 0.7 / 높음 1.0.
- **2배 요청**: 4배 모델로 처리한 뒤 LANCZOS로 절반 축소(지침서 방식).
- **모델 로더**: 공식 `realesrgan` 패키지는 `basicsr`가 최신 torchvision과 호환되지 않아 쓰지 않고 **spandrel 0.4.2**(MIT)를 쓴다.
  spandrel은 PyPI의 torchvision을 끌어오므로, **torch와 torchvision을 같은 PyTorch 인덱스에서 함께 설치**해야 한다(안 그러면 `torchvision::nms does not exist` 오류).
- 실측 (GTX 1050 Ti, 다른 컨테이너가 VRAM 2GB 사용 중):
  - 2000×2000 → 4000×4000 (사진 2배): 6.9초, GPU 최대 160MB
  - 1000×1000 → 4000×4000 (일러스트 4배): 타일 400에서 OOM → 자동으로 타일 200 재시도 → 8.4초 성공

### 1.2 GPU / PyTorch 호환
- PyTorch `2.14.1+cu126` 휠의 아키텍처 목록에 `sm_60`이 있어 Pascal(GTX 10xx, sm_61)에서 동작 확인.
  CUDA 12.8 이상 휠은 Pascal을 지원하지 않으므로 이 GPU에서는 `TORCH_INDEX=cu126`을 유지한다.
- Pascal은 FP16이 느려서 `UPSCALE_HALF=false`가 기본.

### 1.3 라이선스 (상업적 이용 판단 자료)
| 대상 | 라이선스 | 확인 방법 |
|---|---|---|
| Real-ESRGAN 코드 | BSD-3-Clause | GitHub 저장소 license 필드 |
| Real-ESRGAN 모델 가중치 | **별도 표기 없음** | 릴리스 노트(v0.2.2.4, v0.2.5.0)에 가중치 라이선스 문구 없음 |
| spandrel | MIT | GitHub, `pip show` |

> **남은 확인 필요**: 가중치는 저장소 라이선스(BSD-3)를 따르는 것으로 흔히 해석하지만 명시된 문구는 없고,
> 학습 데이터(DIV2K 등)에는 연구 목적 제한이 있는 것이 있다. **상업 서비스로 공개하기 전에 법률 검토가 필요하다.**

## 2. 지침서를 보완·변경한 부분

| 항목 | 내용 | 이유 |
|---|---|---|
| `assets.purged_at` 컬럼 추가 | 실제 파일이 저장소에서 지워진 시각 | 소프트 삭제(`deleted_at`)와 실제 삭제를 구분해 "파일 만료" 표시 |
| `jobs.result` (JSONB) 추가 | 적용 품질, 목표 용량 달성 여부, 원본 유지 여부, 사용 엔진 | 결과 화면 안내 문구용 |
| 오류 코드 추가 | `IMAGE_TOO_LARGE`, `FILE_EXPIRED`, `EMAIL_TAKEN`, `TOO_MANY_FILES`, `INVALID_STATE`, `VALIDATION_ERROR`, `UNAUTHORIZED` | 지침서 목록에 없는 경우 처리 |
| API 추가 | `GET /assets/{id}`, `GET /limits`, `GET /admin/jobs/{id}`, `PATCH /admin/users/{id}/quota`, `POST /admin/users/{id}/temp-password` | 이어서 작업(에셋 메타 조회), 화면의 제한 안내, [선택] 기능 |
| CSRF | SameSite=**Strict** 쿠키 + 상태 변경 요청의 Origin(없으면 Referer) 검사 | 지침서 §8의 대안 방식 |
| 속도 제한 | slowapi 대신 Redis 고정 창 카운터(`app/redis_conn.py`) | 의존성 최소화. 로그인/가입/업로드/작업 생성/ZIP에 적용 |
| 스케줄러 | RQ 2.x 내장 `rq cron` (`app/workers/cron_config.py`), 매일 04:00 UTC | RQ Scheduler 별도 패키지 불필요 |
| 워커 | `SimpleWorker`(포크 없음), `fast`/`upscale` 큐 별도 컨테이너 | 모델을 프로세스당 1회만 로드, 빠른 작업이 업스케일에 막히지 않게 |
| 부모 작업 자동 연결 | 결과 에셋을 입력으로 쓰면 그 결과를 만든 작업을 `parent_job_id`로 자동 지정 | 여러 장 이어서 작업 시에도 체인 유지 |
| 정리 작업 확장 | 작업에 쓰이지 않은 업로드 24시간 후 정리, 2시간 넘게 멈춘 처리 중 작업 실패 처리, 만료 세션 삭제 | 저장 공간·상태 누수 방지 |
| 관리자 썸네일 열람 | 감사 로그에는 **원본/결과 파일** 열람·다운로드만 기록, 썸네일은 기록 안 함 | 목록 화면마다 수십 건씩 쌓이는 것 방지 |
| 원본 유지 시 메타데이터 | 용량 줄이기 결과가 원본보다 커서 원본을 유지할 때도, 메타데이터 제거가 켜져 있으면 JPEG APP1/PNG tEXt 등을 무손실로 제거한 원본을 저장 | 위치정보 노출 방지 |
| 얼굴 보정 [선택] | 미구현 (API는 `face: true`를 거부) | 1차 범위 외 |
| 모바일 카메라 | "카메라로 촬영" 버튼 추가 (`capture="environment"`) | Android 13+ 사진 선택기에는 카메라 항목이 없음 (react-dropzone 문서) |
| URL 입력 [선택] | 미구현 | SSRF 대응이 필요해 이후 단계로 |

## 3. 라이브러리 버전 메모
- 착수 시점 최신: FastAPI 0.142, SQLAlchemy 2.1, RQ 2.12, Pillow 12.3, React 19.3, React Router 8.4, TanStack Query 5, Vite 8, TypeScript 7, Tailwind 4.3.
- Tailwind 4: `@layer components`의 클래스는 `@apply`로 조합할 수 없어 `@utility`로 정의했다.
- react-dropzone 20: `accept`에서 와일드카드 MIME에 확장자를 붙이면(`{"image/*": [".heic"]}`) 와일드카드가 빠져 JPG가 거부된다. 키를 나눠 지정한다.
