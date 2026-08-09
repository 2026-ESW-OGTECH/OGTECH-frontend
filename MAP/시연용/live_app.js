/* SafeAid 실시간 제품 화면.
 * 센서·경로·일출몰 값은 /api/device가 계산하며 이 파일은 표시와 명시적 지점 선택만 담당합니다.
 */

"use strict";

const canvas = document.querySelector("#mapCanvas");
const context = canvas.getContext("2d", { alpha: false });
const fallbackMap = window.KONKUK_MAP || {
  name: "오프라인 지도 없음",
  source: "none",
  demo: true,
  bounds: { west: 126.99, east: 127.01, south: 36.99, north: 37.01 },
  trails: [],
  contours: [],
};

const state = {
  map: Object.assign({ demo: true }, fallbackMap),
  device: null,
  connected: false,
  selectingDestination: false,
  night: false,
  eventSource: null,
};

let toastTimer = null;
let alarmTimer = null;
let audioContext = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value, digits) {
  return finite(value) ? value.toFixed(digits) : "—";
}

function formatAge(value) {
  if (!finite(value)) return "—";
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.floor(value / 60)}m`;
}

function formatDuration(minutes) {
  if (!finite(minutes)) return "—";
  if (minutes <= 0) return "0분";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}:${String(rest).padStart(2, "0")}` : `${rest}분`;
}

function setGlance(selector, stateName, value, sub) {
  const element = document.querySelector(selector);
  element.dataset.state = stateName;
  element.querySelector("strong").textContent = value;
  element.querySelector(".sub").textContent = sub;
}

function showToast(message, durationMs = 1800) {
  const toast = document.querySelector("#statusToast");
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, durationMs);
}

function setNight(on) {
  state.night = Boolean(on);
  document.documentElement.dataset.night = state.night ? "on" : "off";
  document.querySelector("#btnNight").setAttribute("aria-pressed", String(state.night));
  render();
}

