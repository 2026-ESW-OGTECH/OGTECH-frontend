import { numberInRange, setButtonBusy } from "../utils.js";

export const title = "구조 문자";

const INJURY_OPTIONS = Object.freeze([
  ["bleeding", "출혈"],
  ["burn", "화상"],
  ["fracture", "골절 의심"],
  ["unconscious", "의식 없음"],
  ["breathing", "호흡 이상"],
  ["other", "기타"],
]);

function readPayload(root) {
  return {
    recipient: root.querySelector("#recipient").value,
    latitude: null,
    longitude: null,
    position_time: null,
    manual_position: root.querySelector("#manualPosition").value.trim(),
    people_count: numberInRange(root.querySelector("#peopleCount").value, 1, 99, 1),
    injured_count: numberInRange(root.querySelector("#injuredCount").value, 0, 99, 0),
    injury_codes: [...root.querySelectorAll('input[name="injury"]:checked')].map((input) => input.value),
    mobility: root.querySelector("#mobility").value,
    request_code: root.querySelector("#requestCode").value,
    device_id: "SAFEAID-TEST",
  };
}

function composeMessage(payload) {
  const injuries = payload.injury_codes.length ? payload.injury_codes.join(", ") : "미확인";
  return `[SafeAid 구조 요청]\n위치: ${payload.manual_position || "위치 미확인"}\n인원: 총 ${payload.people_count}명 / 부상 ${payload.injured_count}명\n상태: ${injuries}\n이동: ${payload.mobility}\n요청: ${payload.request_code}\n장치: ${payload.device_id}`;
}

