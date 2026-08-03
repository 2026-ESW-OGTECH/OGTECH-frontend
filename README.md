# SafeAid Kit Frontend

오프라인 지도와 글랜서블 상태를 표시하는 Chromium 키오스크 UI 및 backend 프록시 저장소입니다.

## 구현 상태

현재 UI는 오지 생존 도메인으로 재설계 중입니다. 기존 화면은 목표 P0 UI와 일치하지 않을 수 있으며,
구현 상태는 [조직 PLAN](https://github.com/SmartAid-Kit/.github/blob/main/PLAN.md)과 저장소 이슈에서 관리합니다.

## 목표 역할

- 지도와 현재 위치·측위 상태 표시
- 남은 일조 시간·배터리 잔여 일수·트레일 이탈 여부의 글랜서블 표시
- `DEMO` 값의 명시적 표시
- 야간 모드와 고정 안전 카드
- backend 프록시

회색 데이터 없음 상태를 녹색 정상 상태로 표시하지 않습니다. 지도·LLM·음성 처리는 자원 경쟁을 피하도록 순차 실행합니다.

## 확인

```bash
python -B -m unittest discover -s tests -v
```

실행 경로와 현재 UI의 제한 사항은 [AGENTS.md](https://github.com/SmartAid-Kit/.github/blob/main/AGENTS.md)를 따릅니다.
