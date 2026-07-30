import { createApiClient } from "./api.js";
import { CONFIG } from "./config.js";
import { formatClock } from "./utils.js";

const root = document.querySelector("#app");
const homeButton = document.querySelector("#homeButton");
const modeButton = document.querySelector("#modeButton");
const toast = document.querySelector("#toast");
const clock = document.querySelector("#clock");

const routeLoaders = Object.freeze({
  home: () => import("./features/home.js"),
  triage: () => import("./features/triage.js"),
  medical: () => import("./features/medical.js"),
  care: () => import("./features/care.js"),
  inventory: () => import("./features/inventory.js"),
  rescue: () => import("./features/rescue.js"),
  photo: () => import("./features/photo.js"),
  diagnostics: () => import("./features/diagnostics.js"),
});

function requestedMode() {
  const queryMode = new URLSearchParams(window.location.search).get("mode");
  if (CONFIG.allowedModes.includes(queryMode)) return queryMode;
  const savedMode = window.localStorage.getItem(CONFIG.modeStorageKey);
  return CONFIG.allowedModes.includes(savedMode) ? savedMode : "demo";
}

const state = {
  mode: requestedMode(),
  systemStatus: null,
  cleanup: null,
  renderToken: 0,
};

const api = createApiClient(() => state.mode);

function showToast(message, tone = "info") {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function parseRoute() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const name = Object.prototype.hasOwnProperty.call(routeLoaders, parts[0]) ? parts[0] : "home";
  return { name, params: parts.slice(1).map(decodeURIComponent) };
}

function navigate(name, ...params) {
  const nextHash = `#/${name}${params.length ? `/${params.map(encodeURIComponent).join("/")}` : ""}`;
  if (window.location.hash === nextHash) {
    renderRoute();
    return;
  }
  window.location.hash = nextHash;
}

function updateClock() {
  clock.textContent = formatClock();
}

function setStatusChip(id, label, status) {
  const element = document.querySelector(id);
  element.className = `status-chip status-${status}`;
  element.innerHTML = `<i></i>${label}`;
}

function renderHeaderStatus() {
  modeButton.textContent = state.mode.toUpperCase();
  modeButton.classList.toggle("is-live", state.mode === "live");

  if (state.mode === "demo") {
    setStatusChip("#aiStatus", "AI 모의", "demo");
    setStatusChip("#smsStatus", "문자 모의", "demo");
    setStatusChip("#gpsStatus", "GPS 미수신", "off");
    return;
  }

  const status = state.systemStatus;
  setStatusChip("#aiStatus", status?.llm?.ok ? "AI 로컬" : "AI 미연결", status?.llm?.ok ? "ok" : "off");
  setStatusChip("#smsStatus", status?.integrations?.modem_configured ? "문자 확인 전" : "문자 미연결", status?.integrations?.modem_configured ? "idle" : "off");
  setStatusChip("#gpsStatus", status?.integrations?.gps_configured ? "GPS 확인 전" : "GPS 미수신", status?.integrations?.gps_configured ? "idle" : "off");
}

async function refreshStatus({ quiet = false } = {}) {
  try {
    state.systemStatus = await api.getSystemStatus();
    renderHeaderStatus();
    return state.systemStatus;
  } catch (error) {
    state.systemStatus = null;
    renderHeaderStatus();
    if (!quiet) showToast(error.message, "danger");
    return null;
  }
}

function setMode(mode) {
  if (!CONFIG.allowedModes.includes(mode)) return;
  state.mode = mode;
  window.localStorage.setItem(CONFIG.modeStorageKey, mode);
  state.systemStatus = null;
  renderHeaderStatus();
  refreshStatus({ quiet: true });
  renderRoute();
}

const context = Object.freeze({
  api,
  navigate,
  showToast,
  getMode: () => state.mode,
  setMode,
  getStatus: () => state.systemStatus,
  refreshStatus,
});

async function renderRoute() {
  const token = ++state.renderToken;
  state.cleanup?.();
  state.cleanup = null;
  const route = parseRoute();
  root.setAttribute("aria-busy", "true");
  root.innerHTML = '<section class="loading-screen"><strong>화면 준비 중</strong><span>로컬 자산을 불러오고 있습니다.</span></section>';

  try {
    const module = await routeLoaders[route.name]();
    if (token !== state.renderToken) return;
    const cleanup = await module.mount(root, context, route.params);
    if (typeof cleanup === "function") state.cleanup = cleanup;
    document.title = `${module.title || "SafeAid"} · SafeAid TEST UI`;
  } catch (error) {
    root.innerHTML = `
      <section class="screen error-screen">
        <p class="eyebrow">화면 오류</p>
        <h1>이 기능을 표시하지 못했습니다.</h1>
        <p>${String(error?.message || error)}</p>
        <button class="button primary" id="errorHome" type="button">홈으로</button>
      </section>`;
    document.querySelector("#errorHome")?.addEventListener("click", () => navigate("home"));
  } finally {
    root.setAttribute("aria-busy", "false");
    root.focus({ preventScroll: true });
  }
}

homeButton.addEventListener("click", () => navigate("home"));
modeButton.addEventListener("click", () => navigate("diagnostics"));
window.addEventListener("hashchange", renderRoute);

updateClock();
window.setInterval(updateClock, 60_000);
renderHeaderStatus();
refreshStatus({ quiet: true });

if (!window.location.hash) {
  navigate("home");
} else {
  renderRoute();
}