function resizeCanvas() {
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function makeProjector(bounds) {
  const padding = 18;
  const middleLatitude = (bounds.south + bounds.north) / 2;
  const latitudeMeters = 111132.0;
  const longitudeMeters = 111320.0 * Math.max(0.01, Math.cos(middleLatitude * Math.PI / 180));
  const mapWidthM = Math.max(1, (bounds.east - bounds.west) * longitudeMeters);
  const mapHeightM = Math.max(1, (bounds.north - bounds.south) * latitudeMeters);
  const scale = Math.min(
    (canvas.width - padding * 2) / mapWidthM,
    (canvas.height - padding * 2) / mapHeightM,
  );
  const renderedWidth = mapWidthM * scale;
  const renderedHeight = mapHeightM * scale;
  const offsetX = (canvas.width - renderedWidth) / 2;
  const offsetY = (canvas.height - renderedHeight) / 2;
  return {
    project(point) {
      return {
        x: offsetX + (point.lon - bounds.west) * longitudeMeters * scale,
        y: offsetY + (bounds.north - point.lat) * latitudeMeters * scale,
      };
    },
    unproject(x, y) {
      return {
        lon: bounds.west + (x - offsetX) / scale / longitudeMeters,
        lat: bounds.north - (y - offsetY) / scale / latitudeMeters,
      };
    },
    metersToPixels(meters) {
      return meters * scale;
    },
    inside(point) {
      return point.lon >= bounds.west && point.lon <= bounds.east
        && point.lat >= bounds.south && point.lat <= bounds.north;
    },
  };
}

function strokePath(coordinates, projector) {
  coordinates.forEach((raw, index) => {
    const point = Array.isArray(raw)
      ? { lon: Number(raw[0]), lat: Number(raw[1]) }
      : raw;
    const screen = projector.project(point);
    if (index === 0) context.moveTo(screen.x, screen.y);
    else context.lineTo(screen.x, screen.y);
  });
}

function drawMarker(point, label, color, projector, shape) {
  if (!point || !finite(Number(point.lat)) || !finite(Number(point.lon))) return;
  if (!projector.inside({ lat: Number(point.lat), lon: Number(point.lon) })) return;
  const screen = projector.project({ lat: Number(point.lat), lon: Number(point.lon) });
  context.save();
  context.fillStyle = color;
  context.strokeStyle = "#071010";
  context.lineWidth = 3;
  context.beginPath();
  if (shape === "triangle") {
    context.moveTo(screen.x, screen.y - 12);
    context.lineTo(screen.x - 11, screen.y + 10);
    context.lineTo(screen.x + 11, screen.y + 10);
    context.closePath();
  } else if (shape === "square") {
    context.rect(screen.x - 9, screen.y - 9, 18, 18);
  } else {
    context.arc(screen.x, screen.y, 10, 0, Math.PI * 2);
  }
  context.fill();
  context.stroke();
  context.font = "700 15px Arial";
  context.textBaseline = "middle";
  const textWidth = context.measureText(label).width;
  const labelX = Math.min(canvas.width - textWidth - 14, screen.x + 15);
  const labelY = Math.max(14, Math.min(canvas.height - 14, screen.y));
  context.fillStyle = "rgba(7,10,10,0.88)";
  context.fillRect(labelX - 4, labelY - 11, textWidth + 8, 22);
  context.fillStyle = color;
  context.fillText(label, labelX, labelY);
  context.restore();
}

function drawAccuracyRing(point, accuracyM, projector) {
  if (!point || !finite(accuracyM) || accuracyM <= 0 || !projector.inside(point)) return;
  const screen = projector.project(point);
  const radius = Math.max(5, Math.min(180, projector.metersToPixels(accuracyM)));
  context.save();
  context.strokeStyle = cssVar("--green");
  context.fillStyle = "rgba(87,212,123,0.10)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawNorthArrow() {
  context.save();
  context.translate(canvas.width - 34, 42);
  context.fillStyle = cssVar("--text");
  context.font = "700 15px Consolas";
  context.textAlign = "center";
  context.fillText("N", 0, -17);
  context.beginPath();
  context.moveTo(0, -11);
  context.lineTo(-7, 9);
  context.lineTo(0, 5);
  context.lineTo(7, 9);
  context.closePath();
  context.fill();
  context.restore();
}

function updateScaleBar(projector) {
  const candidates = [25, 50, 100, 200, 400, 800, 1600];
  let chosen = candidates[0];
  candidates.forEach((meters) => {
    if (projector.metersToPixels(meters) <= 170) chosen = meters;
  });
  document.querySelector("#scaleLabel").textContent = `${chosen} m`;
  document.querySelector("#scaleBar").style.width = `${Math.round(projector.metersToPixels(chosen))}px`;
}

function draw() {
  resizeCanvas();
  context.fillStyle = cssVar("--map-bg");
  context.fillRect(0, 0, canvas.width, canvas.height);
  const projector = makeProjector(state.map.bounds);

  context.save();
  context.strokeStyle = cssVar("--map-grid");
  context.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 80) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
  }
  for (let y = 0; y < canvas.height; y += 80) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
  }
  context.restore();

  context.save();
  context.strokeStyle = cssVar("--map-trail");
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  (state.map.trails || []).forEach((trail) => {
    if (!Array.isArray(trail) || trail.length < 2) return;
    context.beginPath();
    strokePath(trail, projector);
    context.stroke();
  });
  context.restore();

  const device = state.device;
  const route = device && device.navigation && device.navigation.active_route;
  if (route && route.available && Array.isArray(route.coordinates)) {
    context.save();
    context.strokeStyle = cssVar("--cyan");
    context.lineWidth = 7;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    strokePath(route.coordinates, projector);
    context.stroke();
    context.restore();
  }

  if (device) {
    const gps = device.gps || {};
    const current = gps.fix && state.connected
      ? { lat: Number(gps.lat), lon: Number(gps.lon) }
      : gps.last_fix
        ? { lat: Number(gps.last_fix.lat), lon: Number(gps.last_fix.lon) }
        : null;
    const waypoints = device.waypoints || {};
    if (waypoints.destination) drawMarker(waypoints.destination, "목적지", cssVar("--cyan"), projector, "square");
    if (waypoints.basecamp) drawMarker(waypoints.basecamp, "베이스캠프", cssVar("--amber"), projector, "triangle");
    if (gps.fix && state.connected && current) {
      drawAccuracyRing(current, Number(gps.acc_m), projector);
      drawMarker(current, "현재", gps.demo ? cssVar("--cyan") : cssVar("--green"), projector, "circle");
    } else if (current) {
      drawMarker(current, "마지막 확정", cssVar("--grey"), projector, "circle");
    }
  }

  drawNorthArrow();
  updateScaleBar(projector);
  return projector;
}

