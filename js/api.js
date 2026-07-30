import { CONFIG, ENDPOINTS } from "./config.js";
import { INVENTORY_ITEMS, classifyDemo, queryInventoryDemo } from "./data.js";
import { wait } from "./utils.js";

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.requestTimeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const detail = payload?.error || payload?.message || `요청 실패 (${response.status})`;
      throw new ApiError(detail, response.status, payload);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("응답 시간이 초과되었습니다.");
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError("로컬 API에 연결할 수 없습니다.");
  } finally {
    window.clearTimeout(timer);
  }
}

function jsonOptions(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function createApiClient(getMode) {
  const isDemo = () => getMode() === "demo";
  const apiUrl = (endpoint) => `${CONFIG.apiRoot}${endpoint}`;

  return Object.freeze({
    async getSystemStatus() {
      return fetchWithTimeout(CONFIG.statusUrl, {}, CONFIG.statusTimeoutMs);
    },

    async getState() {
      if (isDemo()) return { inventory: INVENTORY_ITEMS, source: "demo" };
      return fetchWithTimeout(apiUrl(ENDPOINTS.state));
    },

    async classify(text) {
      if (isDemo()) {
        await wait(140);
        return classifyDemo(text);
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.classify), jsonOptions({ text }));
    },

    async getInventory() {
      if (isDemo()) return { inventory: INVENTORY_ITEMS, source: "demo" };
      return fetchWithTimeout(apiUrl(ENDPOINTS.inventory));
    },

    async queryInventory(text) {
      if (isDemo()) {
        await wait(100);
        return { result: queryInventoryDemo(text), inventory: INVENTORY_ITEMS, source: "demo" };
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.inventoryQuery), jsonOptions({ text }));
    },

    async openInventory(item) {
      if (isDemo()) {
        await wait(180);
        return { command_sent: true, opened: false, sensor_confirmed: false, item };
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.inventoryOpen), jsonOptions({ item_id: item.id }));
    },

    async startScenario(scenarioId) {
      if (isDemo()) {
        await wait(120);
        return { command_sent: true, session: { scenario_id: scenarioId, source: "demo" } };
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.start), jsonOptions({ scenario_id: scenarioId, source: "touch" }));
    },

    async analyzePhoto(file) {
      if (isDemo()) {
        await wait(180);
        return {
          analysis: {
            flags: ["model_not_connected"],
            messages: ["DEMO 모드에서는 사진 분석 모델을 실행하지 않습니다."],
          },
          suggested_scenario_id: null,
          source: "demo",
        };
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.vision), {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      }, 30_000);
    },

    async extractRescue(text) {
      if (isDemo()) {
        await wait(120);
        return {
          people_count: 2,
          injured_count: 1,
          injury_codes: ["bleeding"],
          mobility: "difficult",
          request_code: "medical",
          source: "demo",
        };
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.rescueExtract), jsonOptions({ text }));
    },

    async sendRescue(payload) {
      if (isDemo()) {
        await wait(180);
        return { status: "queued", modem_accepted: false, delivered: false, source: "demo" };
      }
      return fetchWithTimeout(apiUrl(ENDPOINTS.rescueSend), jsonOptions(payload));
    },
  });
}
