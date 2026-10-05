# 이미지 스튜디오(가칭) 개발 지침서

> 사진 업로드 → **해상도 높이기(AI 업스케일) / 크기 조절 / 용량 줄이기**를 제공하는 회원 승인제 반응형 웹 서비스
> 작성일: 2026-10-04 · 버전: v1.0

---

## 0. 이 문서의 사용법

- 이 문서는 사람이 직접 개발할 때, 또는 AI 코딩 도구(Claude Code 등)에 그대로 전달해 구현을 맡길 때 **단일 기준 문서**로 사용한다.
- 각 기능 항목의 **[필수]** 는 1차 출시(MVP)에 반드시 포함, **[선택]** 은 이후 단계에서 추가한다.
- **[확인 필요]** 표시는 작성자가 직접 검증하지 못한 항목이다. 구현 전에 공식 문서·저장소에서 반드시 확인한다.
- 라이브러리 버전은 고정 숫자를 적지 않았다. 착수 시점의 최신 안정 버전을 사용하고 `requirements.txt` / `package-lock.json`에 고정한다.

---

## 1. 프로젝트 개요

### 1.1 목표
1. 로그인한 **승인된 회원만** 이미지 처리 기능을 사용할 수 있다.
2. 회원가입 → **관리자 승인** → 로그인 가능.
3. 회원별 작업 기록이 저장되어 **기록 열람 / 이어서 작업 / 다운로드**가 가능하다.
4. 관리자는 **가입 승인**과 **회원별 작업 내역 조회**가 가능하다.
5. PC·모바일 모두 사용 가능한 **반응형** UI.

### 1.2 레퍼런스 분석 요약

| 레퍼런스 | 확인된 핵심 기능 | 본 프로젝트 반영 |
|---|---|---|
| iLoveIMG 업스케일 | 배율 2x / 4x 선택, 여러 이미지 드래그앤드롭, 소형 이미지(약 6MP 미만) 대상, 업로드 진행률·남은 시간 표시 | 2x/4x 배율, 다중 업로드, 진행률 표시, 입력 픽셀 상한 |
| waifu2x | 스타일(그림 / 그림·스캔 / 사진), 노이즈 감소 5단계(없음~최고), 확대(없음/1.6x/2x/4x), 출력 PNG·WebP, 크기 제한(5MB, 노이즈 감소 3000×3000, 확대 1500×1500) | 스타일·노이즈 옵션, 출력 형식 선택, 작업 유형별 크기 제한 |
| 산돌캔버스 크기 조절 | 가로·세로 픽셀 직접 입력, 원본 비율 유지(한쪽 입력 시 자동 계산), 여러 장 업로드, SNS 권장 사이즈, 클립보드·URL 입력 | 픽셀/퍼센트 입력, 비율 잠금, 프리셋, 일괄 처리, 클립보드 붙여넣기 |
| 산돌캔버스 화질 낮추기 | JPG·PNG·WebP, 품질 값 조절하며 결과 용량·선명도 확인, 여러 장 업로드 시 파일별 결과 비교 | 품질 슬라이더, 목표 용량 자동 맞춤, 전/후 비교, 파일별 결과표 |

> 레퍼런스의 UI·문구·디자인을 그대로 복제하지 않는다. 기능 흐름만 참고하고 화면은 자체 디자인으로 만든다.

---

## 2. 기술 스택 (선정 및 이유)

AI 업스케일 모델(Real-ESRGAN 등)이 Python/PyTorch 생태계에 있으므로 **이미지 처리 백엔드는 Python**, 화면은 개발자 경험이 있는 **React + TypeScript**로 구성한다.

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | **React + TypeScript + Vite** (SPA) | React 경험 활용, SSR 불필요(전 기능이 로그인 뒤에 있음), 빌드 단순 |
| 라우팅 / 데이터 | React Router, TanStack Query | 페이지 보호 라우트, 작업 상태 폴링·캐시 |
| UI / 스타일 | Tailwind CSS (+ 필요 시 shadcn/ui) | 반응형 유틸리티, 빠른 화면 구성 |
| 업로드 / 비교 | react-dropzone, 전/후 비교 슬라이더 컴포넌트(직접 구현 또는 오픈소스) | 드래그앤드롭·붙여넣기·모바일 파일 선택 |
| 백엔드 API | **Python + FastAPI** | 비동기, 자동 API 문서(OpenAPI), 타입 힌트 |
| ORM / 마이그레이션 | SQLAlchemy 2.x + Alembic | 표준적 조합 |
| DB | **PostgreSQL** | 기록·통계 쿼리, JSONB로 작업 옵션 저장 |
| 작업 큐 | **Redis + RQ** (또는 Celery) | 업스케일은 수 초~수십 초 걸리므로 비동기 처리 필수. RQ가 설정이 단순 |
| 이미지 처리 | **Pillow** (+ pillow-heif [선택], OpenCV [선택]) | 리사이즈·압축·포맷 변환 |
| AI 업스케일 | **PyTorch + Real-ESRGAN 계열 모델** | 2x/4x, 사진/일러스트 모델 분리 (상세 §5.1) |
| 파일 저장소 | 로컬 디스크(개발) → **S3 호환 스토리지**(운영: AWS S3, Cloudflare R2, MinIO 등) | 저장소 추상화 계층으로 교체 가능하게 |
| 인증 | 세션 쿠키 방식(서버 세션 또는 JWT를 **httpOnly 쿠키**에 저장), 비밀번호 **argon2** 해시 | localStorage 토큰 저장 금지(XSS 위험) |
| 배포 | **Docker Compose** (nginx + web + api + worker + postgres + redis) | 한 번에 띄우고 옮기기 쉬움 |