export function mount(root, context) {
  const isDemo = context.getMode() === "demo";
  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="홈으로">‹</button>
          <div>
            <p class="eyebrow">고정 양식 · 사용자 확인 필수</p>
            <h1>구조 문자</h1>
            <p class="screen-subtitle">신호가 없으면 전송되지 않습니다. 전송 요청과 전달 완료를 구분합니다.</p>
          </div>
        </div>
        <span class="state-label ${isDemo ? "demo" : "off"}">${isDemo ? "모의 모뎀" : "모뎀 미확인"}</span>
      </header>

      <div class="rescue-grid">
        <section class="card panel-card">
          <div class="compact-grid">
            <div class="full">
              <label class="field-label" for="situationText">상황 한 줄 설명 <span class="tag">LLM 제한 필드 추출</span></label>
              <input id="situationText" type="text" maxlength="200" placeholder="예: 2명 중 1명이 다쳐서 이동이 어려워요" />
              <button class="button secondary" id="extract" type="button" style="margin-top: 8px">제한 필드 자동 입력</button>
            </div>
            <div>
              <label class="field-label" for="recipient">수신처</label>
              <select id="recipient">
                <option value="demo-rescuer">${isDemo ? "DEMO 구조 담당자" : "구조 담당자 · 등록 필요"}</option>
                <option value="guardian">보호자 · 등록 필요</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="manualPosition">수동 위치 설명</label>
              <input id="manualPosition" type="text" maxlength="100" placeholder="예: 북한산 ○○대피소 남쪽" />
            </div>
            <div>
              <label class="field-label" for="peopleCount">총인원</label>
              <input id="peopleCount" type="number" min="1" max="99" value="1" />
            </div>
            <div>
              <label class="field-label" for="injuredCount">부상자</label>
              <input id="injuredCount" type="number" min="0" max="99" value="0" />
            </div>
            <div>
              <label class="field-label" for="mobility">이동 가능 여부</label>
              <select id="mobility">
                <option value="unknown">미확인</option>
                <option value="possible">이동 가능</option>
                <option value="difficult">이동 어려움</option>
                <option value="impossible">이동 불가</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="requestCode">필요한 도움</label>
              <select id="requestCode">
                <option value="medical">의료 도움</option>
                <option value="evacuation">이송</option>
                <option value="supplies">물품</option>
                <option value="unknown">미확인</option>
              </select>
            </div>
            <div class="full">
              <span class="field-label">상태 코드</span>
              <div class="check-grid">
                ${INJURY_OPTIONS.map(([value, label]) => `
                  <label class="check-chip">
                    <input type="checkbox" name="injury" value="${value}" />
                    <span>${label}</span>
                  </label>`).join("")}
              </div>
            </div>
          </div>
        </section>

        <section class="card panel-card">
          <div class="result-item-head">
            <div>
              <h2>전송 전 미리보기</h2>
              <p class="muted small">인원과 이동 가능 여부는 반드시 사람이 확인합니다.</p>
            </div>
            <span class="state-label off">GPS 미수신</span>
          </div>
          <pre id="preview" class="message-preview"></pre>
          <button class="button danger" id="send" type="button" style="width: 100%">구조 문자 전송 시도</button>
          <div id="deliveryState" class="delivery-state">지금은 전송 결과가 없습니다.</div>
        </section>
      </div>
    </section>`;

  const preview = root.querySelector("#preview");
  const formArea = root.querySelector(".rescue-grid");
  const updatePreview = () => {
    preview.textContent = composeMessage(readPayload(root));
  };
  updatePreview();

  root.querySelector("#back").addEventListener("click", () => context.navigate("home"));
  formArea.addEventListener("input", updatePreview);
  formArea.addEventListener("change", updatePreview);

  const extractButton = root.querySelector("#extract");
  extractButton.addEventListener("click", async () => {
    const text = root.querySelector("#situationText").value.trim();
    if (!text) {
      context.showToast("상황 설명을 먼저 입력해 주세요.", "danger");
      return;
    }
    setButtonBusy(extractButton, true, "필드 추출 중…");
    try {
      const fields = await context.api.extractRescue(text);
      root.querySelector("#peopleCount").value = fields.people_count ?? 1;
      root.querySelector("#injuredCount").value = fields.injured_count ?? 0;
      root.querySelector("#mobility").value = fields.mobility || "unknown";
      root.querySelector("#requestCode").value = fields.request_code || "unknown";
      root.querySelectorAll('input[name="injury"]').forEach((input) => {
        input.checked = (fields.injury_codes || []).includes(input.value);
      });
      updatePreview();
      context.showToast("추출값을 넣었습니다. 숫자와 상태를 직접 확인해 주세요.", "success");
    } catch (error) {
      context.showToast(`필드 추출을 사용할 수 없습니다 — ${error.message}`, "danger");
    } finally {
      setButtonBusy(extractButton, false);
    }
  });

  const sendButton = root.querySelector("#send");
  const deliveryState = root.querySelector("#deliveryState");
  sendButton.addEventListener("click", async () => {
    const payload = readPayload(root);
    if (!payload.manual_position) {
      context.showToast("GPS가 없으므로 수동 위치 설명을 입력해 주세요.", "danger");
      root.querySelector("#manualPosition").focus();
      return;
    }
    if (payload.injured_count > payload.people_count) {
      context.showToast("부상자 수는 총인원보다 많을 수 없습니다.", "danger");
      return;
    }
    setButtonBusy(sendButton, true, "전송 요청 중…");
    deliveryState.className = "delivery-state queued";
    deliveryState.textContent = "모뎀 응답 대기 중";
    try {
      const response = await context.api.sendRescue({ ...payload, message: composeMessage(payload) });
      if (response.status === "sent" || response.modem_accepted) {
        deliveryState.className = "delivery-state sent";
        deliveryState.textContent = "전송 요청됨 — 모뎀 제출 완료, 수신 확인 전";
      } else {
        deliveryState.className = "delivery-state queued";
        deliveryState.textContent = "전송 대기 중 — 신호가 생기면 다시 시도 (상대 확인 아님)";
      }
    } catch (error) {
      deliveryState.className = "delivery-state";
      deliveryState.textContent = `지금은 전송할 수 없습니다 — ${error.message}`;
    } finally {
      setButtonBusy(sendButton, false);
    }
  });

  return () => {
    formArea.replaceWith(formArea.cloneNode(true));
  };
}
