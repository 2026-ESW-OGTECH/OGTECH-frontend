import { CONFIG } from "../config.js";
import { SCENARIOS } from "../data.js";
import { escapeHtml, setButtonBusy } from "../utils.js";

export const title = "사진 분석";

export function mount(root, context) {
  const isDemo = context.getMode() === "demo";
  let selectedFile = null;
  let objectUrl = null;

  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="부상 도움으로">‹</button>
          <div>
            <p class="eyebrow">요청 시에만 실행 · 시험 기능</p>
            <h1>사진으로 보조 확인</h1>
            <p class="screen-subtitle">진단이 아니라 보수적인 위험 플래그와 사진 품질만 확인합니다.</p>
          </div>
        </div>
        <span class="state-label ${isDemo ? "demo" : "pending"}">${isDemo ? "모델 실행 안 함" : "LIVE 비전"}</span>
      </header>

      <div class="photo-layout">
        <section class="card panel-card">
          <label class="photo-drop" id="photoDrop">
            <input id="photoInput" type="file" accept="image/*" capture="environment" />
            <span id="photoPlaceholder">
              <strong>사진 선택 또는 촬영</strong>
              <span>JPG/PNG · 최대 10MB · 선택만으로는 분석하지 않습니다.</span>
            </span>
            <img id="photoPreview" class="photo-preview" alt="선택한 사진 미리보기" hidden />
          </label>
          <button class="button primary" id="analyze" type="button" style="width: 100%; margin-top: 10px">사진 분석 실행</button>
        </section>

        <section class="card panel-card">
          <h2>분석 결과</h2>
          <div class="alert-box warning">
            <strong>안전 경계</strong>
            <p>사진만으로 진단하지 않습니다. 결과는 위험 가능성 플래그이며 사용자가 고정 카드를 직접 확인합니다.</p>
          </div>
          <div id="photoResult" class="result-box">
            <p>아직 분석하지 않았습니다.</p>
          </div>
        </section>
      </div>
    </section>`;

  const input = root.querySelector("#photoInput");
  const preview = root.querySelector("#photoPreview");
  const placeholder = root.querySelector("#photoPlaceholder");
  const result = root.querySelector("#photoResult");
  const analyzeButton = root.querySelector("#analyze");

  root.querySelector("#back").addEventListener("click", () => context.navigate("medical"));
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > CONFIG.photoMaxBytes) {
      context.showToast("10MB 이하의 사진을 선택해 주세요.", "danger");
      input.value = "";
      return;
    }
    selectedFile = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    preview.hidden = false;
    placeholder.hidden = true;
    result.innerHTML = `<p>${escapeHtml(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)}MB</p>`;
  });

  analyzeButton.addEventListener("click", async () => {
    if (!selectedFile) {
      context.showToast("사진을 먼저 선택해 주세요.", "danger");
      return;
    }
    setButtonBusy(analyzeButton, true, "분석 중…");
    try {
      const payload = await context.api.analyzePhoto(selectedFile);
      const analysis = payload.analysis || {};
      const messages = analysis.messages || [];
      const suggestion = SCENARIOS[payload.suggested_scenario_id];
      result.innerHTML = `
        <p class="eyebrow">${isDemo ? "DEMO · 모델 미실행" : "로컬 비전 결과"}</p>
        <h3>${suggestion ? `${escapeHtml(suggestion.title)} 가능성 플래그` : "자동 경로 제안 없음"}</h3>
        <p>${messages.length ? messages.map(escapeHtml).join(" ") : "보수적인 위험 플래그가 반환되지 않았습니다."}</p>
        ${suggestion ? '<button class="button primary" id="openSuggestion" type="button">고정 카드 직접 열기</button>' : ""}`;
      result.querySelector("#openSuggestion")?.addEventListener("click", () => context.navigate("care", suggestion.id));
    } catch (error) {
      result.innerHTML = `<div class="result-box error"><h3>분석 API 오류</h3><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
      setButtonBusy(analyzeButton, false);
    }
  });

  return () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