### 2.1 하드웨어 참고 [확인 필요]
- Real-ESRGAN은 **GPU(NVIDIA CUDA)** 에서 실용적인 속도가 나온다. CPU만으로도 동작은 하지만 큰 이미지는 매우 느릴 수 있다(정확한 시간은 환경마다 달라 직접 측정 필요).
- GPU 서버가 없으면: (1) 업스케일 입력 크기 상한을 낮추고, (2) 워커 동시 실행 수를 1로 두고, (3) 개발 단계에서는 Pillow LANCZOS 확대를 대체 엔진으로 사용한다(§5.1.4).

---

## 3. 시스템 구조

```
[브라우저 (PC/모바일)]
        │ HTTPS
   [nginx]  ── /           → React 정적 파일
        │   ── /api/*      → FastAPI
        ▼
   [FastAPI (api)] ──── PostgreSQL (회원, 작업, 파일 메타데이터, 감사 로그)
        │  └──────────── 파일 저장소 (로컬 / S3)
        │ enqueue
        ▼
   [Redis] ──► [Worker (RQ)]  ── Pillow / PyTorch(Real-ESRGAN)
                     └── 결과 파일 저장 → DB 상태 갱신
```

**작업 처리 흐름**
1. 사용자가 이미지 업로드 → `assets`에 원본 저장(상태 `uploaded`).
2. 기능·옵션 선택 후 실행 → `jobs` 레코드 생성(`queued`) → Redis 큐에 등록.
3. 워커가 처리 → 결과 파일 저장 → `jobs.status = done`, `output_asset_id` 기록.
4. 프론트엔드는 1~2초 간격 폴링(또는 SSE [선택])으로 상태·진행률 표시.
5. 완료 후 미리보기·전/후 비교·다운로드·이어서 작업.

---

## 4. 회원 / 권한 / 인증

### 4.1 회원 상태
| 상태 | 의미 | 로그인 |
|---|---|---|
| `pending` | 가입 신청, 승인 대기 | 불가 — "관리자 승인 대기 중" 안내 |
| `approved` | 승인됨 | 가능 |
| `rejected` | 가입 거절 | 불가 — 거절 안내(사유 표시 [선택]) |
| `suspended` | 이용 정지 | 불가 — 정지 안내 |

### 4.2 역할
- `user`: 일반 회원
- `admin`: 관리자 (회원 승인·정지, 전체 작업 조회)

### 4.3 기능 요구사항
- **[필수] 회원가입**: 이메일(아이디), 비밀번호(8자 이상, 영문+숫자), 이름/닉네임, 가입 목적(자유 입력, 관리자 승인 판단용 [선택]), 이용약관·개인정보 동의 체크.
  - 가입 직후 상태 `pending`, 로그인 화면으로 이동하며 "승인 후 이용 가능" 안내.
- **[필수] 로그인**: 이메일+비밀번호. 상태가 `approved`가 아니면 상태별 메시지 반환(비밀번호 일치 여부와 무관하게 상태 노출 여부는 정책 결정 — 권장: 비밀번호가 맞을 때만 상태 안내).
- **[필수] 로그아웃**, 세션 만료(예: 7일, 설정값).
- **[필수] 최초 관리자 생성**: CLI 명령으로 생성 (`python -m app.cli create-admin --email ...`). 관리자 가입 화면은 만들지 않는다.
- **[필수] 비밀번호 변경**(로그인 상태에서).
- **[선택] 비밀번호 재설정**: 이메일 발송 기능이 없으면 관리자가 임시 비밀번호를 발급.
- **[선택] 가입 승인/거절 시 이메일 알림.**
- **[필수] 로그인 시도 제한**: 동일 IP/계정 5회 연속 실패 시 일정 시간 잠금.

### 4.4 접근 제어 규칙
- 로그인·회원가입·약관 페이지를 제외한 **모든 페이지와 API는 인증 필요**.
- 모든 작업·파일 API는 **소유자 확인**(`job.user_id == current_user.id`) 필수. 관리자만 예외.
- 관리자 API는 `role == admin` 의존성(Dependency)으로 보호.
- 회원이 `suspended`로 바뀌면 기존 세션도 즉시 무효화.

---

