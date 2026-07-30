# SafeAid TEST UI 적용법

이 폴더는 Jetson Xavier NX의 7인치 1024×600 터치 화면에서 SafeAid 동작 흐름을 먼저 검증하기 위한 경량 UI입니다. 외부 JavaScript 패키지, 웹 폰트, 이미지, 빌드 도구가 없고 Python 표준 라이브러리만 사용합니다.

## 1. 현재 들어 있는 기능

| 기능 | DEMO | LIVE 연결 상태 |
| --- | --- | --- |
| 즉시 위험 확인 | 화면 동작 | 백엔드와 무관하게 동작 |
| 증상 직접 선택·고정 안내 카드 | 화면 동작 | 백엔드와 무관하게 동작 |
| LLM 의도 분류 | 규칙 기반 모의 응답 | `POST /api/classify` 사용 |
| A~D 의료 물품 지도·검색 | 모의 재고 | `/api/inventory*` 사용 |
| LED·칸 열기 상태 | 모의 명령, 센서 미확인 표시 | `/api/start`, `/api/inventory/open` 사용 |
| 구조 문자 | 모의 대기열 상태 | 화면 제공, API 연결 필요 |
| 로컬 STT | 모의 문장 입력 | 화면 제공, API 연결 필요 |
| 사진 위험 플래그 | 모델 미실행 상태 표시 | `POST /api/vision/upload` 사용 |
| GPS·문자 모뎀 | 미연결 상태 표시 | 상태·전송 API 연결 필요 |

LIVE 모드는 API 오류가 발생해도 DEMO 데이터로 자동 전환하지 않습니다. 실제 연결 실패가 화면에 그대로 보여야 통합 시험이 정확하기 때문입니다.

배터리는 측정 회로가 정해지지 않았으므로 가짜 퍼센트를 표시하지 않습니다.

## 2. 폴더 구조와 의존성

```text
TEST_UI/
├── index.html                 # 고정 셸과 상태 표시줄
├── styles.css                 # 1024×600 우선 반응형 스타일
├── server.py                  # 정적 파일 서버 + 선택적 API 프록시
├── UI_적용법.md
├── js/
│   ├── app.js                 # 라우팅과 실행 모드만 관리
│   ├── api.js                 # DEMO/LIVE 데이터 접근 경계
│   ├── config.js              # endpoint와 제한값
│   ├── data.js                # 검수할 고정 카드·모의 데이터
│   ├── utils.js               # 작은 공통 함수
│   └── features/              # 기능별 독립 화면 모듈
└── tests/test_server.py       # 외부 패키지 없는 서버 스모크 테스트
```

각 기능 화면은 필요할 때만 동적 import됩니다. 화면 모듈은 다른 기능 모듈을 직접 호출하지 않고 `app.js`의 이동 함수와 `api.js`만 사용합니다. 따라서 STT, 모뎀, 비전처럼 아직 연결되지 않은 기능을 나중에 교체해도 다른 화면을 수정할 필요가 없습니다.

## 3. PC에서 먼저 확인

PowerShell 또는 터미널에서 이 폴더로 이동합니다.

```bash
cd LLM_test/TEST_UI
python3 server.py --port 8780
```

Windows에서 `python3`가 없다면 다음처럼 실행할 수 있습니다.

```powershell
py -3 server.py --port 8780
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:8780/?mode=demo
```

정상 여부는 별도 터미널에서 확인할 수 있습니다.

```bash
curl http://127.0.0.1:8780/health
```

정상 응답:

```json
{"ok":true,"service":"safeaid-test-ui"}
```

## 4. Jetson에 폴더 복사

저장소 전체를 Jetson에 clone했다면 이 단계는 건너뜁니다. 폴더만 복사할 때는 개발 PC에서 다음 명령을 사용합니다. `<JETSON_IP>`와 `<JETSON_USER>`를 실제 값으로 바꿉니다.

```bash
scp -r LLM_test/TEST_UI <JETSON_USER>@<JETSON_IP>:~/projects/aidkit/LLM_test/
```

Jetson에서 파일을 확인합니다.

```bash
cd ~/projects/aidkit/LLM_test/TEST_UI
python3 --version
```

Python 3.8 이상이면 별도 패키지 설치 없이 실행할 수 있습니다.

