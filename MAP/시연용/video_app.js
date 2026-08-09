/* SafeAid 건국대학교 시연 영상 전용 MAP — 1024x600
 *
 * 이 화면의 현재 위치·센서·일조 값은 촬영용 합성값이다. 그래서 지도 제목 옆 DEMO 배지를 표시하고
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
  basecamp: { lon: 127.0795165, lat: 37.5417937 },
  destination: { lon: 127.0774930, lat: 37.5424365 },
  routeOutbound: [
    [127.0795165, 37.5417937], [127.0795047, 37.5418378],
    [127.0791513, 37.5418885], [127.0791567, 37.5419074],
    [127.0792038, 37.5421151], [127.0792144, 37.5421609],
    [127.0789017, 37.5422025], [127.0789165, 37.5422808],
    [127.0785116, 37.5423177], [127.0778637, 37.5423923],
    [127.0775933, 37.5424271], [127.0774930, 37.5424365],
  ],
  routeReturn: [
    [127.0774930, 37.5424365], [127.0775933, 37.5424271],
    [127.0778637, 37.5423923], [127.0785116, 37.5423177],
    [127.0789165, 37.5422808], [127.0789017, 37.5422025],
    [127.0792144, 37.5421609], [127.0792038, 37.5421151],
    [127.0791567, 37.5419074], [127.0791513, 37.5418885],
    [127.0795047, 37.5418378], [127.0795165, 37.5417937],
  ],
};

const SCENES = {
  1: {
    title: "BASE CAMP 시작",
    current: "basecamp", target: null, route: null,
    daylight: 138, sunset: "19:32", routeValue: "BASE CAMP", routeSub: "공학관 뒤편",
    alert: null, arrival: null, toast: null,
  },
  2: {
    title: "음성 요청 → 일감호 설정",
    current: "basecamp", target: "destination", route: "routeOutbound",
    daylight: 132, sunset: "19:32", routeValue: "일감호", routeSub: "목적지 설정됨",
    alert: null, arrival: null, toast: null,
  },
  3: {
    title: "일감호로 이동",
    current: "basecamp", target: "destination", route: "routeOutbound",
    daylight: 126, sunset: "19:32", routeValue: "이동 중", routeSub: "일감호 방향",
    alert: null, arrival: null, toast: null,
  },
  4: {
    title: "일감호 도착",
    current: "destination", target: null, route: null,
    daylight: 67, sunset: "19:32", routeValue: "도착", routeSub: "일감호 북쪽 산책로",
    alert: null, arrival: "목적지에 도착하였습니다.", toast: null,
  },
  5: {
    title: "1시간 일조 경고",
    current: "destination", target: "basecamp", route: "routeReturn",
    daylight: 60, sunset: "19:32", routeValue: "복귀 필요", routeSub: "BASE CAMP 경로",
    alert: "해가 곧 집니다. 안전을 위해 베이스캠프로 돌아가는 것을 권장합니다.",
    arrival: null, toast: null,
  },
  6: {
    title: "BASE CAMP 복귀",
    current: "destination", target: "basecamp", route: "routeReturn",
    daylight: 58, sunset: "19:32", routeValue: "복귀 중", routeSub: "공학관 뒤편",
    alert: null, arrival: null, toast: null,
  },
  7: {
    title: "BASE CAMP 도착",
    current: "basecamp", target: null, route: null,
    daylight: 54, sunset: "19:32", routeValue: "도착", routeSub: "BASE CAMP",
    alert: null, arrival: null, toast: "BASE CAMP 도착",
  },
};

const state = {
  map: window.KONKUK_VIDEO_MAP || FALLBACK_MAP,
  sceneKey: 1,
  scene: SCENES[1],
  night: false,
  checkpoint: null,
  destinationSelecting: false,
};

const walk = {
  playing: false,
  meters: 0,
  speedMps: 4.0,
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

function coordinateKey(point) {
  return `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
}

function buildTrailGraph() {
  const graph = new Map();
  const ensureNode = (point) => {
    const key = coordinateKey(point);
    if (!graph.has(key)) graph.set(key, { point: [point[0], point[1]], edges: new Map() });
    return key;
  };
  const connect = (from, to) => {
    const fromKey = ensureNode(from);
    const toKey = ensureNode(to);
    const weight = distanceMeters(
      { lon: from[0], lat: from[1] },
      { lon: to[0], lat: to[1] }
    );
    graph.get(fromKey).edges.set(toKey, weight);
    graph.get(toKey).edges.set(fromKey, weight);
  };
  (state.map.trails || []).forEach((trail) => {
    for (let index = 1; index < trail.length; index += 1) {
      connect(trail[index - 1], trail[index]);
    }
  });
  return graph;
}

function nearestGraphKey(graph, point) {
  let nearestKey = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  graph.forEach((node, key) => {
    const distance = distanceMeters(point, { lon: node.point[0], lat: node.point[1] });
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = key;
    }
  });
  return nearestKey;
}

function routeOnTrails(from, requestedDestination) {
  const graph = buildTrailGraph();
  const startKey = nearestGraphKey(graph, from);
  const destinationKey = nearestGraphKey(graph, requestedDestination);
  if (!startKey || !destinationKey) return null;

  const distances = new Map([[startKey, 0]]);
  const previous = new Map();
  const queue = [[0, startKey]];
  while (queue.length > 0) {
    queue.sort((left, right) => right[0] - left[0]);
    const [distance, key] = queue.pop();
    if (distance !== distances.get(key)) continue;
    if (key === destinationKey) break;
    graph.get(key).edges.forEach((weight, neighborKey) => {
      const candidate = distance + weight;
      if (candidate < (distances.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighborKey, candidate);
        previous.set(neighborKey, key);
        queue.push([candidate, neighborKey]);
      }
    });
  }
  if (!distances.has(destinationKey)) return null;

  const keys = [];
  for (let key = destinationKey; key; key = previous.get(key)) {
    keys.push(key);
    if (key === startKey) break;
  }
  keys.reverse();
  const route = keys.map((key) => graph.get(key).point);
  const first = route[0];
  if (distanceMeters(from, { lon: first[0], lat: first[1] }) > 0.5) {
    route.unshift([from.lon, from.lat]);
  }
  const destinationNode = graph.get(destinationKey).point;
  return {
    destination: { lon: destinationNode[0], lat: destinationNode[1] },
    route,
  };
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
    fromScreen(x, y) {
      return {
        lon: bounds.west + (x - offsetX) / (lonFactor * scale),
        lat: bounds.north - (y - offsetY) / scale,
      };
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
  const sceneTarget = state.scene.target ? state.map[state.scene.target] : null;
  if (sceneTarget && state.scene.target !== "basecamp") {
    const targetLabel = state.scene.target === "destination" ? "일감호 목적지" : "목적지";
    drawMarker(sceneTarget, targetLabel, cssVar("--cyan"), projector, "square");
  } else if (state.sceneKey >= 2) {
    drawMarker(state.map.destination, "일감호 목적지", cssVar("--cyan"), projector, "square");
  }
  if (state.checkpoint) {
    drawMarker(state.checkpoint, "체크포인트", cssVar("--cyan"), projector, "square");
  }
  const current = currentPoint();
  drawAccuracyRing(current, projector);
  drawMarker(current, "현재", cssVar("--amber"), projector, "circle");
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

const seoulClockFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function updateSeoulClock() {
  const parts = {};
  seoulClockFormatter.formatToParts(new Date()).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  setGlance(
    "#glanceTime",
    "normal",
    `${parts.hour}:${parts.minute}:${parts.second}`,
    `${parts.year}.${parts.month}.${parts.day} KST`
  );
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
  setGlance("#glanceGps", "caution", "±4.2 m", "SAT 9 · AGE 1s");
  setGlance(
    "#glanceSun",
    scene.daylight <= 60 ? "warn" : "normal",
    formatDaylight(scene.daylight),
    `일몰 ${scene.sunset}`
  );
  updateSeoulClock();
  setGlance(
    "#glanceRoute",
    scene.alert ? "warn" : "caution",
    scene.routeValue,
    scene.routeSub
  );
  setGlance("#glanceEnv", "caution", "30.0°", "55% RH");

  const alertBox = document.querySelector("#alert");
  if (scene.alert) {
    document.querySelector("#alertText").textContent = scene.alert;
    alertBox.hidden = false;
  } else {
    alertBox.hidden = true;
  }
  document.querySelector("#mapPanel").classList.toggle("has-alert", Boolean(scene.alert));
  const arrivalCard = document.querySelector("#arrivalCard");
  if (scene.arrival) {
    document.querySelector("#arrivalText").textContent = scene.arrival;
    arrivalCard.hidden = false;
  } else {
    arrivalCard.hidden = true;
  }

  const target = scene.target ? state.map[scene.target] : null;
  const readout = document.querySelector("#readout");
  if (!target) {
    readout.hidden = true;
  } else {
    readout.hidden = false;
    document.querySelector("#readoutLabel").textContent =
      scene.target === "basecamp"
        ? "BASE CAMP"
        : scene.target === "destination"
          ? "일감호"
          : "목적지";
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
    setScene(state.sceneKey === 3 ? 4 : 7);
    return;
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
  const fixedAudio = {
    destination: {
      selector: "#destinationAudio",
      text: "가까운 곳에 일감호 주변 휴식 지점이 있습니다. 목적지로 설정할게요. 경로 설정을 완료했습니다.",
    },
    arrival: {
      selector: "#arrivalAudio",
      text: "목적지에 도착하였습니다.",
    },
    warning: {
      selector: "#warningAudio",
      text: "해가 곧 집니다. 안전을 위해 베이스캠프로 돌아가는 것을 권장합니다.",
    },
    daylightDetail: {
      selector: "#daylightDetailAudio",
      text: "현재 위치 기준으로 약 한 시간 뒤에 해가 집니다.",
    },
  };
  const selected = fixedAudio[kind] || fixedAudio.destination;
  const audio = document.querySelector(selected.selector);
  audio.currentTime = 0;
  const playing = audio.play();
  if (playing && typeof playing.catch === "function") {
    playing.catch(() => fallbackSpeech(selected.text));
  }
}

function setScene(key, options) {
  const sceneKey = Number(key);
  if (!SCENES[sceneKey]) return;
  window.clearTimeout(walkStartTimer);
  stopWalk(false);
  setDestinationSelection(false);
  state.sceneKey = sceneKey;
  state.scene = SCENES[sceneKey];
  showToast(state.scene.toast, sceneKey === 4 || sceneKey === 7 ? 4000 : 2600);
  render();

  const withAudio = !options || options.audio !== false;
  if (sceneKey === 2 && withAudio) playFixedAudio("destination");
  if (sceneKey === 4 && withAudio) playFixedAudio("arrival");
  if (sceneKey === 5 && withAudio) playFixedAudio("warning");
  const autoWalk = !options || options.autoWalk !== false;
  if ((sceneKey === 3 || sceneKey === 6) && autoWalk) {
    walkStartTimer = window.setTimeout(startWalk, 450);
  }
}

function nextScene() {
  setScene(state.sceneKey >= 7 ? 1 : state.sceneKey + 1);
}

function setNight(on, announce) {
  state.night = on;
  document.documentElement.dataset.night = on ? "on" : "off";
  document.querySelector("#btnNight").setAttribute("aria-pressed", String(on));
  if (announce) {
    showToast(on ? "야간 모드가 활성화되었습니다." : "야간 모드가 해제되었습니다.", 2800);
  }
  render();
}

function setDestinationSelection(on) {
  state.destinationSelecting = on;
  document.querySelector("#btnDestination").setAttribute("aria-pressed", String(on));
  canvas.classList.toggle("destination-selecting", on);
}

function selectMapDestination(event) {
  if (!state.destinationSelecting) return;
  const rect = canvas.getBoundingClientRect();
  const requested = projection().fromScreen(event.clientX - rect.left, event.clientY - rect.top);
  const from = currentPoint();
  const result = routeOnTrails(from, requested);
  setDestinationSelection(false);
  if (!result) return;
  state.map.manualStart = { lon: from.lon, lat: from.lat };
  state.map.manualDestination = result.destination;
  state.map.routeToManualDestination = result.route;
  state.sceneKey = 2;
  state.scene = {
    ...SCENES[2],
    title: "터치 목적지 설정",
    current: "manualStart",
    target: "manualDestination",
    route: "routeToManualDestination",
    routeValue: "목적지",
    routeSub: "터치 지정",
    arrival: null,
    toast: null,
  };
  render();
}

function saveCheckpoint() {
  const point = currentPoint();
  state.checkpoint = { lon: point.lon, lat: point.lat };
  const label = document.querySelector("#btnCheckpoint .label");
  label.textContent = "저장됨";
  showToast("현재 위치를 체크포인트로 저장했습니다.", 2400);
  window.setTimeout(() => { label.textContent = "체크포인트"; }, 1400);
  render();
}

function routeFromCurrentToBasecamp(from) {
  const reference = state.map.routeReturn;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  reference.forEach((point, index) => {
    const distance = distanceMeters(from, { lon: point[0], lat: point[1] });
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  const remaining = reference.slice(nearestIndex + 1);
  return [[from.lon, from.lat], ...remaining];
}

function showBasecampRoute() {
  const from = currentPoint();
  window.clearTimeout(walkStartTimer);
  stopWalk(false);
  state.map.returnStart = { lon: from.lon, lat: from.lat };
  state.map.routeToBasecamp = routeFromCurrentToBasecamp(from);
  state.sceneKey = 6;
  state.scene = {
    ...SCENES[6],
    current: "returnStart",
    route: "routeToBasecamp",
    routeValue: "BASE CAMP",
    routeSub: "복귀 경로 표시",
  };
  render();
  showToast("베이스캠프 복귀 경로가 설정되었습니다.", 2800);
}

function handleBasecampButton() {
  if (state.sceneKey === 1) {
    const current = currentPoint();
    state.map.basecamp = { lon: current.lon, lat: current.lat };
    render();
    showToast("베이스캠프가 등록되었습니다.", 2800);
    return;
  }
  showBasecampRoute();
}

document.querySelector("#btnDestination").addEventListener("click", () => {
  setDestinationSelection(!state.destinationSelecting);
});
document.querySelector("#btnCheckpoint").addEventListener("click", saveCheckpoint);
document.querySelector("#btnBasecamp").addEventListener("click", handleBasecampButton);
document.querySelector("#btnNight").addEventListener("click", () => setNight(!state.night, true));
canvas.addEventListener("click", selectMapDestination);

window.addEventListener("keydown", (event) => {
  if (/^[1-7]$/.test(event.key)) {
    setScene(Number(event.key));
  } else if (event.code === "Space") {
    event.preventDefault();
    nextScene();
  } else if (event.key === "b" || event.key === "B") {
    const audioKind = state.sceneKey === 5
      ? "warning"
      : state.sceneKey === 4
        ? "arrival"
        : "destination";
    playFixedAudio(audioKind);
  } else if (event.key === "t" || event.key === "T") {
    playFixedAudio("daylightDetail");
  } else if (event.key === "r" || event.key === "R") {
    setScene(1, { audio: false });
  } else if (event.key === "n" || event.key === "N") {
    setNight(!state.night, true);
  } else if (event.key === "c" || event.key === "C") {
    saveCheckpoint();
  } else if (event.key === "h" || event.key === "H") {
    const panel = document.querySelector("#director");
    panel.hidden = !panel.hidden;
  }
});

window.addEventListener("resize", draw);
setNight(false);
setScene(1, { audio: false });
window.setInterval(updateSeoulClock, 1000);