## 5. 이미지 처리 기능 명세

### 공통 사항
- **입력 방식**: [필수] 파일 선택 / 드래그앤드롭 / 다중 선택, [필수] 클립보드 붙여넣기(PC), [선택] 이미지 URL 입력(서버에서 가져오기 — SSRF 방지 필수, §8).
- 모바일에서는 파일 선택 시 카메라·갤러리 선택이 가능하도록 `<input type="file" accept="image/*" multiple>` 사용.
- **지원 입력 형식**: JPG, PNG, WebP [필수] / GIF(첫 프레임만), BMP, TIFF, HEIC [선택].
- **기본 제한(설정값으로 관리)**: 파일당 20MB, 한 번에 20장, 아래 작업별 픽셀 제한 별도.
- **EXIF 방향 보정**: 모든 처리 전에 EXIF Orientation을 적용(휴대폰 사진이 눕는 문제 방지).
- **메타데이터**: 기본은 EXIF(위치정보 포함) 제거, 옵션으로 유지 [선택].
- **결과 화면**: 원본/결과 해상도·용량 비교, 감소율(%) 표시, 전/후 비교 슬라이더, 개별 다운로드, 다중 결과는 **ZIP 일괄 다운로드**.
- **이어서 작업**: 결과 이미지를 다른 기능의 입력으로 바로 넘기기(예: 업스케일 → 용량 줄이기).

### 5.1 해상도 높이기 (AI 업스케일)

#### 5.1.1 옵션
| 옵션 | 선택지 | 기본값 |
|---|---|---|
| 배율 | 2x, 4x | 2x |
| 스타일 | 사진 / 일러스트·그림 | 사진 |
| 노이즈 제거 | 없음 / 낮음 / 중간 / 높음 | 중간 |
| 출력 형식 | PNG / WebP / JPG(품질 90) | PNG |
| 얼굴 보정 [선택] | 끄기 / 켜기 (GFPGAN 등) | 끄기 |

#### 5.1.2 입력 제한 (설정값)
- 2x: 입력 최대 약 4MP(예: 2000×2000), 4x: 입력 최대 약 1MP(예: 1000×1000).
- 결과 이미지 최대 변 길이 상한(예: 8000px).
- 수치는 서버 GPU 메모리에 맞춰 조정. 초과 시 업로드 단계에서 안내하고 "먼저 크기 조절" 버튼 제공.

#### 5.1.3 모델 구성 (권장안) [확인 필요]
- 사진: `RealESRGAN_x4plus` (4x), `RealESRGAN_x2plus` (2x)
- 일러스트: `RealESRGAN_x4plus_anime_6B` (4x 모델로 처리 후 2x 요청이면 고품질 축소)
- 노이즈 강도 조절: `realesr-general-x4v3` 계열의 denoise strength 옵션 활용 가능 여부 검토
- 모델 로딩은 `spandrel` 같은 범용 로더 또는 공식 `realesrgan` 패키지 사용 — **어느 쪽이 현재 PyTorch 버전과 호환되는지 착수 시 확인**.
- **라이선스 확인 필수**: 코드(Real-ESRGAN: BSD-3-Clause로 알고 있음)와 **모델 가중치 각각의 라이선스**를 확인하고, 상업적 이용 가능 여부를 문서에 기록한다.
- 대안: waifu2x(nunif, `github.com/nagadomi/nunif`)의 모델을 사용하면 레퍼런스와 같은 스타일·노이즈 옵션 체계를 그대로 구현할 수 있다.

#### 5.1.4 구현 요구사항
- **타일 처리**(예: 256~512px 타일 + 겹침 영역)로 GPU 메모리 초과 방지.
- 모델은 워커 시작 시 1회 로드해 메모리에 유지.
- 투명 배경(알파 채널) PNG: 알파 채널을 분리해 별도 확대 후 합성.
- 진행률: 타일 처리 개수 기준으로 `jobs.progress`(0~100) 갱신.
- **엔진 추상화**: `UpscaleEngine` 인터페이스 → `RealEsrganEngine`, `LanczosEngine`(개발·GPU 없음용 대체). 환경변수 `UPSCALE_ENGINE`으로 선택.

### 5.2 크기 조절 (리사이즈)

#### 5.2.1 옵션
| 옵션 | 내용 |
|---|---|
| 기준 | 픽셀 지정 / 퍼센트(%) 지정 |
| 가로·세로 | 숫자 입력, **비율 잠금** 토글(한쪽 입력 시 다른 쪽 자동 계산) |
| 맞춤 방식 | 비율 유지(안에 맞춤) / 늘이기 / 잘라서 채우기(가운데 기준) |
| 프리셋 | 인스타그램 정사각형 1080×1080, 인스타 세로 1080×1350, 스토리 1080×1920, 유튜브 썸네일 1280×720, FHD 1920×1080, 프로필 400×400 등 (설정 파일로 관리) |
| 출력 형식 | 원본 유지 / JPG / PNG / WebP |
| 확대 허용 | 원본보다 크게 할 때 경고 표시("선명도가 떨어질 수 있음, 해상도 높이기 기능 권장") |

