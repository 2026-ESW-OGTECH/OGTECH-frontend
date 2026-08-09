/* SafeAid 건국대학교 시연 영상 전용 MAP — 1024x600
 *
 * 이 화면의 현재 위치·센서·일조 값은 촬영용 합성값이다. 그래서 DEMO 배지를 항상 표시하고
 * 녹색 LIVE 상태를 쓰지 않는다. 공개 POI와 보행망은 오프라인 파일이며, 경로·방위·거리는
 * 아래 코드와 map_engine이 계산한다. LLM은 좌표나 숫자를 생성하지 않는다.
 */

"use strict";

const FALLBACK_MAP = {
  name: "건국대학교 · 공학관 ↔ 일감호",
  attribution: "© OpenStreetMap contributors · ODbL 1.0",
  bounds: { west: 127.0731, east: 127.0819, south: 37.53905, north: 37.54258 },
  trails: [
    [[127.0778118, 37.5409566], [127.0780455, 37.5410483], [127.0783704, 37.5413134]],
    [[127.0783704, 37.5413134], [127.0785116, 37.5423177], [127.0789165, 37.5422808]],
    [[127.0783704, 37.5413134], [127.0790730, 37.5415506]],
  ],
  water: [{
    name: "일감호",
    center: { lon: 127.0765562, lat: 37.5408227 },
    outer: [
      [127.0747808, 37.5399023], [127.0753188, 37.5394364],
      [127.0765929, 37.5393073], [127.0776001, 37.5409130],
      [127.0771519, 37.5413443], [127.0773998, 37.5420968],
      [127.0765716, 37.5423213], [127.0760903, 37.5419508],
      [127.0755523, 37.5407890], [127.0747808, 37.5399023],
    ],
    inner: [],
  }],
  buildings: [{
    name: "공학관",
    center: { lon: 127.0794009, lat: 37.5415909 },
    polygon: [
      [127.0786273, 37.5411513], [127.0799888, 37.5410574],
      [127.0801745, 37.5418840], [127.0791165, 37.5421243],
      [127.0787826, 37.5421170], [127.0786273, 37.5411513],
    ],
  }],
  basecamp: { lon: 127.0783704, lat: 37.5413134 },
  destination: { lon: 127.0778118, lat: 37.5409566 },
  routeOutbound: [
    [127.0783704, 37.5413134], [127.0782965, 37.5412223],
    [127.0782162, 37.5411463], [127.0780455, 37.5410483],
    [127.0778118, 37.5409566],
  ],
  routeReturn: [
    [127.0778118, 37.5409566], [127.0780455, 37.5410483],
    [127.0782162, 37.5411463], [127.0782965, 37.5412223],
    [127.0783704, 37.5413134],
  ],
};

const SCENES = {
  1: {
    title: "BASE CAMP 시작",
    current: "basecamp", target: null, route: null,
    daylight: 138, sunset: "19:32", routeValue: "BASE CAMP", routeSub: "공학관 뒤편",
    alert: null, dialogue: false, toast: "BASE CAMP 저장 · 공학관 뒤편",
  },
  2: {
    title: "음성 요청 → 일감호 설정",
    current: "basecamp", target: "destination", route: "routeOutbound",
    daylight: 132, sunset: "19:32", routeValue: "일감호", routeSub: "목적지 설정됨",
    alert: null, dialogue: true, toast: null,
  },
  3: {
    title: "일감호로 이동",
    current: "basecamp", target: "destination", route: "routeOutbound",
    daylight: 126, sunset: "19:32", routeValue: "이동 중", routeSub: "일감호 방향",
    alert: null, dialogue: false, toast: "합성 위치 재생 · DEMO",
  },
  4: {
    title: "일감호 도착",
    current: "destination", target: null, route: null,
    daylight: 67, sunset: "19:32", routeValue: "도착", routeSub: "일감호 동쪽 산책로",
    alert: null, dialogue: false, toast: "일감호 도착",
  },
  5: {
    title: "1시간 일조 경고",
    current: "destination", target: "basecamp", route: "routeReturn",
    daylight: 60, sunset: "19:32", routeValue: "복귀 필요", routeSub: "BASE CAMP 경로",
    alert: "1시간 뒤에 해가 질 예정입니다. BASE CAMP로 돌아가세요.",
    dialogue: false, toast: null,
  },
  6: {
    title: "BASE CAMP 복귀",
    current: "destination", target: "basecamp", route: "routeReturn",
    daylight: 58, sunset: "19:32", routeValue: "복귀 중", routeSub: "공학관 뒤편",
    alert: null, dialogue: false, toast: "BASE CAMP 복귀 경로 재생 · DEMO",
  },
  7: {
    title: "BASE CAMP 도착",
    current: "basecamp", target: null, route: null,
    daylight: 54, sunset: "19:32", routeValue: "도착", routeSub: "BASE CAMP",
    alert: null, dialogue: false, toast: "BASE CAMP 도착",
  },
};

