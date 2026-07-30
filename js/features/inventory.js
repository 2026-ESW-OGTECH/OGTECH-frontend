import { INVENTORY_ITEMS, SLOT_META } from "../data.js";
import { escapeHtml, setButtonBusy } from "../utils.js";

export const title = "의료 물품 찾기";

function normalizeItem(raw) {
  const slot = /^[A-D]$/.test(String(raw?.slot || "").toUpperCase())
    ? String(raw.slot).toUpperCase()
    : null;
  return {
    id: String(raw?.id || ""),
    slot,
    legacyLocation: raw?.cell ? `${raw.layer ?? "?"}단 ${raw.cell}칸` : null,
    name: String(raw?.name || "이름 없음"),
    quantity: Number(raw?.quantity ?? 0),
    expiry: raw?.expiry || raw?.expiry_date || null,
    expired: Boolean(raw?.expired),
    available: raw?.available ?? Number(raw?.quantity ?? 0) > 0,
    autoOpenAllowed: raw?.autoOpenAllowed ?? raw?.auto_open_allowed ?? false,
    led: raw?.led || (slot ? SLOT_META[slot].color : "#7a8b88"),
  };
}

function slotMapMarkup(items) {
  return Object.entries(SLOT_META).map(([slot, meta]) => {
    const names = items.filter((item) => item.slot === slot).map((item) => item.name);
    return `
      <div class="slot-cell" style="--slot-color: ${meta.color}">
        <strong>${slot} <small>${meta.position}</small></strong>
        <span>${names.length ? names.map(escapeHtml).join(" · ") : "등록 물품 없음"}</span>
      </div>`;
  }).join("");
}

function pickQueryItem(payload) {
  return payload?.result?.item || payload?.item || payload?.result?.matches?.[0] || null;
}

function resultMarkup(item) {
  if (!item) {
    return `
      <div class="result-box error">
        <h3>등록된 물품을 찾지 못했습니다.</h3>
        <p>물품명을 바꾸어 검색하거나 A~D 칸을 직접 확인해 주세요.</p>
      </div>`;
  }
  if (!item.slot) {
    return `
      <div class="result-box error">
        <h3>${escapeHtml(item.name)}</h3>
        <p>백엔드 위치값 <strong>${escapeHtml(item.legacyLocation || "미지정")}</strong>을 받았지만 A~D 계약으로 매핑되지 않았습니다.</p>
        <span class="state-label pending">자동 개방 차단 · 매핑 필요</span>
      </div>`;
  }
  const usable = item.available && !item.expired;
  return `
    <div class="result-box">
      <div class="result-item-head">
        <div>
          <p class="eyebrow">${SLOT_META[item.slot].position} · LED ${escapeHtml(item.led)}</p>
          <h3>${escapeHtml(item.name)}</h3>
          <p>수량 ${item.quantity}개 · ${item.expiry ? `만료 ${escapeHtml(item.expiry)}` : "만료일 없음"}</p>
        </div>
        <span class="slot-pill" style="--slot-color: ${escapeHtml(item.led)}">${item.slot}</span>
      </div>
      ${usable
        ? `<button class="button primary" id="openSlot" type="button" ${item.autoOpenAllowed ? "" : "disabled"}>${item.autoOpenAllowed ? "칸 열기 명령" : "자동 개방 불가"}</button>`
        : '<span class="state-label off">재고 없음 또는 만료 · 자동 개방 제외</span>'}
      <div id="openState" class="delivery-state">아직 명령을 보내지 않았습니다.</div>
    </div>`;
}