#### 5.2.2 구현 요구사항
- 리샘플링: 축소는 `LANCZOS`, 확대는 `LANCZOS`/`BICUBIC`.
- **일괄 처리**: 여러 장에 같은 설정 적용. 퍼센트 기준이면 장마다 원본 크기에 비례.
- 빠른 작업이므로 큐를 거치되 우선순위 높은 별도 큐(`fast`) 사용 권장.
- [선택] 브라우저 미리보기: 실행 전 결과 크기와 예상 모습을 클라이언트(canvas)에서 즉시 표시.

### 5.3 용량 줄이기 (압축 / 화질 낮추기)

#### 5.3.1 옵션
| 옵션 | 내용 |
|---|---|
| 모드 | **품질 직접 조절**(슬라이더 1~100) / **목표 용량 맞춤**(예: 500KB 이하) |
| 출력 형식 | 원본 유지 / JPG / WebP / PNG |
| 함께 크기 줄이기 [선택] | 긴 변 최대 px 지정 |
| 메타데이터 제거 | 기본 켜짐 |

#### 5.3.2 구현 요구사항
- JPG: `quality`, `optimize=True`, `progressive=True`.
- WebP: `quality`, `method=6`.
- PNG: 품질 개념이 없으므로 `optimize=True` + 색상 수 줄이기(팔레트 양자화, 예: 256색) 옵션. **PNG는 줄어드는 정도가 이미지마다 다르다**는 안내 문구 표시.
- **목표 용량 모드**: 품질 값을 이진 탐색(예: 5~95 사이 최대 7회)으로 목표 이하 중 최고 품질을 찾는다. 최저 품질로도 목표를 못 맞추면 해상도를 단계적으로 줄이는 옵션 제공, 그래도 실패 시 "가장 근접한 결과"와 함께 안내.
- 결과가 원본보다 커지면 원본을 유지하고 "이미 최적화된 이미지" 안내.
- 다중 파일: 파일별 원본 용량 → 결과 용량, 감소율 표로 표시.
- [선택] 품질 슬라이더를 움직일 때 실시간 예상 용량 미리보기(클라이언트 canvas `toBlob`로 근사치 계산, "예상값"으로 표기).

---

## 6. 작업 기록 / 이어서 작업 / 다운로드

### 6.1 개념 정의
- **에셋(Asset)**: 저장된 이미지 파일 1개(원본 또는 결과).
- **작업(Job)**: 입력 에셋 1개에 기능 1개를 적용한 1회 처리. 옵션은 JSON으로 저장.
- **작업 묶음(Batch)**: 한 번에 여러 장을 같은 설정으로 실행한 경우의 묶음.
- **작업 체인**: `parent_job_id`로 연결 — 업스케일 결과를 압축하면 압축 작업의 부모가 업스케일 작업.

### 6.2 회원 기능
- **[필수] 내 작업 기록 페이지**: 썸네일, 기능 종류, 옵션 요약, 상태, 원본→결과 크기/용량, 일시. 필터(기능별·기간·상태), 검색(파일명), 페이지네이션(모바일은 무한 스크롤).
- **[필수] 작업 상세**: 전/후 비교, 사용한 옵션 전체, 체인(이 결과로 이어진 작업들) 표시.
- **[필수] 이어서 작업**
  1. "이 결과로 다른 작업하기" → 결과 에셋을 입력으로 다른 기능 화면 이동.
  2. "같은 설정으로 다시 하기" → 원본 + 기존 옵션을 채운 상태로 해당 기능 화면 이동(옵션 수정 가능).
  3. 실패한 작업 "재시도".
- **[필수] 다운로드**: 개별 다운로드, 선택 항목 ZIP 다운로드, 원본 다운로드.
- **[필수] 삭제**: 작업/파일 삭제(소프트 삭제 후 일정 기간 뒤 실제 파일 삭제).
- **[필수] 저장 용량 표시**: 사용량 / 한도(예: 회원당 2GB, 설정값).

### 6.3 보관 정책 (설정값)
- 파일 보관 기간 기본 30일 → 만료 7일 전 기록 페이지에 표시, 만료 시 파일 삭제(작업 기록 메타데이터는 유지, "파일 만료" 상태).
- 회원당 저장 용량 한도 초과 시 새 작업 차단 + 정리 안내.
- 매일 1회 정리 작업(스케줄러: RQ Scheduler 또는 cron 컨테이너).

---

## 7. 관리자 기능

### 7.1 대시보드 [필수]
- 승인 대기 회원 수(배지), 오늘/이번 주 작업 수, 기능별 작업 비율, 실패율, 전체 저장 용량, 큐 대기 작업 수.