const state = {
  map: window.KONKUK_VIDEO_MAP || FALLBACK_MAP,
  sceneKey: 1,
  scene: SCENES[1],
  night: false,
};

const walk = {
  playing: false,
  meters: 0,
  speedMps: 8.0,
  lastFrame: 0,
  position: null,
  routeKey: null,
};

const canvas = document.querySelector("#mapCanvas");
const context = canvas.getContext("2d");
let toastTimer = 0;
let walkStartTimer = 0;

const EARTH_RADIUS_M = 6371008.8;
const toRad = (degrees) => (degrees * Math.PI) / 180;
const toDeg = (radians) => (radians * 180) / Math.PI;

function distanceMeters(from, to) {
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDegrees(from, to) {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function pathLengthMeters(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMeters(
      { lon: coordinates[index - 1][0], lat: coordinates[index - 1][1] },
      { lon: coordinates[index][0], lat: coordinates[index][1] }
    );
  }
  return total;
}

function pointAlong(coordinates, meters) {
  let remaining = meters;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = { lon: coordinates[index - 1][0], lat: coordinates[index - 1][1] };
    const to = { lon: coordinates[index][0], lat: coordinates[index][1] };
    const segment = distanceMeters(from, to);
    if (remaining <= segment) {
      const ratio = segment === 0 ? 0 : remaining / segment;
      return {
        lon: from.lon + (to.lon - from.lon) * ratio,
        lat: from.lat + (to.lat - from.lat) * ratio,
        done: false,
      };
    }
    remaining -= segment;
  }
  const last = coordinates[coordinates.length - 1];
  return { lon: last[0], lat: last[1], done: true };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function projection() {
  const bounds = state.map.bounds;
  const rect = canvas.getBoundingClientRect();
  const padding = 24;
  const midLat = (bounds.south + bounds.north) / 2;
  const lonFactor = Math.max(0.15, Math.cos(toRad(midLat)));
  const worldWidth = Math.max(1e-9, (bounds.east - bounds.west) * lonFactor);
  const worldHeight = Math.max(1e-9, bounds.north - bounds.south);
  const scale = Math.min(
    (rect.width - padding * 2) / worldWidth,
    (rect.height - padding * 2) / worldHeight
  );
  const offsetX = (rect.width - worldWidth * scale) / 2;
  const offsetY = (rect.height - worldHeight * scale) / 2;
  return {
    rect,
    scale,
    toScreen(lon, lat) {
      return [
        offsetX + (lon - bounds.west) * lonFactor * scale,
        offsetY + (bounds.north - lat) * scale,
      ];
    },
    metersToPixels(meters) {
      return (meters / 111320) * scale;
    },
  };
}

function strokePath(coordinates, projector) {
  coordinates.forEach((point, index) => {
    const [x, y] = projector.toScreen(point[0], point[1]);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
}

function drawGrid(width, height) {
  context.strokeStyle = cssVar("--map-grid");
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x < width; x += 48) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = 0; y < height; y += 48) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function fillPolygon(coordinates, projector, fill, stroke) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return;
  context.beginPath();
  strokePath(coordinates, projector);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.stroke();
}

function drawMapLabel(point, label, projector, color, yOffset) {
  const [x, y] = projector.toScreen(point.lon, point.lat);
  context.save();
  context.font = "850 24px 'Malgun Gothic', sans-serif";
  context.textAlign = "center";
  context.lineWidth = 5;
  context.strokeStyle = cssVar("--map-bg");
  context.strokeText(label, x, y + (yOffset || 0));
  context.fillStyle = color;
  context.fillText(label, x, y + (yOffset || 0));
  context.restore();
}

function drawMarker(point, label, color, projector, shape) {
  if (!point) return;
  const [x, y] = projector.toScreen(point.lon, point.lat);
  context.save();
  context.translate(x, y);
  context.fillStyle = cssVar("--map-bg");
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.beginPath();
  if (shape === "square") {
    context.rect(-11, -11, 22, 22);
  } else if (shape === "triangle") {
    context.moveTo(0, -13);
    context.lineTo(12, 9);
    context.lineTo(-12, 9);
    context.closePath();
  } else {
    context.arc(0, 0, 12, 0, Math.PI * 2);
  }
  context.fill();
  context.stroke();
  context.font = "800 20px 'Malgun Gothic', sans-serif";
  context.textAlign = "center";
  context.lineWidth = 5;
  context.strokeStyle = cssVar("--map-bg");
  context.strokeText(label, 0, -22);
  context.fillStyle = color;
  context.fillText(label, 0, -22);
  context.restore();
}

function drawAccuracyRing(point, projector) {
  if (!point) return;
  const [x, y] = projector.toScreen(point.lon, point.lat);
  const radius = Math.max(14, projector.metersToPixels(4.2));
  context.save();
  context.globalAlpha = 0.16;
  context.fillStyle = cssVar("--amber");
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 0.8;
  context.strokeStyle = cssVar("--amber");
  context.lineWidth = 2;
  context.stroke();
  context.restore();
}

function drawNorthArrow(projector) {
  const x = projector.rect.width - 42;
  const y = state.scene.alert ? 116 : 44;
  context.save();
  context.translate(x, y);
  context.fillStyle = cssVar("--muted");
  context.beginPath();
  context.moveTo(0, -18);
  context.lineTo(8, 12);
  context.lineTo(0, 5);
  context.lineTo(-8, 12);
  context.closePath();
  context.fill();
  context.font = "700 15px Consolas, monospace";
  context.textAlign = "center";
  context.fillText("N", 0, -24);
  context.restore();
}

function currentPoint() {
  return walk.position || state.map[state.scene.current];
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = cssVar("--map-bg");
  context.fillRect(0, 0, rect.width, rect.height);
  drawGrid(rect.width, rect.height);

  const projector = projection();
  (state.map.water || []).forEach((feature) => {
    fillPolygon(feature.outer, projector, cssVar("--video-water"), cssVar("--video-water-line"));
    (feature.inner || []).forEach((inner) => {
      fillPolygon(inner, projector, cssVar("--map-bg"), cssVar("--video-water-line"));
    });
  });
  (state.map.buildings || []).forEach((feature) => {
    fillPolygon(feature.polygon, projector, cssVar("--video-building"), cssVar("--video-building-line"));
  });

  context.strokeStyle = cssVar("--map-trail");
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.beginPath();
  state.map.trails.forEach((trail) => strokePath(trail, projector));
  context.stroke();

  if (state.scene.route) {
    const route = state.map[state.scene.route];
    context.lineCap = "round";
    context.strokeStyle = cssVar("--map-bg");
    context.lineWidth = 11;
    context.beginPath();
    strokePath(route, projector);
    context.stroke();
    context.strokeStyle = cssVar("--cyan");
    context.lineWidth = 5;
    context.beginPath();
    strokePath(route, projector);
    context.stroke();
    context.lineCap = "butt";
  }

  (state.map.water || []).forEach((feature) => {
    drawMapLabel(feature.center, feature.name, projector, cssVar("--cyan"), 0);
  });
  (state.map.buildings || []).forEach((feature) => {
    drawMapLabel(feature.center, feature.name, projector, cssVar("--text"), 0);
  });

  drawNorthArrow(projector);
  drawMarker(state.map.basecamp, "BASE CAMP", cssVar("--amber"), projector, "triangle");
  if (state.sceneKey >= 2) {
    drawMarker(state.map.destination, "일감호 도착점", cssVar("--cyan"), projector, "square");
  }
  const current = currentPoint();
  drawAccuracyRing(current, projector);
  drawMarker(current, "DEMO 현재", cssVar("--amber"), projector, "circle");
  updateScaleBar(projector);
}

function updateScaleBar(projector) {
  const candidates = [25, 50, 100, 200, 400];
  let chosen = candidates[0];
  candidates.forEach((meters) => {
    if (projector.metersToPixels(meters) <= 170) chosen = meters;
  });
  document.querySelector("#scaleLabel").textContent = `${chosen} m`;
  document.querySelector("#scaleBar").style.width =
    `${Math.round(projector.metersToPixels(chosen))}px`;
}

function setGlance(id, stateName, value, sub) {
  const element = document.querySelector(id);
  element.dataset.state = stateName;
  element.querySelector("strong").textContent = value;
  element.querySelector(".sub").textContent = sub;
}

function formatDaylight(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}:${String(rest).padStart(2, "0")}` : `${rest}분`;
}

function showToast(message, duration) {
  const toast = document.querySelector("#statusToast");
  window.clearTimeout(toastTimer);
  if (!message) {
    toast.hidden = true;
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration || 2600);
}

function render() {
  const scene = state.scene;
  const current = currentPoint();
  setGlance("#glanceGps", "caution", "DEMO ±4.2 m", "SAT 9 · 합성 위치");
  setGlance(
    "#glanceSun",
    scene.daylight <= 60 ? "warn" : "normal",
    formatDaylight(scene.daylight),
    `일몰 ${scene.sunset}`
  );
  setGlance("#glanceBattery", "caution", "11일", "78% · DEMO");
  setGlance(
    "#glanceRoute",
    scene.alert ? "warn" : "caution",
    scene.routeValue,
    scene.routeSub
  );
  setGlance("#glanceEnv", "caution", "23.4°", "58% RH · DEMO");

  const alertBox = document.querySelector("#alert");
  if (scene.alert) {
    document.querySelector("#alertText").textContent = scene.alert;
    alertBox.hidden = false;
  } else {
    alertBox.hidden = true;
  }
  document.querySelector("#mapPanel").classList.toggle("has-alert", Boolean(scene.alert));
  document.querySelector("#dialogueCard").hidden = !scene.dialogue;

  const target = scene.target ? state.map[scene.target] : null;
  const readout = document.querySelector("#readout");
  if (!target) {
    readout.hidden = true;
  } else {
    readout.hidden = false;
    document.querySelector("#readoutLabel").textContent =
      scene.target === "basecamp" ? "BASE CAMP" : "일감호";
    document.querySelector("#readoutBearing").textContent =
      `${String(Math.round(bearingDegrees(current, target))).padStart(3, "0")}°`;
    const route = state.map[scene.route];
    const total = pathLengthMeters(route);
    const remaining = walk.routeKey === scene.route
      ? Math.max(0, total - walk.meters)
      : total;
    document.querySelector("#readoutDistance").textContent = `${Math.round(remaining)} m`;
    document.querySelector("#readoutSub").textContent =
      `지도 엔진 경로 ${Math.round(remaining)} m · LLM 숫자 생성 안 함`;
  }

  document.querySelector("#mapName").textContent = state.map.name;
  document.querySelector("#mapAttribution").textContent = state.map.attribution;
  document.querySelector("#directorKey").textContent = String(state.sceneKey);
  document.querySelector("#directorScene").textContent = scene.title;
  draw();
}

function walkFrame(timestamp) {
  if (!walk.playing || !walk.routeKey) return;
  const elapsed = walk.lastFrame ? (timestamp - walk.lastFrame) / 1000 : 0;
  walk.lastFrame = timestamp;
  walk.meters += elapsed * walk.speedMps;
  const next = pointAlong(state.map[walk.routeKey], walk.meters);
  walk.position = { lon: next.lon, lat: next.lat };
  if (next.done) {
    walk.playing = false;
    walk.lastFrame = 0;
    showToast(state.sceneKey === 3
      ? "일감호 도착 · 숫자 4로 고정 화면"
      : "BASE CAMP 도착 · 숫자 7로 고정 화면", 4200);
  }
  render();
  if (walk.playing) window.requestAnimationFrame(walkFrame);
}

function startWalk() {
  if (!state.scene.route) return;
  walk.playing = true;
  walk.routeKey = state.scene.route;
  walk.meters = 0;
  walk.lastFrame = 0;
  const first = state.map[walk.routeKey][0];
  walk.position = { lon: first[0], lat: first[1] };
  window.requestAnimationFrame(walkFrame);
}

function stopWalk(keepPosition) {
  walk.playing = false;
  walk.lastFrame = 0;
  walk.routeKey = null;
  walk.meters = 0;
  if (!keepPosition) walk.position = null;
}

function fallbackSpeech(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const message = new SpeechSynthesisUtterance(text);
  message.lang = "ko-KR";
  message.rate = 0.92;
  window.speechSynthesis.speak(message);
}

function playFixedAudio(kind) {
  const warning = kind === "warning";
  const audio = document.querySelector(warning ? "#warningAudio" : "#destinationAudio");
  const text = warning
    ? "1시간 뒤에 해가 질 예정입니다. 베이스 캠프로 돌아가세요."
    : "일감호를 목적지로 설정했습니다. 경로는 지도 엔진이 계산했습니다.";
  audio.currentTime = 0;
  const playing = audio.play();
  if (playing && typeof playing.catch === "function") {
    playing.catch(() => fallbackSpeech(text));
  }
}

function setScene(key, options) {
  const sceneKey = Number(key);
  if (!SCENES[sceneKey]) return;
  window.clearTimeout(walkStartTimer);
  stopWalk(false);
  state.sceneKey = sceneKey;
  state.scene = SCENES[sceneKey];
  showToast(state.scene.toast, sceneKey === 4 || sceneKey === 7 ? 4000 : 2600);
  render();

  const withAudio = !options || options.audio !== false;
  if (sceneKey === 2 && withAudio) playFixedAudio("destination");
  if (sceneKey === 5 && withAudio) playFixedAudio("warning");
  if (sceneKey === 3 || sceneKey === 6) {
    walkStartTimer = window.setTimeout(startWalk, 450);
  }
}

function nextScene() {
  setScene(state.sceneKey >= 7 ? 1 : state.sceneKey + 1);
}

function setNight(on) {
  state.night = on;
  document.documentElement.dataset.night = on ? "on" : "off";
  render();
}

document.querySelector("#btnDestination").addEventListener("click", () => setScene(2));
document.querySelector("#btnWalk").addEventListener("click", () => {
  setScene(state.sceneKey >= 5 ? 6 : 3);
});
document.querySelector("#btnAlert").addEventListener("click", () => setScene(5));
document.querySelector("#btnNext").addEventListener("click", nextScene);

window.addEventListener("keydown", (event) => {
  if (/^[1-7]$/.test(event.key)) {
    setScene(Number(event.key));
  } else if (event.code === "Space") {
    event.preventDefault();
    nextScene();
  } else if (event.key === "b" || event.key === "B") {
    playFixedAudio(state.sceneKey === 5 ? "warning" : "destination");
  } else if (event.key === "r" || event.key === "R") {
    setScene(1, { audio: false });
  } else if (event.key === "n" || event.key === "N") {
    setNight(!state.night);
  } else if (event.key === "h" || event.key === "H") {
    const panel = document.querySelector("#director");
    panel.hidden = !panel.hidden;
  }
});

window.addEventListener("resize", draw);
setNight(false);
setScene(1, { audio: false });
