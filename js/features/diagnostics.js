import { escapeHtml, formatDateTime, setButtonBusy } from "../utils.js";

export const title = "연결 상태";

function stateLabel(ok, readyText = "정상", offText = "미연결") {
  return `<span class="state-label ${ok ? "ok" : "off"}">${ok ? readyText : offText}</span>`;
}

function statusTable(status) {
  if (!status) {
    return '<div class="alert-box danger"><h3>UI 상태 API에 연결할 수 없습니다.</h3><p>server.py 실행 여부를 확인해 주세요.</p></div>';
  }
  return `
    <table class="status-table">
      <tbody>
        <tr><th>TEST UI 서버</th><td>${stateLabel(status.ui?.ok, "정상", "오류")}</td></tr>
        <tr><th>SafeAid 백엔드</th><td>${stateLabel(status.backend?.ok, "응답", "미연결")}</td></tr>
        <tr><th>로컬 LLM health</th><td>${stateLabel(status.llm?.ok, "정상", "미연결")}</td></tr>
        <tr><th>로컬 STT</th><td>${stateLabel(status.integrations?.stt_configured, "주소 구성됨", "연결 필요")}</td></tr>
        <tr><th>GPS</th><td>${stateLabel(status.integrations?.gps_configured, "주소 구성됨", "미수신")}</td></tr>
        <tr><th>문자 모뎀</th><td>${stateLabel(status.integrations?.modem_configured, "주소 구성됨", "미연결")}</td></tr>
        <tr><th>최근 확인</th><td>${escapeHtml(formatDateTime(status.checked_at))}</td></tr>
      </tbody>
    </table>`;
}

export async function mount(root, context) {
  const mode = context.getMode();
  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="홈으로">‹</button>
          <div>
            <p class="eyebrow">설정 · 수동 확인만 수행</p>
            <h1>실행 모드와 연결 상태</h1>
            <p class="screen-subtitle">상태 확인은 화면 진입과 새로고침 때만 실행하며 상시 폴링하지 않습니다.</p>
          </div>
        </div>
        <button class="button secondary" id="refresh" type="button">상태 새로고침</button>
      </header>

      <div class="two-column">
        <section class="card panel-card">
          <h2>실행 모드</h2>
          <div class="mode-selector">
            <button class="mode-option ${mode === "demo" ? "selected" : ""}" type="button" data-mode="demo">
              <strong>DEMO</strong>
              <span>모의 분류·재고·문자 응답을 사용합니다. 모든 화면에 DEMO가 표시됩니다.</span>
            </button>
            <button class="mode-option ${mode === "live" ? "selected" : ""}" type="button" data-mode="live">
              <strong>LIVE</strong>
              <span>실제 로컬 API만 사용합니다. 실패해도 모의 데이터로 몰래 전환하지 않습니다.</span>
            </button>
          </div>
          <div class="alert-box ${mode === "demo" ? "warning" : ""}">
            <strong>${mode === "demo" ? "현재 모의 데이터 포함" : "현재 실제 응답 전용"}</strong>
            <p>${mode === "demo" ? "성능·터치 흐름 확인용이며 실제 센서 상태가 아닙니다." : "백엔드, LLM, STT, 모뎀의 미연결 상태가 그대로 표시됩니다."}</p>
          </div>
          <div id="statusTable">${statusTable(context.getStatus())}</div>
        </section>

        <section class="card panel-card">
          <h2>기능 준비 상태</h2>
          <p class="muted small">구현되지 않은 기능도 화면과 실패 상태를 미리 확인할 수 있습니다.</p>
          <ul class="capability-list">
            <li>생명위험 우선 분기 <span class="state-label ok">화면 동작</span></li>
            <li>고정 안내 카드 <span class="state-label ok">로컬 자산</span></li>
            <li>LLM 의도 분류 <span class="state-label ${mode === "demo" ? "demo" : "pending"}">${mode === "demo" ? "모의" : "API 필요"}</span></li>
            <li>A~D 재고 지도 <span class="state-label ok">화면 동작</span></li>
            <li>로컬 STT <span class="state-label off">연결 필요</span></li>
            <li>사진 위험 플래그 <span class="state-label pending">시험 기능</span></li>
            <li>GPS 위치 <span class="state-label off">연결 필요</span></li>
            <li>구조 문자 모뎀 <span class="state-label off">연결 필요</span></li>
          </ul>
          <div class="feature-note">
            <span>배터리 측정 회로가 정해지지 않아 가짜 퍼센트는 표시하지 않습니다.</span>
            <span class="tag">의도적 미표시</span>
          </div>
        </section>
      </div>
    </section>`;

  root.querySelector("#back").addEventListener("click", () => context.navigate("home"));
  root.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mode === context.getMode()) return;
      context.setMode(button.dataset.mode);
      context.showToast(`${button.dataset.mode.toUpperCase()} 모드로 전환했습니다.`, "success");
    });
  });

  const refreshButton = root.querySelector("#refresh");
  refreshButton.addEventListener("click", async () => {
    setButtonBusy(refreshButton, true, "확인 중…");
    const status = await context.refreshStatus();
    root.querySelector("#statusTable").innerHTML = statusTable(status);
    setButtonBusy(refreshButton, false);
  });

  if (!context.getStatus()) {
    const status = await context.refreshStatus({ quiet: true });
    root.querySelector("#statusTable").innerHTML = statusTable(status);
  }
}