### 7.2 회원 관리 [필수]
- 목록: 이메일, 이름, 상태, 가입일, 마지막 로그인, 작업 수, 사용 용량. 상태별 탭(대기/승인/거절/정지).
- 동작: **승인 / 거절(사유 입력) / 정지 / 정지 해제**, 일괄 승인, 임시 비밀번호 발급 [선택], 회원별 용량 한도 변경 [선택].
- 회원 상세: 프로필, 상태 변경 이력, **해당 회원의 작업 기록**(회원 화면과 같은 목록 + 원본/결과 열람·다운로드).

### 7.3 전체 작업 조회 [필수]
- 모든 회원의 작업을 한 목록으로: 회원, 기능, 옵션, 상태, 처리 시간, 오류 메시지. 필터(회원·기능·상태·기간).

### 7.4 감사 로그 [필수]
- 관리자 행동(승인·거절·정지·파일 열람·다운로드) 기록: 누가, 언제, 무엇을, 대상.
- 회원 로그인 성공/실패 기록.

### 7.5 개인정보 관련 주의
- 관리자가 회원 이미지를 열람할 수 있다는 사실을 **개인정보 처리방침과 가입 동의 화면에 명시**한다.
- 관리자 파일 열람도 감사 로그에 남긴다.
- 실제 서비스로 공개 운영할 경우 개인정보보호법상 필요한 고지·동의 항목은 전문가 검토를 권장한다.

---

## 8. 보안 요구사항

| 항목 | 요구사항 |
|---|---|
| 비밀번호 | argon2id 해시, 평문 로그 금지 |
| 세션 | httpOnly + Secure + SameSite=Lax 쿠키, 상태 변경 요청에 CSRF 토큰(또는 SameSite=Strict + Origin 검사) |
| 업로드 검증 | 확장자가 아니라 **실제 파일 내용(매직 바이트) + Pillow 열기 검증**으로 판별, 허용 형식 외 거부 |
| 압축 폭탄 | Pillow `Image.MAX_IMAGE_PIXELS` 설정, 디코딩 전 헤더의 가로×세로 확인 |
| 파일명 | 저장 시 UUID 이름 사용, 원본 파일명은 DB에만 저장(다운로드 시 `Content-Disposition`으로 복원, 한글 파일명 인코딩 처리) |
| 파일 접근 | 저장소 경로 직접 노출 금지. API에서 권한 확인 후 스트리밍 또는 **짧은 만료의 서명 URL** 발급 |
| URL 입력 [선택] | SSRF 방지: http/https만, 사설 IP·localhost 차단, 리다이렉트 재검사, 크기·시간 제한 |
| 요청 제한 | 로그인, 업로드, 작업 생성 API에 속도 제한(예: slowapi) |
| 권한 | 모든 리소스 API에서 소유자 확인 — **ID만 바꿔서 남의 작업을 보는 취약점(IDOR) 테스트 필수** |
| 기타 | HTTPS 강제, 보안 헤더(CSP, X-Content-Type-Options 등), 비밀값은 `.env`로 관리하고 저장소에 커밋 금지 |

---

## 9. 데이터베이스 설계

```sql
-- 회원
users (
  id              UUID PK,
  email           VARCHAR UNIQUE NOT NULL,
  password_hash   VARCHAR NOT NULL,
  name            VARCHAR NOT NULL,
  signup_note     TEXT,                    -- 가입 목적
  role            VARCHAR NOT NULL DEFAULT 'user',      -- user | admin
  status          VARCHAR NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | suspended
  reject_reason   TEXT,
  storage_quota_bytes BIGINT NOT NULL DEFAULT 2147483648,
  storage_used_bytes  BIGINT NOT NULL DEFAULT 0,
  approved_by     UUID FK users NULL,
  approved_at     TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL
)

-- 세션 (서버 세션 방식 사용 시)
sessions (
  id UUID PK, user_id UUID FK, token_hash VARCHAR UNIQUE,
  user_agent TEXT, ip VARCHAR, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)

-- 파일
assets (
  id              UUID PK,
  user_id         UUID FK users,
  kind            VARCHAR NOT NULL,        -- original | result
  storage_key     VARCHAR NOT NULL,        -- 저장소 내부 경로
  thumb_key       VARCHAR,                 -- 썸네일 경로
  original_filename VARCHAR,
  mime_type       VARCHAR, format VARCHAR,
  width INT, height INT, size_bytes BIGINT,
  expires_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- 작업 묶음
batches (
  id UUID PK, user_id UUID FK, tool VARCHAR, params JSONB,
  total INT, done INT, failed INT, created_at TIMESTAMPTZ
)

-- 작업
jobs (
  id              UUID PK,
  user_id         UUID FK users,
  batch_id        UUID FK batches NULL,
  parent_job_id   UUID FK jobs NULL,       -- 이어서 작업 체인
  tool            VARCHAR NOT NULL,        -- upscale | resize | compress
  params          JSONB NOT NULL,          -- 옵션 전체
  input_asset_id  UUID FK assets NOT NULL,
  output_asset_id UUID FK assets NULL,
  status          VARCHAR NOT NULL,        -- queued | processing | done | failed | canceled
  progress        SMALLINT DEFAULT 0,
  error_message   TEXT,
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- 인덱스: jobs(user_id, created_at DESC), jobs(status), jobs(tool), users(status)

-- 감사 로그
audit_logs (
  id BIGSERIAL PK, actor_id UUID FK users NULL, action VARCHAR NOT NULL,
  target_type VARCHAR, target_id VARCHAR, detail JSONB, ip VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

**params 예시**
```json
// upscale
{"scale": 4, "style": "photo", "denoise": "medium", "format": "png", "face": false}
// resize
{"mode": "pixel", "width": 1080, "height": 1080, "lock_ratio": true, "fit": "cover", "format": "jpg"}
// compress
{"mode": "target_size", "target_bytes": 512000, "format": "webp", "strip_metadata": true, "max_side": null}
```

---

## 10. API 설계 (REST, prefix `/api`)

### 인증
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/auth/signup` | 가입 신청 (→ pending) |
| POST | `/auth/login` | 로그인 (approved만 성공) |
| POST | `/auth/logout` | 로그아웃 |
| GET | `/auth/me` | 내 정보 |
| PATCH | `/auth/password` | 비밀번호 변경 |