## 5. Jetson 화면에 DEMO 모드로 띄우기

### 5.1 UI 서버 실행

Jetson 터미널 하나에서 다음을 실행합니다.

```bash
cd ~/projects/aidkit/LLM_test/TEST_UI
python3 server.py --host 127.0.0.1 --port 8780
```

### 5.2 Chromium 키오스크 실행

다른 터미널에서 다음을 실행합니다.

```bash
chromium-browser \
  --kiosk \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-extensions \
  --disable-sync \
  --disable-translate \
  --disable-background-networking \
  --disable-component-update \
  --disable-default-apps \
  'http://127.0.0.1:8780/?mode=demo'
```

Ubuntu 이미지에 따라 실행 파일명이 `chromium`일 수 있습니다.

```bash
command -v chromium-browser || command -v chromium
```

키오스크를 종료할 때는 `Alt+F4`를 누릅니다. UI 서버는 실행한 터미널에서 `Ctrl+C`로 종료합니다.

## 6. LIVE 모드로 띄우기

### 6.1 로컬 서비스 포트

권장 포트는 다음처럼 분리합니다.

| 서비스 | 주소 |
| --- | --- |
| TEST UI | `http://127.0.0.1:8780` |
| 기존 `smartaid-kit` 백엔드 | `http://127.0.0.1:8765` |
| `llama-server` health | `http://127.0.0.1:8080/health` |

UI와 백엔드에 같은 포트를 사용하면 실행할 수 없습니다.

### 6.2 백엔드와 LLM 실행

먼저 기존 가이드에 따라 `llama-server`와 `smartaid-kit/app.py`를 실행합니다. 두 서비스가 응답하는지 확인합니다.

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8765/api/state
```

### 6.3 TEST UI 프록시 실행

```bash
cd ~/projects/aidkit/LLM_test/TEST_UI
python3 server.py \
  --host 127.0.0.1 \
  --port 8780 \
  --backend http://127.0.0.1:8765 \
  --llm-health http://127.0.0.1:8080/health
```

다음 주소로 키오스크를 엽니다.

```text
http://127.0.0.1:8780/?mode=live
```

상단의 `LIVE` 버튼을 누르면 연결 상태 화면으로 이동합니다. 상태 확인은 화면 진입 또는 `상태 새로고침`을 누를 때만 수행합니다. LLM 추론 중에 주기적으로 health check를 보내지 않습니다.

### 6.4 현재 백엔드와의 차이

현재 `smartaid-kit` 백엔드의 재고 위치는 `1단`, `2단`, `3단` 계약입니다. TEST UI는 새 하드웨어 계약인 `A/B/C/D`만 정상 위치로 인정합니다. LIVE 응답에 `slot: "A"`부터 `slot: "D"`가 없으면 화면에 `A~D 매핑 필요`라고 표시하고 자동 개방을 차단합니다.

다음 기능은 화면은 있지만 현재 백엔드 endpoint가 없으므로 LIVE에서 실패 상태가 정상입니다.

- 로컬 STT: `POST /api/stt/transcribe`
- 구조 정보 추출: `POST /api/rescue/extract`
- 구조 문자 전송: `POST /api/rescue/sms`
- GPS 상태와 문자 모뎀 상태

서버 옵션의 `--stt-endpoint`, `--gps-endpoint`, `--modem-endpoint`에 주소를 넘기면 연결 상태 화면에 `주소 구성됨`으로 표시됩니다. 현재는 주소 구성 여부만 보여 주며 성공으로 간주하지 않습니다.

```bash
python3 server.py \
  --stt-endpoint http://127.0.0.1:8781/health \
  --gps-endpoint http://127.0.0.1:8782/health \
  --modem-endpoint http://127.0.0.1:8783/health
```

## 7. 로그인 후 자동으로 띄우기

먼저 UI 서버를 사용자 systemd 서비스로 등록합니다. `<JETSON_USER>`를 실제 계정명으로 바꿉니다.

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/safeaid-test-ui.service
```

다음 내용을 저장합니다.

```ini
[Unit]
Description=SafeAid TEST UI server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/<JETSON_USER>/projects/aidkit/LLM_test/TEST_UI
ExecStart=/usr/bin/python3 /home/<JETSON_USER>/projects/aidkit/LLM_test/TEST_UI/server.py --host 127.0.0.1 --port 8780 --backend http://127.0.0.1:8765 --llm-health http://127.0.0.1:8080/health
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

서비스를 적용합니다.

```bash
systemctl --user daemon-reload
systemctl --user enable --now safeaid-test-ui.service
systemctl --user status safeaid-test-ui.service
```

그다음 그래픽 로그인 후 Chromium이 자동 실행되도록 등록합니다.

```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/safeaid-test-ui.desktop
```

다음 내용을 저장합니다. `Exec`의 실행 파일명은 Jetson에서 확인한 이름을 사용합니다.

```ini
[Desktop Entry]
Type=Application
Name=SafeAid TEST UI
Exec=chromium-browser --kiosk --no-first-run --disable-session-crashed-bubble --disable-extensions --disable-sync --disable-translate --disable-background-networking --disable-component-update --disable-default-apps http://127.0.0.1:8780/?mode=live
X-GNOME-Autostart-enabled=true
```

자동 실행을 제거하려면 다음 두 항목을 비활성화합니다.

```bash
systemctl --user disable --now safeaid-test-ui.service
rm ~/.config/autostart/safeaid-test-ui.desktop
```

## 8. 1024×600 터치 확인

Jetson에서 실제 출력 해상도를 확인합니다.

```bash
xrandr --current
```

UI는 1024×600을 우선으로 설계했습니다. 다음 항목을 실제 손가락과 장갑 조건에서 확인합니다.

- 홈의 네 버튼이 스크롤 없이 모두 보이는가
- 주요 버튼이 최소 56×56px로 눌리는가
- 홈에서 증상 고정 카드까지 3회 이내에 도달하는가
- A~D 위치가 실제 2×2 칸과 같은가
- LIVE 연결 실패가 `정상`, `열림`, `전송 완료`로 잘못 표시되지 않는가
- 10분 이상 화면 전환 후 터치 지연이 증가하지 않는가

## 9. LLM 성능을 해치지 않기 위한 운영 규칙

- Chromium은 키오스크 한 창, 한 탭만 실행합니다.
- Jetson에서는 DevTools, VS Code GUI, 다른 브라우저 탭을 함께 열지 않습니다.
- UI는 상태를 상시 폴링하지 않습니다. 상태 화면에서 필요할 때만 새로고침합니다.
- STT와 사진 분석은 버튼을 눌렀을 때만 실행합니다.
- STT, LLM, 비전 추론은 동시에 실행하지 않고 요청 흐름대로 순차 실행합니다.
- 외부 폰트, 외부 CDN, 프레임워크 런타임을 추가하지 않습니다.
- 브라우저의 GPU 가속을 강제로 끄지 않습니다. 화면 합성이 CPU로 이동하면 오히려 전체 부하가 커질 수 있습니다.
- 메모리 판정은 `used` 하나가 아니라 `MemAvailable`, SWAP, Chromium RSS, LLM RSS를 함께 봅니다.

모니터링 예시:

```bash
free -h
ps -eo pid,comm,rss,%mem,%cpu --sort=-rss | head -n 20
sudo tegrastats --interval 1000
```

## 10. 테스트와 문제 해결

서버 스모크 테스트는 외부 패키지 없이 실행됩니다.

```bash
cd ~/projects/aidkit/LLM_test/TEST_UI
python3 -B -m unittest discover -s tests -v
```

### 화면이 열리지 않음

```bash
curl http://127.0.0.1:8780/health
ss -ltnp | grep 8780
```

### 화면은 열리지만 LIVE가 모두 미연결

```bash
curl http://127.0.0.1:8765/api/state
curl http://127.0.0.1:8080/health
```

백엔드 포트가 다르면 `server.py --backend` 값을 실제 주소로 바꿉니다.

### 수정한 JavaScript가 바로 반영되지 않음

Chromium을 종료한 뒤 다시 실행하거나 페이지를 한 번 새로고침합니다. 정적 자산 캐시는 5분으로 제한되어 있습니다.

### DEMO에서 LIVE로 바뀌지 않음

상단 `DEMO` 버튼을 누르고 `LIVE`를 선택합니다. 또는 주소 끝을 `?mode=live`로 열면 해당 모드가 저장됩니다.