function renderGps(device) {
  const gps = device.gps || {};
  if (!state.connected) {
    setGlance("#glanceGps", "none", gps.mode === "off" ? "연동 전" : "연결 끊김", "SAT — · AGE —");
    return;
  }
  if (gps.fix) {
    const accuracy = finite(gps.acc_m) ? `±${gps.acc_m.toFixed(1)} m` : "±—";
    setGlance(
      "#glanceGps",
      gps.demo ? "normal" : "live",
      accuracy,
      `SAT ${gps.satellites ?? "—"} · AGE ${formatAge(gps.age_s)}`,
    );
  } else {
    setGlance(
      "#glanceGps",
      "none",
      "미수신",
      `SAT ${gps.last_fix && gps.last_fix.satellites != null ? gps.last_fix.satellites : "—"} · 마지막 ${formatAge(gps.last_age_s)}`,
    );
  }
}

function renderEnvironment(device) {
  const env = device.environment || {};
  const co = device.co || {};
  if (!state.connected || (!env.valid && !co.valid)) {
    const value = co.warming_up ? "CO 예열" : "연동 전";
    setGlance("#glanceEnv", "none", value, "RH — · CO —");
    return;
  }
  let stateName = device.demo ? "normal" : "live";
  if (co.level === "warning") stateName = "caution";
  if (co.alarm) stateName = "warn";
  const temp = env.valid ? `${formatNumber(env.temp_c, 1)}°C` : "—";
  const humidity = env.valid ? `${Math.round(env.humidity_pct)}%` : "—";
  const coValue = co.valid && finite(co.ppm) ? `${formatNumber(co.ppm, 1)}` : co.warming_up ? "예열" : "—";
  setGlance("#glanceEnv", stateName, temp, `RH ${humidity} · CO ${coValue}`);
}

function renderSun(device) {
  const sun = device.sun || {};
  if (!sun.computed) {
    setGlance("#glanceSun", "none", "계산 불가", "GPS 위치 필요");
  } else {
    const stateName = sun.reference !== "current_fix" ? "none" : sun.status === "return_now" ? "warn" : "normal";
    setGlance(
      "#glanceSun",
      stateName,
      formatDuration(sun.remaining_min),
      `일몰 ${sun.sunset_clock || "—"} · 귀환 ${sun.return_by_clock || "—"}`,
    );
  }
  const reference = sun.reference === "last_fix" ? " · 마지막 좌표 기준" : "";
  document.querySelector("#sunDetails").textContent =
    `일출 ${sun.sunrise_clock || "—"} · 일몰 ${sun.sunset_clock || "—"} · 귀환 권고 ${sun.return_by_clock || "—"}${reference}`;
}

function renderBattery(device) {
  const power = device.power || {};
  if (!power.valid) {
    setGlance("#glanceBattery", "none", "연동 전", "배터리 계측 없음");
    return;
  }
  const days = finite(power.days_left) ? `${formatNumber(power.days_left, 1)}일` : "—";
  const percent = finite(power.percent) ? `${Math.round(power.percent)}%` : "—";
  setGlance("#glanceBattery", device.demo ? "normal" : "live", days, `${percent} · 감시 모드`);
}