### 파일 / 작업 (회원)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/assets` | 이미지 업로드(multipart, 다중) → 에셋 정보 반환 |
| GET | `/assets/{id}/file` | 파일 다운로드(권한 확인) |
| GET | `/assets/{id}/thumb` | 썸네일 |
| POST | `/jobs` | 작업 생성 `{tool, params, asset_ids[], parent_job_id?}` → 작업/배치 반환 |
| GET | `/jobs` | 내 작업 목록 (필터: tool, status, from, to, q, page) |
| GET | `/jobs/{id}` | 작업 상세(상태·진행률 포함, 폴링용) |
| POST | `/jobs/{id}/retry` | 실패 작업 재시도 |
| POST | `/jobs/{id}/cancel` | 대기 중 작업 취소 |
| DELETE | `/jobs/{id}` | 작업 삭제 |
| POST | `/downloads/zip` | 선택한 결과들 ZIP 다운로드 `{job_ids[]}` |
| GET | `/me/storage` | 사용 용량 / 한도 |
| GET | `/presets/resize` | 크기 조절 프리셋 목록 |

### 관리자 (`role=admin`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/admin/stats` | 대시보드 통계 |
| GET | `/admin/users` | 회원 목록 (status, q, page) |
| GET | `/admin/users/{id}` | 회원 상세 |
| POST | `/admin/users/{id}/approve` | 승인 |
| POST | `/admin/users/{id}/reject` | 거절 `{reason}` |
| POST | `/admin/users/{id}/suspend` / `/unsuspend` | 정지 / 해제 |
| POST | `/admin/users/bulk-approve` | 일괄 승인 `{user_ids[]}` |
| GET | `/admin/users/{id}/jobs` | 특정 회원 작업 목록 |
| GET | `/admin/jobs` | 전체 작업 목록 |
| GET | `/admin/audit-logs` | 감사 로그 |

- 오류 응답 형식 통일: `{"error": {"code": "ACCOUNT_PENDING", "message": "관리자 승인 대기 중입니다."}}`
- 주요 오류 코드: `ACCOUNT_PENDING`, `ACCOUNT_REJECTED`, `ACCOUNT_SUSPENDED`, `INVALID_CREDENTIALS`, `FILE_TOO_LARGE`, `IMAGE_TOO_LARGE_FOR_UPSCALE`, `UNSUPPORTED_FORMAT`, `QUOTA_EXCEEDED`, `NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`

---

## 11. 화면 구성 (프론트엔드 라우트)

| 경로 | 화면 | 접근 |
|---|---|---|
| `/login` | 로그인 | 비로그인 |
| `/signup` | 회원가입 | 비로그인 |
| `/signup/done` | 가입 완료·승인 대기 안내 | 비로그인 |
| `/terms`, `/privacy` | 약관·개인정보 처리방침 | 전체 |
| `/` | 홈: 3개 기능 카드 + 최근 작업 5개 | 회원 |
| `/upscale` | 해상도 높이기 | 회원 |
| `/resize` | 크기 조절 | 회원 |
| `/compress` | 용량 줄이기 | 회원 |
| `/history` | 내 작업 기록 | 회원 |
| `/history/:jobId` | 작업 상세 | 회원 |
| `/account` | 내 정보·비밀번호·저장 용량 | 회원 |
| `/admin` | 관리자 대시보드 | 관리자 |
| `/admin/users` | 회원 관리(승인 대기 탭 기본) | 관리자 |
| `/admin/users/:id` | 회원 상세 + 작업 기록 | 관리자 |
| `/admin/jobs` | 전체 작업 | 관리자 |
| `/admin/audit` | 감사 로그 | 관리자 |

