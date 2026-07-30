export const CONFIG = Object.freeze({
  apiRoot: "/backend/api",
  statusUrl: "/ui-api/status",
  requestTimeoutMs: 12_000,
  statusTimeoutMs: 2_500,
  photoMaxBytes: 10 * 1024 * 1024,
  modeStorageKey: "safeaid-test-ui-mode",
  allowedModes: ["demo", "live"],
});

export const ENDPOINTS = Object.freeze({
  state: "/state",
  classify: "/classify",
  inventory: "/inventory",
  inventoryQuery: "/inventory/query",
  inventoryOpen: "/inventory/open",
  start: "/start",
  vision: "/vision/upload",
  rescueExtract: "/rescue/extract",
  rescueSend: "/rescue/sms",
  stt: "/stt/transcribe",
});
