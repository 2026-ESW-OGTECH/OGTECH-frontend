import { SCENARIOS } from "../data.js";
import { escapeHtml, setButtonBusy } from "../utils.js";

export const title = "고정 안내 카드";

export function mount(root, context, params) {
  const scenario = SCENARIOS[params[0]] || SCENARIOS.unknown;
  const supplyMarkup = scenario.supplies.length
    ? scenario.supplies.map((item) => `
        <div class="supply-item">
          <span class="slot-letter">${escapeHtml(item.slot)}</span>
          <strong>${escapeHtml(item.name)}</strong>
        </div>`).join("")
    : '<p class="muted">이 카드에 연결된 자동 개방 물품이 없습니다.</p>';

  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="이전 화면">‹</button>
          <div>
            <p class="eyebrow">검수된 고정 콘텐츠</p>
            <h1>${escapeHtml(scenario.title)}</h1>
            <p class="screen-subtitle">LLM이 처치 문장을 만들지 않습니다.</p>
          </div>
        </div>
        <span class="state-label ok">AI 생성 아님</span>
      </header>

      <div class="care-layout">
        <article class="card care-card">
          <header class="care-card-header">
            <div>
              <h2>${escapeHtml(scenario.title)}</h2>
              <p class="muted">${escapeHtml(scenario.subtitle)}</p>
            </div>
            <span class="fixed-badge">FIXED CARD</span>
          </header>
          <ol class="care-steps">
            ${scenario.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
          </ol>
          <div class="alert-box danger">
            <strong>위험 신호</strong>
            <p>${escapeHtml(scenario.danger)}</p>
          </div>
        </article>

        <aside class="card panel-card">
          <h2>물품 위치</h2>
          <p class="muted small">A~D 표시는 실제 2×2 칸 계약과 같습니다.</p>
          <div class="supply-list">${supplyMarkup}</div>
          ${scenario.supplies.length ? '<button class="button primary" id="locate" type="button">LED 위치 안내</button>' : ""}
          <div id="hardwareState" class="delivery-state">아직 명령을 보내지 않았습니다.</div>
          <div class="button-row" style="margin-top: 10px">
            <button class="button secondary" id="inventory" type="button">전체 물품</button>
            <button class="button danger" id="rescue" type="button">구조 문자</button>
          </div>
        </aside>
      </div>
    </section>`;

  root.querySelector("#back").addEventListener("click", () => context.navigate("medical"));
  root.querySelector("#inventory").addEventListener("click", () => context.navigate("inventory"));
  root.querySelector("#rescue").addEventListener("click", () => context.navigate("rescue"));

  const locate = root.querySelector("#locate");
  locate?.addEventListener("click", async () => {
    const hardwareState = root.querySelector("#hardwareState");
    setButtonBusy(locate, true, "명령 전송 중…");
    try {
      const payload = await context.api.startScenario(scenario.id);
      const confirmed = Boolean(payload?.opened || payload?.kit?.opened || payload?.sensor_confirmed);
      hardwareState.className = `delivery-state ${confirmed ? "sent" : "queued"}`;
      hardwareState.textContent = confirmed
        ? "센서가 열림을 확인했습니다."
        : "LED/칸 명령 전송됨 — 열림 센서 확인 전";
    } catch (error) {
      hardwareState.className = "delivery-state";
      hardwareState.textContent = `명령을 보내지 못했습니다 — ${error.message}`;
    } finally {
      setButtonBusy(locate, false);
    }
  });
}