### 11.1 기능 화면 공통 레이아웃
```
[PC ≥ 1024px]
┌──────── 상단 바: 로고 | 해상도 높이기 · 크기 조절 · 용량 줄이기 · 기록 | 계정 ────────┐
│ ┌──────────── 업로드/미리보기 영역 (좌, 넓게) ───────────┐ ┌── 옵션 패널 (우) ──┐ │
│ │  드래그앤드롭 / 붙여넣기 / 파일 선택                     │ │ 배율, 스타일 ...   │ │
│ │  업로드된 파일 목록(썸네일, 크기, 제거 버튼)              │ │ [실행] 버튼        │ │
│ └──────────────────────────────────────────────────────┘ └──────────────────┘ │
│ 결과 영역: 전/후 비교 슬라이더, 파일별 결과표, [다운로드] [ZIP] [이어서 작업 ▾]       │
└────────────────────────────────────────────────────────────────────────────┘

[모바일 < 768px]
상단: 로고 + 햄버거 메뉴 (또는 하단 탭바: 홈·높이기·크기·용량·기록)
업로드 영역(전체 폭) → 옵션(아코디언) → 하단 고정 [실행] 버튼 → 결과 카드 목록
```

---

## 12. 반응형 / UX 가이드

- **중단점**: 모바일 `< 768px`, 태블릿 `768~1023px`, PC `≥ 1024px` (Tailwind `md`, `lg`).
- **모바일 우선**으로 작성하고 큰 화면에서 확장.
- 터치 대상 최소 44×44px, 입력창 글자 16px 이상(iOS 확대 방지).
- 모바일에서는 드래그앤드롭 안내 대신 "사진 선택" 버튼을 크게 노출.
- 관리자 표(table)는 모바일에서 **카드형 목록**으로 전환.
- 전/후 비교 슬라이더는 터치 드래그 지원.
- 업로드 진행률, 작업 대기 순번·진행률, 완료 토스트 알림 표시.
- 작업 중 페이지를 떠나도 작업은 계속되며, 기록 페이지에서 확인 가능하다는 안내.
- 다크 모드 [선택].
- 접근성: 이미지 대체 텍스트, 키보드 조작, 충분한 명도 대비.
- 대용량 이미지 미리보기는 서버 썸네일(긴 변 400~800px)을 사용해 모바일 데이터 절약.

---

## 13. 폴더 구조

```
image-studio/
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── default.conf
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx, App.tsx, router.tsx
│       ├── api/            # API 클라이언트, 타입
│       ├── components/     # Dropzone, CompareSlider, JobStatus, FileTable ...
│       ├── features/
│       │   ├── auth/       # 로그인, 가입
│       │   ├── upscale/
│       │   ├── resize/
│       │   ├── compress/
│       │   ├── history/
│       │   └── admin/
│       ├── hooks/          # useAuth, useJobPolling ...
│       └── styles/
└── backend/
    ├── pyproject.toml (또는 requirements.txt)
    ├── alembic/
    ├── models_weights/     # AI 모델 파일 (git 제외, 다운로드 스크립트 제공)
    └── app/
        ├── main.py         # FastAPI 앱
        ├── config.py       # 설정(환경변수)
        ├── db.py
        ├── cli.py          # create-admin 등
        ├── models/         # SQLAlchemy 모델
        ├── schemas/        # Pydantic 스키마
        ├── api/            # auth.py, assets.py, jobs.py, admin.py
        ├── services/
        │   ├── auth_service.py
        │   ├── storage.py          # LocalStorage / S3Storage
        │   ├── image_io.py         # 검증, EXIF 보정, 썸네일
        │   ├── resize.py
        │   ├── compress.py
        │   └── upscale/
        │       ├── base.py         # UpscaleEngine 인터페이스
        │       ├── realesrgan.py
        │       └── lanczos.py
        ├── workers/
        │   ├── tasks.py            # RQ 작업 함수
        │   └── cleanup.py          # 만료 파일 정리
        └── tests/
```

---

## 14. 환경 변수 (`.env.example`)

```env
# 공통
APP_ENV=development
SECRET_KEY=change-me
FRONTEND_ORIGIN=http://localhost:5173

# DB / Redis
DATABASE_URL=postgresql+psycopg://app:app@postgres:5432/imagestudio
REDIS_URL=redis://redis:6379/0

# 저장소
STORAGE_BACKEND=local            # local | s3
LOCAL_STORAGE_PATH=/data/storage
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=

# 제한
MAX_UPLOAD_MB=20
MAX_FILES_PER_REQUEST=20
UPSCALE_MAX_INPUT_PIXELS_2X=4000000
UPSCALE_MAX_INPUT_PIXELS_4X=1000000
DEFAULT_USER_QUOTA_MB=2048
FILE_RETENTION_DAYS=30
SESSION_DAYS=7

# 업스케일
UPSCALE_ENGINE=lanczos           # lanczos | realesrgan
UPSCALE_DEVICE=cuda              # cuda | cpu
UPSCALE_TILE_SIZE=400
```