function renderTrail(device) {
  const trail = device.trail || {};
  const offset = finite(trail.offset_m) ? `${Math.round(trail.offset_m)} m` : "—";
  const states = {
    on_trail: ["live", "경로 위", `이탈 ${offset}`],
    off_trail: ["warn", "이탈", `${offset} 벗어남`],
    off_trail_estimate: ["caution", "이탈 추정", `${offset} · 정확도 없음`],
    accuracy_unknown: ["caution", "정확도 없음", `이탈 ${offset} · ±—`],
    uncertain: ["caution", "경계 구간", `${offset} · 오차 포함`],
    last_fix_only: ["none", "확인 불가", `마지막 위치 ${offset}`],
    unavailable: ["none", "확인 불가", "지도 또는 GPS 없음"],
  };
  const chosen = states[trail.status] || states.unavailable;
  setGlance("#glanceTrail", chosen[0], chosen[1], chosen[2]);
}

function renderReadout(device) {
  const card = document.querySelector("#readout");
  const route = device.navigation && device.navigation.active_route;
  if (!route || !route.available || !device.gps.fix || !state.connected) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const target = route.target || {};
  document.querySelector("#readoutLabel").textContent = String(target.kind || "TARGET").toUpperCase();
  document.querySelector("#readoutBearing").textContent = `${String(Math.round(route.bearing_deg)).padStart(3, "0")}°`;
  document.querySelector("#readoutDistance").textContent = `${Math.round(route.distance_m)} m`;
  document.querySelector("#readoutSub").textContent =
    `경로 따라 ${Math.round(route.distance_m)} m · 직선 ${Math.round(route.straight_m)} m`;
}

function renderAlert(device) {
  const alertBox = document.querySelector("#alert");
  if (device.alert) {
    document.querySelector("#alertText").textContent = device.alert.text;
    alertBox.hidden = false;
  } else {
    alertBox.hidden = true;
  }
  document.querySelector(".map").classList.toggle("has-alert", Boolean(device.alert));
  if (device.alert && device.alert.sound && state.connected) startAlarmSound();
  else stopAlarmSound();
}

function render() {
  const device = state.device;
  if (!device) {
    setGlance("#glanceGps", "none", "연결 중", "SAT — · AGE —");
    setGlance("#glanceSun", "none", "계산 대기", "GPS 위치 필요");
    setGlance("#glanceBattery", "none", "연동 전", "배터리 계측 없음");
    setGlance("#glanceTrail", "none", "확인 불가", "지도 또는 GPS 없음");
    setGlance("#glanceEnv", "none", "연동 전", "RH — · CO —");
    document.querySelector("#demoChip").hidden = !state.map.demo;
    draw();
    return;
  }
  renderGps(device);
  renderSun(device);
  renderBattery(device);
  renderTrail(device);
  renderEnvironment(device);
  renderReadout(device);
  renderAlert(device);
  document.querySelector("#mapName").textContent = device.map.name || state.map.name;
  document.querySelector("#demoChip").hidden = !device.demo;
  document.querySelector("#btnDestination").setAttribute("aria-pressed", String(state.selectingDestination));
  const selected = device.waypoints && device.waypoints.selected_target;
  document.querySelector("#btnBasecamp").setAttribute("aria-pressed", String(selected === "basecamp"));
  document.querySelector(".map").classList.toggle("selecting", state.selectingDestination);
  draw();
}

function beep() {
  if (!audioContext || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.14);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.20, audioContext.currentTime + 0.015);
  gain.gain.setValueAtTime(0.20, audioContext.currentTime + 0.25);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.34);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.35);
}

