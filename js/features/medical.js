import { SCENARIOS, SCENARIO_ORDER } from "../data.js";
import { escapeHtml, safeScenarioId, setButtonBusy } from "../utils.js";

export const title = "부상·증상 도움";

function scenarioButtons() {
  return SCENARIO_ORDER.map((id) => {
    const item = SCENARIOS[id];
    return `
      <button class="scenario-button" type="button" data-scenario="${id}">
        <strong>${item.title}</strong>
        <span>${item.subtitle}</span>
      </button>`;
  }).join("");
}

export function mount(root, context) {
  const isDemo = context.getMode() === "demo";
  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="홈으로">‹</button>
          <div>
            <p class="eyebrow">분류 결과 → 고정 카드</p>
            <h1>부상·증상 도움</h1>
            <p class="screen-subtitle">말하기가 실패해도 오른쪽에서 직접 선택할 수 있습니다.</p>
          </div>
        </div>
        <span class="state-label ${isDemo ? "demo" : "ok"}">${isDemo ? "DEMO 분류" : "LIVE API"}</span>
      </header>

      <div class="two-column">
        <section class="card panel-card">
          <h2>상황을 짧게 설명</h2>
          <label class="field-label" for="medicalText">예: 캠핑하다 손을 베었고 피가 계속 나요</label>
          <textarea id="medicalText" rows="3" autocomplete="off" maxlength="300"></textarea>
          <div class="input-actions">
            <button class="button secondary" id="voiceInput" type="button">음성 입력 · STT</button>
            <button class="button primary" id="classify" type="button">안전 경로 분류</button>
          </div>
          <div class="feature-note">
            <span>STT는 요청할 때만 실행하며 LLM과 동시에 돌리지 않습니다.</span>
            <span class="tag ${isDemo ? "demo" : ""}">${isDemo ? "모의 입력" : "연결 필요"}</span>
          </div>
          <div id="result"></div>
        </section>

        <section class="card panel-card">
          <div class="result-item-head">
            <div>
              <h2>직접 선택</h2>
              <p class="muted small">음성을 사용할 수 없어도 카드까지 두 번의 터치로 이동합니다.</p>
            </div>
            <button class="button secondary" id="photo" type="button">사진 분석</button>
          </div>
          <div class="scenario-grid">${scenarioButtons()}</div>
        </section>
      </div>
    </section>`;

  const text = root.querySelector("#medicalText");
  const result = root.querySelector("#result");
  const classifyButton = root.querySelector("#classify");

  root.querySelector("#back").addEventListener("click", () => context.navigate("home"));
  root.querySelector("#photo").addEventListener("click", () => context.navigate("photo"));
  root.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => context.navigate("care", button.dataset.scenario));
  });

  root.querySelector("#voiceInput").addEventListener("click", () => {
    if (isDemo) {
      text.value = "손을 베었고 피가 계속 나요";
      context.showToast("DEMO 음성 문장을 입력했습니다. 실제 마이크는 사용하지 않았습니다.");
      text.focus();
      return;
    }
    context.showToast("로컬 STT API가 아직 연결되지 않았습니다.", "danger");
  });

  classifyButton.addEventListener("click", async () => {
    const value = text.value.trim();
    if (!value) {
      context.showToast("상황을 입력하거나 직접 선택해 주세요.", "danger");
      text.focus();
      return;
    }
    setButtonBusy(classifyButton, true, "분류 중…");
    result.innerHTML = "";
    try {
      const payload = await context.api.classify(value);
      const scenarioId = safeScenarioId(payload.scenario_id, SCENARIOS);
      const scenario = SCENARIOS[scenarioId];
      result.innerHTML = `
        <div class="result-box ${scenarioId === "unknown" ? "error" : ""}">
          <p class="eyebrow">${escapeHtml(payload.classifier || "local-classifier")}</p>
          <h3>${escapeHtml(scenario.title)}</h3>
          <p>${escapeHtml(scenario.subtitle)}</p>
          ${scenarioId === "unknown"
            ? '<button class="button secondary" id="chooseDirect" type="button">오른쪽에서 직접 선택</button>'
            : '<button class="button primary" id="openCard" type="button">검수된 고정 카드 열기</button>'}
        </div>`;
      result.querySelector("#openCard")?.addEventListener("click", () => context.navigate("care", scenarioId));
      result.querySelector("#chooseDirect")?.addEventListener("click", () => root.querySelector("[data-scenario]")?.focus());
    } catch (error) {
      result.innerHTML = `
        <div class="result-box error">
          <h3>분류 API에 연결할 수 없습니다.</h3>
          <p>${escapeHtml(error.message)} 직접 선택 버튼은 계속 사용할 수 있습니다.</p>
        </div>`;
    } finally {
      setButtonBusy(classifyButton, false);
    }
  });
}
