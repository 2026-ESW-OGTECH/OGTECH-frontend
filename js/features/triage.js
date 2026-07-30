export const title = "즉시 위험 확인";

const QUESTIONS = Object.freeze([
  { id: "unconscious", label: "환자가 의식이 없거나 불러도 반응이 없나요?" },
  { id: "abnormal_breathing", label: "정상적으로 숨을 쉬지 않거나 헐떡이나요?" },
  { id: "massive_bleeding", label: "직접 압박해도 대량 출혈이 멈추지 않나요?" },
]);

function questionMarkup(question) {
  return `
    <div class="triage-question" role="group" aria-labelledby="${question.id}-label">
      <strong id="${question.id}-label">${question.label}</strong>
      <div class="segmented">
        <input id="${question.id}-yes" type="radio" name="${question.id}" value="yes" />
        <label for="${question.id}-yes">예</label>
        <input id="${question.id}-no" type="radio" name="${question.id}" value="no" />
        <label for="${question.id}-no">아니오</label>
        <input id="${question.id}-unknown" type="radio" name="${question.id}" value="unknown" />
        <label for="${question.id}-unknown">모름</label>
      </div>
    </div>`;
}

export function mount(root, context) {
  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="홈으로">‹</button>
          <div>
            <p class="eyebrow">LLM보다 먼저 확인</p>
            <h1>즉시 위험 확인</h1>
            <p class="screen-subtitle">각 항목을 예, 아니오, 모름 중 하나로 답해 주세요.</p>
          </div>
        </div>
        <span class="state-label ok">고정 분기</span>
      </header>

      <div class="triage-list">${QUESTIONS.map(questionMarkup).join("")}</div>
      <div id="triageResult"></div>
      <div class="button-row" style="margin-top: 12px">
        <button class="button secondary" id="symptomHelp" type="button">위험 없음 · 증상 선택</button>
        <button class="button danger" id="evaluate" type="button">답변 확인</button>
      </div>
    </section>`;

  const result = root.querySelector("#triageResult");
  root.querySelector("#back").addEventListener("click", () => context.navigate("home"));
  root.querySelector("#symptomHelp").addEventListener("click", () => context.navigate("medical"));
  root.querySelector("#evaluate").addEventListener("click", () => {
    const answers = Object.fromEntries(
      QUESTIONS.map((question) => [question.id, root.querySelector(`input[name="${question.id}"]:checked`)?.value]),
    );
    if (Object.values(answers).some((value) => !value)) {
      context.showToast("세 항목을 모두 선택해 주세요.", "danger");
      return;
    }

    const risks = Object.entries(answers).filter(([, value]) => value === "yes").map(([key]) => key);
    if (!risks.length) {
      result.innerHTML = `
        <div class="alert-box">
          <h3>즉시 위험 신호가 선택되지 않았습니다.</h3>
          <p>증상을 직접 선택하거나 짧게 설명해 주세요. 모름을 선택한 항목은 계속 관찰하세요.</p>
          <button class="button primary" id="continueMedical" type="button">부상·증상 도움 열기</button>
        </div>`;
      result.querySelector("#continueMedical").addEventListener("click", () => context.navigate("medical"));
      return;
    }

    const cprRisk = risks.includes("unconscious") || risks.includes("abnormal_breathing");
    result.innerHTML = `
      <div class="alert-box danger">
        <h3>즉시 도움이 필요한 위험 신호입니다.</h3>
        <p>현장이 안전한지 확인하고 구조 도움을 요청하세요. 분류 모델의 결과를 기다리지 않습니다.</p>
        <div class="button-row">
          ${cprRisk ? '<button class="button danger" id="openCpr" type="button">CPR 고정 안내</button>' : ""}
          ${risks.includes("massive_bleeding") ? '<button class="button danger" id="openBleeding" type="button">출혈 고정 안내</button>' : ""}
          <button class="button secondary" id="openRescue" type="button">구조 문자 준비</button>
        </div>
      </div>`;
    result.querySelector("#openCpr")?.addEventListener("click", () => context.navigate("care", "cpr"));
    result.querySelector("#openBleeding")?.addEventListener("click", () => context.navigate("care", "bleeding"));
    result.querySelector("#openRescue")?.addEventListener("click", () => context.navigate("rescue"));
    result.scrollIntoView({ block: "nearest" });
  });
}