export async function mount(root, context) {
  const isDemo = context.getMode() === "demo";
  let items = isDemo ? INVENTORY_ITEMS.map(normalizeItem) : [];
  let selectedItem = null;

  root.innerHTML = `
    <section class="screen">
      <header class="screen-head">
        <div class="screen-head-main">
          <button class="back-button" id="back" type="button" aria-label="홈으로">‹</button>
          <div>
            <p class="eyebrow">2 × 2 고정 위치 계약</p>
            <h1>의료 물품 찾기</h1>
            <p class="screen-subtitle">위치 안내만 제공하며 복용법이나 용량은 만들지 않습니다.</p>
          </div>
        </div>
        <span class="state-label ${isDemo ? "demo" : "ok"}">${isDemo ? "DEMO 재고" : "LIVE 재고"}</span>
      </header>

      <div class="inventory-layout">
        <section class="card panel-card">
          <div class="result-item-head">
            <div>
              <h2>키트 위치</h2>
              <p class="muted small">화면, LED, STM32, 재고 DB가 모두 A~D를 사용해야 합니다.</p>
            </div>
            <span id="mapState" class="state-label ${isDemo ? "demo" : "pending"}">${isDemo ? "모의 배치" : "불러오는 중"}</span>
          </div>
          <div id="slotMap" class="slot-map">${slotMapMarkup(items)}</div>
        </section>

        <section class="card panel-card">
          <h2>물품명으로 찾기</h2>
          <label class="field-label" for="inventoryText">예: 멸균 거즈 있어?</label>
          <input id="inventoryText" type="text" autocomplete="off" maxlength="100" />
          <div class="input-actions">
            <button class="button secondary" id="inventoryVoice" type="button">음성 입력 · STT</button>
            <button class="button primary" id="search" type="button">위치 찾기</button>
          </div>
          <div id="inventoryResult" class="inventory-result"></div>
        </section>
      </div>
    </section>`;

  const map = root.querySelector("#slotMap");
  const mapState = root.querySelector("#mapState");
  const text = root.querySelector("#inventoryText");
  const result = root.querySelector("#inventoryResult");
  const searchButton = root.querySelector("#search");

  root.querySelector("#back").addEventListener("click", () => context.navigate("home"));
  root.querySelector("#inventoryVoice").addEventListener("click", () => {
    if (isDemo) {
      text.value = "멸균 거즈 있어?";
      context.showToast("DEMO 음성 문장을 입력했습니다. 실제 STT는 실행하지 않았습니다.");
      return;
    }
    context.showToast("로컬 STT API가 아직 연결되지 않았습니다.", "danger");
  });

  function bindOpenButton() {
    const openButton = result.querySelector("#openSlot");
    openButton?.addEventListener("click", async () => {
      const openState = result.querySelector("#openState");
      setButtonBusy(openButton, true, "여는 중…");
      openState.className = "delivery-state queued";
      openState.textContent = "명령 전송 중 — 센서 응답 대기";
      try {
        const payload = await context.api.openInventory(selectedItem);
        const confirmed = Boolean(payload?.opened || payload?.kit?.opened || payload?.sensor_confirmed);
        openState.className = `delivery-state ${confirmed ? "sent" : "queued"}`;
        openState.textContent = confirmed
          ? "열림 확인 — 센서 또는 STM32 ACK 수신"
          : "명령 전송됨 — 센서 확인 전이라 열림으로 표시하지 않습니다.";
      } catch (error) {
        openState.className = "delivery-state";
        openState.textContent = `열리지 않음 — ${error.message}`;
      } finally {
        setButtonBusy(openButton, false);
      }
    });
  }

  searchButton.addEventListener("click", async () => {
    const query = text.value.trim();
    if (!query) {
      context.showToast("찾을 물품명을 입력해 주세요.", "danger");
      return;
    }
    setButtonBusy(searchButton, true, "찾는 중…");
    try {
      const payload = await context.api.queryInventory(query);
      const rawItem = pickQueryItem(payload);
      selectedItem = rawItem ? normalizeItem(rawItem) : null;
      result.innerHTML = resultMarkup(selectedItem);
      bindOpenButton();
    } catch (error) {
      result.innerHTML = `<div class="result-box error"><h3>재고 API 오류</h3><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
      setButtonBusy(searchButton, false);
    }
  });

  if (!isDemo) {
    try {
      const payload = await context.api.getInventory();
      items = (payload.inventory || []).map(normalizeItem);
      map.innerHTML = slotMapMarkup(items);
      const unmapped = items.filter((item) => !item.slot).length;
      mapState.className = `state-label ${unmapped ? "pending" : "ok"}`;
      mapState.textContent = unmapped ? `A~D 미매핑 ${unmapped}개` : "A~D 매핑 정상";
    } catch (error) {
      mapState.className = "state-label off";
      mapState.textContent = "재고 API 미연결";
      context.showToast(error.message, "danger");
    }
  }
}