function startAlarmSound() {
  if (alarmTimer) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = audioContext || new AudioContextClass();
  audioContext.resume().then(beep).catch(() => {});
  alarmTimer = window.setInterval(beep, 900);
}

function stopAlarmSound() {
  if (alarmTimer) window.clearInterval(alarmTimer);
  alarmTimer = null;
}

async function postWaypoint(payload) {
  const response = await fetch("/api/waypoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "저장 지점 요청 실패");
  state.device = result;
  state.connected = true;
  render();
  return result;
}

document.querySelector("#btnDestination").addEventListener("click", () => {
  state.selectingDestination = !state.selectingDestination;
  showToast(state.selectingDestination ? "지도에서 목적지를 터치하세요" : "목적지 지정을 취소했습니다");
  render();
});

canvas.addEventListener("pointerup", async (event) => {
  if (!state.selectingDestination) return;
  const rect = canvas.getBoundingClientRect();
  const projector = makeProjector(state.map.bounds);
  const point = projector.unproject(
    (event.clientX - rect.left) * canvas.width / rect.width,
    (event.clientY - rect.top) * canvas.height / rect.height,
  );
  try {
    await postWaypoint({ action: "set", kind: "destination", lat: point.lat, lon: point.lon });
    state.selectingDestination = false;
    showToast("목적지를 지정했습니다");
  } catch (error) {
    showToast(error.message, 2600);
  }
  render();
});

document.querySelector("#btnCheckpoint").addEventListener("click", async () => {
  try {
    await postWaypoint({ action: "save_current", kind: "checkpoint" });
    showToast("현재 위치를 체크포인트로 저장했습니다");
  } catch (error) {
    showToast(error.message, 2600);
  }
});

document.querySelector("#btnBasecamp").addEventListener("click", async () => {
  try {
    const basecamp = state.device && state.device.waypoints && state.device.waypoints.basecamp;
    if (basecamp) {
      await postWaypoint({ action: "select", id: "basecamp" });
      showToast("베이스캠프 귀환 경로를 불러왔습니다");
    } else {
      await postWaypoint({ action: "save_current", kind: "basecamp" });
      showToast("현재 위치를 베이스캠프로 저장했습니다");
    }
  } catch (error) {
    showToast(error.message, 2600);
  }
});

document.querySelector("#btnNight").addEventListener("click", () => setNight(!state.night));

document.addEventListener("pointerdown", () => {
  if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(() => {});
}, { passive: true });

window.addEventListener("keydown", (event) => {
  if (event.key === "n" || event.key === "N") setNight(!state.night);
  if (event.key === "Escape" && state.selectingDestination) {
    state.selectingDestination = false;
    render();
  }
});

window.addEventListener("resize", render);

async function loadMap() {
  try {
    const response = await fetch("/api/map", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.bounds || !Array.isArray(payload.edges)) return;
    state.map = {
      name: payload.name || payload.source_name || "오프라인 보행 지도",
      source: payload.source_name,
      demo: Boolean(payload.demo),
      bounds: payload.bounds,
      trails: payload.edges,
      contours: [],
    };
  } catch (error) {
    state.map.demo = true;
  }
  render();
}

async function loadDevice() {
  try {
    const response = await fetch("/api/device", { cache: "no-store" });
    if (!response.ok) throw new Error("장치 상태 요청 실패");
    state.device = await response.json();
    state.connected = true;
  } catch (error) {
    state.connected = false;
  }
  render();
}

function connectEvents() {
  if (!("EventSource" in window)) return;
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource("/api/device/events");
  state.eventSource = source;
  source.onmessage = (event) => {
    try {
      state.device = JSON.parse(event.data);
      state.connected = true;
      render();
    } catch (error) {
      state.connected = false;
      render();
    }
  };
  source.onerror = () => {
    state.connected = false;
    stopAlarmSound();
    render();
  };
}

setNight(false);
Promise.all([loadMap(), loadDevice()]).then(connectEvents);