---

## 15. 개발 단계 (마일스톤)

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **1. 기반** | Docker Compose, FastAPI·React 뼈대, DB 마이그레이션, 저장소 추상화 | `docker compose up` 한 번으로 화면·API 접속 |
| **2. 인증·승인** | 가입/로그인/로그아웃, 상태별 로그인 차단, 관리자 CLI, 관리자 회원 승인 화면 | pending 회원 로그인 불가 → 관리자 승인 후 로그인 성공 |
| **3. 업로드·작업 큐** | 업로드 검증, 썸네일, jobs 생성, RQ 워커, 상태 폴링 | 업로드 후 작업 상태가 queued→done으로 변화 |
| **4. 크기 조절·용량 줄이기** | §5.2, §5.3 전체 | 픽셀/퍼센트/프리셋, 목표 용량 맞춤 동작 |
| **5. 업스케일** | Lanczos 엔진 → Real-ESRGAN 엔진, 타일 처리, 진행률 | 2x/4x, 사진/일러스트, 큰 이미지에서 메모리 오류 없음 |
| **6. 기록·이어서 작업·다운로드** | §6 전체, ZIP, 보관 정책 정리 작업 | 기록에서 재실행·체인·ZIP 다운로드 동작 |
| **7. 관리자 확장** | 대시보드, 회원별 작업 조회, 전체 작업, 감사 로그 | 관리자 행동이 감사 로그에 기록 |
| **8. 반응형·마감** | 모바일 화면 점검, 오류 메시지, 속도 제한, 보안 헤더 | §16 체크리스트 통과 |
| **9. 배포** | HTTPS, 운영용 S3, 백업, 모니터링 | 운영 서버에서 전체 흐름 동작 |

---

## 16. 테스트 / 완료 체크리스트

### 자동 테스트 (pytest, 프론트는 Vitest + Playwright [선택])
- [ ] 상태별 로그인: pending / rejected / suspended 거부, approved 성공
- [ ] 정지 처리 시 기존 세션 즉시 무효화
- [ ] 다른 회원의 job·asset ID로 접근 시 403/404 (IDOR)
- [ ] 일반 회원이 `/admin/*` 접근 시 403
- [ ] 확장자를 바꾼 비이미지 파일 업로드 거부
- [ ] 초대형 픽셀 이미지(압축 폭탄) 거부
- [ ] 리사이즈: 비율 잠금 계산, 퍼센트, 각 맞춤 방식의 결과 크기 정확성
- [ ] 압축: 목표 용량 모드가 목표 이하 결과 생성 / 불가능 시 안내
- [ ] 업스케일: 결과 크기 = 입력 × 배율, 알파 채널 유지
- [ ] EXIF 방향 보정 적용
- [ ] 용량 한도 초과 시 작업 차단
- [ ] 만료 정리 작업이 파일만 삭제하고 기록은 유지

### 수동 점검
- [ ] iPhone Safari, Android Chrome, PC Chrome/Edge에서 전체 흐름
- [ ] 모바일 갤러리·카메라 업로드
- [ ] 한글 파일명 다운로드 시 이름 깨짐 없음
- [ ] 느린 네트워크에서 업로드 진행률 표시
- [ ] 관리자 표 모바일 카드 전환

---

## 17. 향후 확장 아이디어 [선택]
- 배경 제거, 자르기, 회전, 포맷 변환, 워터마크 등 기능 추가(작업 구조가 `tool` + `params`라 확장이 쉬움)
- 회원 등급별 한도(일일 작업 수, 용량)
- 이메일 알림(승인, 작업 완료)
- SSE/WebSocket 실시간 진행률
- 소셜 로그인(가입 후에도 관리자 승인 유지)
- 외부 API 제공(API 키 발급)

---

## 부록 A. AI 코딩 도구에 전달할 때 권장 지시문

```
이 저장소의 docs/image-studio-guide.md 지침서를 기준으로 구현해줘.
- §15의 단계 순서대로 진행하고, 각 단계가 끝나면 완료 기준을 직접 실행해 확인한 뒤 다음 단계로 넘어가.
- [확인 필요] 항목은 공식 문서/저장소를 확인하고 결과를 docs/decisions.md에 기록해.
- 지침서와 다르게 구현해야 할 이유가 생기면 임의로 바꾸지 말고 먼저 알려줘.
- 비밀값은 .env에만 두고 커밋하지 마.
```

## 부록 B. 레퍼런스
- iLoveIMG 이미지 업스케일: https://www.iloveimg.com/ko/upscale-image
- waifu2x: https://www.waifu2x.net/index.ko.html (소스: https://github.com/nagadomi/nunif)
- 산돌캔버스 이미지 크기 조절: https://www.sandollcloud.com/sdcanvas/image-resize
- 산돌캔버스 사진 화질 낮추기: https://www.sandollcloud.com/sdcanvas/photo-quality-reduce
- Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN
