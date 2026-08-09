# SafeAid 오프라인 지도·STM32 센서 앱

Jetson Xavier NX에서 STM32F401RE 센서 허브의 GPS·온습도·CO를 받아 7인치 화면에 표시하고, 오프라인
보행 지도에서 경로·트레일 이탈·일출몰·베이스캠프 귀환 권고 시각을 계산하는 로컬 앱이다.

## 화면 두 개

| URL | 용도 |
|---|---|
| `http://127.0.0.1:8790/product/` | 실제 1024×600 제품 화면 |
| `http://127.0.0.1:8790/` | 기존 지도 변환·GPS 연결 개발자 도구 |

기존 디자인과 개발자 도구는 유지했다. 제품 화면 오른쪽 위의 고정 `DEMO` 칸은 환경 계기로 바뀌었다.
재생 데이터나 샘플 지도가 실제로 사용될 때만 지도 이름 옆에 작은 `DEMO` 태그가 표시된다.

## 구현 기능

- STM32 `115200 8N1` JSONL 텔레메트리, CRC-16/CCITT-FALSE 검증
- 직렬 단선 후 2초 간격 자동 재연결 `[출처: gps_service.py]`
- Air530 fix·마지막 좌표·경과 시간·위성 수·정확도 표시
- SHT40 온도·습도와 ZE07-CO ppm·예열·경보 표시
- 센서 입력이 3초 넘게 멈추면 live 상태 해제 `[출처: gps_service.py]`
- 보행로 노드가 아니라 **선분**까지의 트레일 이탈 거리 계산
- 일출·일몰·시민박명 완전 오프라인 계산
- 베이스캠프 경로 거리 + 보행 속도 + 안전 여유로 귀환 권고 시각 계산
- 목적지·베이스캠프·체크포인트 저장 API
- CO 경보 시 브라우저 보조음. 1차 물리 경보는 STM32 단독 출력

## 실행

JetPack 5.1.x 환경에서:

```bash
cd smartaid-frontend/MAP
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python app.py --gps-mode stm32 --gps-port /dev/ttyACM0 --gps-baud 115200
```

하드웨어 없이 NMEA 경로만 확인할 때:

```bash
python app.py --gps-mode replay
```

replay는 실제 센서가 아니므로 제품 화면에 `DEMO`가 유지된다.

전체 배선, STM32 빌드, Jetson 복사 파일, systemd와 키오스크 설정은
[STM32_JETSON_SETUP.md](STM32_JETSON_SETUP.md)에 있다.

## API

| 메서드·경로 | 내용 |
|---|---|
| `GET /api/device` | 화면용 통합 센서·항법 상태 |
| `GET /api/device/events` | 통합 상태 SSE |
| `GET /api/gps` | 원시 GNSS·센서 수신 상태 |
| `GET /api/map` | 현재 지도 렌더링 표본 |
| `POST /api/route` | 명시 좌표 간 지도 엔진 경로 계산 |
| `GET /api/waypoints` | 저장 지점 조회 |
| `POST /api/waypoints` | `save_current`, `set`, `select`, `remove` |

향후 LLM은 저장된 지점의 이름/ID를 추출해 `select`만 호출할 수 있다. 좌표·거리·방위·경로·귀환 시각을
LLM이 쓰는 API는 제공하지 않는다.

## 지도 입력

- `.graphml`: WGS84 보행 그래프 권장
- `.osm`, `.xml`: 검증용 OSM XML 부분 변환
- 업로드 상한 64 MB `[추정: 검증 앱 메모리 상한]`
- 런타임 지도·저장 지점은 `runtime/`에 두고 Git에서 제외

건국대 샘플 지도와 NMEA는 공개 데모 데이터다. 실제 GPS 트랙은 커밋하지 않는다.

## 테스트

```bash
python -B -m unittest discover -s tests -v
```

테스트는 지도 회귀, NMEA/STM32 fix 호환, 텔레메트리 CRC 손상 거부, stale 센서, 선분 이탈 거리,
저장 지점·귀환 시각, 서울 일출몰과 극지 예외를 포함한다.
