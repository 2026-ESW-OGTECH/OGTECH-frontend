/* OGTECH 1024x600 화면 — 제품(/product/)과 촬영(/video/)이 함께 쓴다.
 *
 * 두 화면의 디자인은 예외 없이 같아야 하므로 마크업(video.html)·CSS(video_styles.css)·
 * 그리기 코드를 한 벌만 두고, 이 파일이 경로로 데이터 소스만 가른다(LIVE_MODE).
 *
 *   /product/  좌표·경로·방위·거리·도착·일출몰을 /api/device 실측으로 채운다.
 *              하단 버튼은 /api/waypoints 로 실제 저장하고, /api/voice/events 를 구독한다.
 *              값이 없으면 없다고 적는다 — 마지막 좌표를 현재인 척하지 않는다.
 *   /video/    좌표·경로는 촬영 시나리오 고정값이고 장면 전환·자동 재생이 붙는다.
 *              `?live=1` 이면 온·습도·CO 만 실측, `?autoplay=1|loop` 는 자동 재생.
 *
 * 공개 POI와 보행망은 오프라인 파일이며, 경로·방위·거리·경로 이탈 거리는 아래 코드와
 * map_engine이 계산한다. LLM은 좌표나 숫자를 생성하지 않는다.
 */

"use strict";

const OFFICIAL_ZENITH_DEG = 90.833;
const SEOUL_TIME_ZONE = "Asia/Seoul";
// navigation_service.TRAIL_THRESHOLD_M 기본값(30 m)과 같은 기준으로 경로 이탈을 판정한다.
const ROUTE_DEVIATION_THRESHOLD_M = 30;
// D 키 시연용 이탈 거리. 임계값을 확실히 넘도록 1.5배로 둔다.
const ROUTE_DEVIATION_DEMO_OFFSET_M = 45;
// 촬영 시나리오 고정 환경값. 기온 색: 30°C 초과 적색, 20~30°C 황색, 20°C 이하 녹색.
const SCENARIO_ENVIRONMENT = Object.freeze({ temperatureC: 30.0, humidityPct: 55 });
const SCENARIO_CO = Object.freeze({ valid: true, ppm: 0, level: "normal", alarm: false, warmingUp: false });

// URL 파라미터. live=1 → 온·습도·CO를 /api/device 실값으로, autoplay=1|loop → 로드 즉시 자동 재생.
const PAGE_PARAMS = new URLSearchParams(window.location.search);
// 제품 화면(/product/)은 이 파일과 video.html·video_styles.css 를 그대로 쓰고 데이터만
// STM32 실측으로 바꾼다. 화면 코드를 한 벌만 두어야 두 화면 디자인이 어긋나지 않는다.
// 차이는 딱 두 가지다 — 좌표·경로가 실측인지, 촬영용 시나리오 기능이 붙는지.
const LIVE_MODE = window.location.pathname.startsWith("/product");
const LIVE_SENSORS = LIVE_MODE || PAGE_PARAMS.get("live") === "1";
const AUTOPLAY_MODE = LIVE_MODE
  ? null
  : ["1", "loop"].includes(PAGE_PARAMS.get("autoplay") || "")
    ? PAGE_PARAMS.get("autoplay")
    : null;
// 이 시간 동안 /api/device 갱신이 없으면 실값 대신 "—"를 보여 준다(꾸며낸 값 금지).
const LIVE_STALE_AFTER_MS = 10000;
const LIVE_POLL_INTERVAL_MS = 2000;
const AUTOPLAY_START_DELAY_MS = 800;
const AUTOPLAY_LOOP_PAUSE_MS = 5000;

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
    routeValue: "BASE CAMP", routeSub: "공학관 뒤편",
    alert: null, arrival: null, toast: null,
  },
  2: {
    title: "음성 요청 → 일감호 설정",
    current: "basecamp", target: "destination", route: "routeOutbound",
    routeValue: "일감호", routeSub: "목적지",
    alert: null, arrival: null, toast: null,
  },
  3: {
    title: "일감호로 이동",
    current: "basecamp", target: "destination", route: "routeOutbound",
    routeValue: "이동 중", routeSub: "목적지",
    alert: null, arrival: null, toast: null,
  },
  4: {
    title: "일감호 도착",
    current: "destination", target: null, route: null,
    routeValue: "도착", routeSub: "일감호 북쪽 산책로",
    alert: null, arrival: "목적지에 도착하였습니다.", toast: null,
  },
  5: {
    title: "일조 잔여 경고",
    current: "destination", target: "basecamp", route: "routeReturn",
    routeValue: "복귀 필요", routeSub: "BASE CAMP 경로",
    alert: true,
    arrival: null, toast: null,
  },
  6: {
    title: "BASE CAMP 복귀",
    current: "destination", target: "basecamp", route: "routeReturn",
    routeValue: "복귀 중", routeSub: "BASE CAMP",
    alert: null, arrival: null, toast: null,
  },
  7: {
    title: "BASE CAMP 도착",
    current: "basecamp", target: null, route: null,
    routeValue: "도착", routeSub: "BASE CAMP",
    alert: null, arrival: "Base Camp에 도착하였습니다.", toast: null,
  },
};

const state = {
  map: window.KONKUK_VIDEO_MAP || FALLBACK_MAP,
  sceneKey: 1,
  scene: SCENES[1],
  night: false,
  checkpoint: null,
  destinationSelecting: false,
  daylightAlertSnapshot: null,
  environment: { ...SCENARIO_ENVIRONMENT },
  co: { ...SCENARIO_CO },
  live: { enabled: LIVE_SENSORS, connected: false, updatedAt: 0, updates: 0 },
  routeDeviationDemo: false,
};

// live 모드 전용. 시나리오 모드에서는 끝까지 비어 있다.
const live = {
  device: null,
  fix: null,           // {lon, lat} · fix 없으면 null
  target: null,        // 선택된 목적지/베이스캠프 좌표
  targetKind: null,    // "destination" | "basecamp"
  route: null,         // [[lon, lat], ...]
  routeInfo: null,     // {bearing_deg, distance_m, eta_min}
  basecamp: null,
  sun: null,
  alertText: null,
  arrivalText: null,
  selecting: false,
  lastVoiceSequence: 0,
};

function livePoint(waypoint) {
  if (!waypoint) return null;
  const lat = Number(waypoint.lat);
  const lon = Number(waypoint.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lon, lat } : null;
}

const walk = {
  playing: false,
  meters: 0,
  speedMps: 1.4,
  lastFrame: 0,
  position: null,
  routeKey: null,
};

// 촬영용 전체 시퀀스의 장면 간 정지 시간이다. 이동 구간은 실제 경로 길이와
// speedMps로 끝날 때까지 재생하므로 여기에는 넣지 않는다.
const AUTO_DEMO_DELAYS_MS = Object.freeze({
  basecampRegistered: 3000,
  destinationFallback: 13000,
  arrivalFallback: 3600,
  warningFallback: 6200,
  returnRouteShown: 3000,
  basecampArrival: 3600,
  nightMode: 2800,
});

const autoDemo = {
  active: false,
  runId: 0,
  timers: new Set(),
  walkResolver: null,
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

// 점을 방위각 방향으로 meters만큼 옮긴 좌표(구면 정방향 계산).
function offsetPoint(point, bearingDeg, meters) {
  const angular = meters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(point.lat);
  const lon1 = toRad(point.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lon: toDeg(lon2), lat: toDeg(lat2) };
}

// 점에서 선분까지의 최단 거리(m). 수백 m 범위라 국지 등장방형 투영으로 충분하다.
function distanceToSegmentMeters(point, from, to) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(toRad(point.lat));
  const ax = (from[0] - point.lon) * metersPerDegLon;
  const ay = (from[1] - point.lat) * metersPerDegLat;
  const bx = (to[0] - point.lon) * metersPerDegLon;
  const by = (to[1] - point.lat) * metersPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

function nearestRouteSegment(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  let nearest = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const distance = distanceToSegmentMeters(point, coordinates[index - 1], coordinates[index]);
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, from: coordinates[index - 1], to: coordinates[index] };
    }
  }
  return nearest;
}

function routeOffsetMeters(point, coordinates) {
  const nearest = nearestRouteSegment(point, coordinates);
  return nearest ? nearest.distance : null;
}

function activeRoute() {
  if (LIVE_MODE) return live.route;
  return state.scene.route ? state.map[state.scene.route] || null : null;
}

// 활성 경로가 없으면 판정하지 않는다(null). 있으면 이탈 여부와 거리를 돌려준다.
function routeDeviation(point) {
  const route = activeRoute();
  if (!route || !point) return null;
  const offsetM = routeOffsetMeters(point, route);
  if (offsetM === null) return null;
  return {
    offRoute: offsetM > ROUTE_DEVIATION_THRESHOLD_M,
    offsetM,
    thresholdM: ROUTE_DEVIATION_THRESHOLD_M,
  };
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
  const banners = (state.scene.alert ? 1 : 0)
    + (document.querySelector("#routeAlert").hidden ? 0 : 1);
  const y = 44 + 72 * banners;
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

function basePoint() {
  if (LIVE_MODE) return live.fix;
  return walk.position || state.map[state.scene.current];
}

// 화면에 그릴 목적지. 시나리오는 지도 상수, live 는 저장된 웨이포인트다.
function targetPoint() {
  if (LIVE_MODE) return live.target;
  return state.scene.target ? state.map[state.scene.target] : null;
}

// D 키 시연 중에는 현재 위치를 가장 가까운 경로 선분의 직각 방향으로 밀어낸다.
function currentPoint() {
  const base = basePoint();
  const route = activeRoute();
  if (!state.routeDeviationDemo || !route || !base) return base;
  const nearest = nearestRouteSegment(base, route);
  if (!nearest) return base;
  const along = bearingDegrees(
    { lon: nearest.from[0], lat: nearest.from[1] },
    { lon: nearest.to[0], lat: nearest.to[1] }
  );
  return offsetPoint(base, along + 90, ROUTE_DEVIATION_DEMO_OFFSET_M);
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

  const drawnRoute = activeRoute();
  if (drawnRoute) {
    const route = drawnRoute;
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
  const basecamp = LIVE_MODE ? live.basecamp : state.map.basecamp;
  if (basecamp) drawMarker(basecamp, "BASE CAMP", cssVar("--amber"), projector, "triangle");

  const goal = targetPoint();
  if (LIVE_MODE) {
    if (goal && live.targetKind !== "basecamp") {
      drawMarker(goal, "목적지", cssVar("--cyan"), projector, "square");
    }
  } else if (goal && state.scene.target !== "basecamp") {
    drawMarker(goal, "목적지", cssVar("--cyan"), projector, "square");
  } else if (state.sceneKey >= 2) {
    drawMarker(state.map.destination, "목적지", cssVar("--cyan"), projector, "square");
  }

  if (state.checkpoint) {
    drawMarker(state.checkpoint, "체크포인트", cssVar("--cyan"), projector, "square");
  }
  const current = currentPoint();
  // fix 가 없으면 현재 위치 마커를 그리지 않는다. 마지막 좌표를 현재인 척하지 않는다.
  if (current) {
    drawAccuracyRing(current, projector);
    drawMarker(current, "현재", cssVar("--amber"), projector, "circle");
  }
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
  const subElement = element.querySelector(".sub");
  if (subElement && sub !== undefined) subElement.textContent = sub;
}

function temperatureLevel(celsius) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) return "none";
  if (value > 30) return "hot";
  if (value > 20) return "warm";
  return "cool";
}

function formatTemperature(celsius) {
  const fahrenheit = celsius * 9 / 5 + 32;
  return `${celsius.toFixed(1)}°C (${fahrenheit.toFixed(1)}°F)`;
}

function setEnvironmentGlance(environment) {
  const temperature = document.querySelector("#envTemperature");
  const humidity = document.querySelector("#envHumidity");
  temperature.dataset.level = temperatureLevel(environment.temperatureC);
  temperature.textContent = Number.isFinite(environment.temperatureC)
    ? formatTemperature(environment.temperatureC)
    : "—";
  humidity.textContent = Number.isFinite(environment.humidityPct)
    ? `${Math.round(environment.humidityPct)}% RH`
    : "— RH";
}

// CO 칸 색: 시나리오 값은 앰버(합성값), 실값은 normal 녹색 / warning 앰버 / alarm 적색 / 없음 회색.
function coGlanceState(co) {
  if (!state.live.enabled) return "caution";
  if (co.alarm || co.level === "alarm") return "warn";
  if (co.level === "warning") return "caution";
  if (co.valid) return "live";
  return "none";
}

function setCoGlance(co) {
  const text = co.valid && Number.isFinite(co.ppm)
    ? `${Math.round(co.ppm)} ppm`
    : co.warmingUp
      ? "예열 중"
      : "—";
  setGlance("#glanceCo", coGlanceState(co), text);
}

// /api/device 스냅샷에서 온·습도·CO만 가져온다. stale/invalid 값은 숫자로 만들지 않는다.
function applyLiveDevice(device) {
  if (!device || typeof device !== "object") return;
  const env = device.environment || {};
  const co = device.co || {};
  const envValid = env.valid === true && env.stale !== true;
  const coValid = co.valid === true && co.stale !== true && Number.isFinite(Number(co.ppm));
  state.environment = {
    temperatureC: envValid && Number.isFinite(Number(env.temp_c)) ? Number(env.temp_c) : NaN,
    humidityPct: envValid && Number.isFinite(Number(env.humidity_pct)) ? Number(env.humidity_pct) : NaN,
  };
  state.co = {
    valid: coValid,
    ppm: coValid ? Number(co.ppm) : NaN,
    level: typeof co.level === "string" ? co.level : "unknown",
    alarm: co.alarm === true,
    warmingUp: co.warming_up === true,
  };
  state.live.connected = true;
  state.live.updatedAt = performance.now();
  state.live.updates += 1;
  if (LIVE_MODE) applyLiveNavigation(device);
  render();
}

/* /api/device 의 좌표·경로·일조·도착 판정을 화면 상태로 옮긴다.
 * 값을 만들어 내지 않는다 — 서버가 주지 않으면 null 로 두고 화면이 "없음"을 보여 준다. */
function applyLiveNavigation(device) {
  live.device = device;

  const gps = device.gps || {};
  live.fix = gps.fix === true && Number.isFinite(Number(gps.lat)) && Number.isFinite(Number(gps.lon))
    ? { lon: Number(gps.lon), lat: Number(gps.lat) }
    : null;

  const navigation = device.navigation || {};
  const route = navigation.active_route || {};
  const usable = route.available === true
    && Array.isArray(route.coordinates)
    && route.coordinates.length > 1;
  live.route = usable ? route.coordinates : null;
  live.routeInfo = route.available === true ? route : null;

  const waypoints = device.waypoints || {};
  live.basecamp = livePoint(waypoints.basecamp);
  live.targetKind = navigation.selected_target || null;
  live.target = live.targetKind === "basecamp"
    ? live.basecamp
    : livePoint(waypoints.destination);

  const checkpoints = waypoints.checkpoints || [];
  state.checkpoint = checkpoints.length
    ? livePoint(checkpoints[checkpoints.length - 1])
    : null;

  live.sun = device.sun || null;

  const alert = device.alert;
  live.alertText = alert
    ? (alert.message || daylightWarningText())
    : null;

  const arrival = navigation.arrival || {};
  live.arrivalText = arrival.arrived === true
    ? `${(arrival.target && arrival.target.name) || "목적지"}에 도착하였습니다.`
    : null;

  const night = device.interface && device.interface.night;
  if (typeof night === "boolean" && night !== state.night) setNight(night, false);
}

function markLiveDisconnected() {
  if (!state.live.connected) return;
  state.live.connected = false;
  state.environment = { temperatureC: NaN, humidityPct: NaN };
  state.co = { valid: false, ppm: NaN, level: "unknown", alarm: false, warmingUp: false };
  if (LIVE_MODE) {
    // 끊긴 뒤에도 마지막 좌표를 현재 위치인 척 남겨 두지 않는다.
    live.fix = null;
    live.route = null;
    live.routeInfo = null;
    live.alertText = null;
    live.arrivalText = null;
  }
  render();
}

// SSE(/api/device/events)를 주 경로로, 폴링을 stale 감시·복구 경로로 쓴다.
function connectLiveSensors() {
  if (!state.live.enabled) return;
  const poll = async () => {
    try {
      const response = await fetch("/api/device", { cache: "no-store" });
      if (!response.ok) throw new Error("장치 상태 요청 실패");
      applyLiveDevice(await response.json());
    } catch (error) {
      // 서버가 아직 안 떴거나 끊긴 상태. 다음 주기에 다시 시도한다.
    }
  };
  let eventSource = null;
  if ("EventSource" in window) {
    eventSource = new EventSource("/api/device/events");
    eventSource.onmessage = (event) => {
      try {
        applyLiveDevice(JSON.parse(event.data));
      } catch (error) {
        // 깨진 이벤트는 버리고 폴링 경로가 복구한다.
      }
    };
  }
  state.environment = { temperatureC: NaN, humidityPct: NaN };
  state.co = { valid: false, ppm: NaN, level: "unknown", alarm: false, warmingUp: false };
  render();
  poll();
  window.setInterval(() => {
    const stale = performance.now() - state.live.updatedAt > LIVE_STALE_AFTER_MS;
    if (stale) markLiveDisconnected();
    if (stale || !eventSource) poll();
  }, LIVE_POLL_INTERVAL_MS);
}

function setRouteAlert(current) {
  const deviation = current ? routeDeviation(current) : null;
  const routeAlert = document.querySelector("#routeAlert");
  if (deviation && deviation.offRoute) {
    document.querySelector("#routeAlertText").textContent =
      `경로 이탈 · ${Math.round(deviation.offsetM)} m · 현재 위치와 경로를 확인하세요`;
    routeAlert.hidden = false;
    // 거리는 계속 변하므로 음성은 거리를 빼고 한 번만 읽는다.
    announce("routeAlert", "경로를 벗어났습니다. 현재 위치와 경로를 확인하세요.");
  } else {
    routeAlert.hidden = true;
    announce("routeAlert", "");
  }
  document.querySelector("#mapPanel").classList.toggle("has-route-alert", !routeAlert.hidden);
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

const etaTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function updateSeoulClock() {
  const parts = {};
  seoulClockFormatter.formatToParts(new Date()).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  document.querySelector("#locationClock").textContent =
    `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function normalizedDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function dayOfYear(year, month, day) {
  return Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000
  );
}

// NOAA 공개 근사식과 MAP/solar_service.py의 절차를 동일하게 적용한다.
function solarEventUtcHour(dateParts, latitude, longitude, sunrise) {
  const dayNumber = dayOfYear(dateParts.year, dateParts.month, dateParts.day);
  const longitudeHour = longitude / 15;
  const approximate = dayNumber + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximate - 3.289;
  const trueLongitude = normalizedDegrees(
    meanAnomaly
      + 1.916 * Math.sin(toRad(meanAnomaly))
      + 0.020 * Math.sin(toRad(2 * meanAnomaly))
      + 282.634
  );
  let rightAscension = normalizedDegrees(
    toDeg(Math.atan(0.91764 * Math.tan(toRad(trueLongitude))))
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(toRad(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const denominator = cosDeclination * Math.cos(toRad(latitude));
  if (Math.abs(denominator) < 1e-12) return null;
  const cosineHour = (
    Math.cos(toRad(OFFICIAL_ZENITH_DEG))
      - sinDeclination * Math.sin(toRad(latitude))
  ) / denominator;
  if (cosineHour > 1 || cosineHour < -1) return null;

  const hourAngle = (
    sunrise
      ? 360 - toDeg(Math.acos(cosineHour))
      : toDeg(Math.acos(cosineHour))
  ) / 15;
  const localMeanTime = hourAngle + rightAscension - 0.06571 * approximate - 6.622;
  return normalizedDegrees((localMeanTime - longitudeHour) * 15) / 15;
}

function seoulDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  });
  return parts;
}

function localDateKey(date) {
  const parts = seoulDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function solarEventDate(dateParts, latitude, longitude, sunrise) {
  const utcHour = solarEventUtcHour(dateParts, latitude, longitude, sunrise);
  if (utcHour === null) return null;
  const utcMidnight = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
  const targetKey = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
  const candidates = [-1, 0, 1].map((dayShift) =>
    new Date(utcMidnight + dayShift * 86400000 + Math.round(utcHour * 3600000))
  );
  return candidates.find((candidate) => localDateKey(candidate) === targetKey) || candidates[1];
}

function todayDaylight(now) {
  const currentTime = now || new Date();
  const dateParts = seoulDateParts(currentTime);
  const current = currentPoint();
  const sunset = solarEventDate(dateParts, current.lat, current.lon, false);
  const differenceMs = sunset ? sunset.getTime() - currentTime.getTime() : 0;
  const pastSunset = Boolean(sunset) && differenceMs < 0;
  const remainingMinutes = sunset
    ? Math.ceil(Math.abs(differenceMs) / 60000)
    : 0;
  return { sunset, remainingMinutes, pastSunset };
}

function daylightForDisplay() {
  if (LIVE_MODE) return liveDaylight();
  return state.daylightAlertSnapshot || todayDaylight();
}

/* live 모드의 일출몰은 서버 solar_service 가 실제 좌표로 계산한 값을 쓴다.
 * 클라이언트 천문 계산과 결과가 갈리지 않도록 화면은 서버 값만 읽는다. */
function liveDaylight() {
  const sun = live.sun;
  if (!sun || sun.computed !== true || !Number.isFinite(Number(sun.remaining_min))) {
    return { remainingMinutes: null, pastSunset: false, sunset: null };
  }
  const remaining = Number(sun.remaining_min);
  return {
    remainingMinutes: Math.abs(remaining),
    pastSunset: remaining < 0,
    sunset: sun.sunset ? new Date(sun.sunset) : null,
  };
}

/* 화면 위 경고 배너 문구. 시나리오는 장면이, live 는 서버 판정이 정한다. */
function currentAlertText() {
  if (LIVE_MODE) return live.alertText;
  return state.scene.alert ? daylightWarningText() : null;
}

function currentArrivalText() {
  if (LIVE_MODE) return live.arrivalText;
  return state.scene.arrival || null;
}

function daylightWarningText() {
  const { remainingMinutes, pastSunset } = daylightForDisplay();
  if (pastSunset) {
    return "일몰 시간이 지났습니다. 귀환 권고 시각과 베이스캠프 경로를 확인하세요.";
  }
  return `해 지기까지 ${remainingMinutes}분 남았습니다. 귀환 권고 시각과 베이스캠프 경로를 확인하세요.`;
}

function formatDaylightRemaining(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest === 0) return `${hours}시간 남음`;
  if (hours > 0) return `${hours}시간 ${rest}분 남음`;
  return `${rest}분 남음`;
}

function formatDaylightStatus(daylight) {
  if (daylight.remainingMinutes === null) return "계산 대기";
  if (daylight.pastSunset) return `${daylight.remainingMinutes}분 초과`;
  return formatDaylightRemaining(daylight.remainingMinutes);
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function setCurrentCoordinateGlance(current) {
  const glance = document.querySelector("#glanceCoordinate");
  const latitude = document.querySelector("#currentLatitude");
  const longitude = document.querySelector("#currentLongitude");
  if (!current) {
    // GPS 미수신을 추정 좌표로 덮지 않는다(안전 경계).
    glance.dataset.state = "none";
    latitude.textContent = "좌표 없음";
    longitude.textContent = "GPS 미수신";
    return;
  }
  glance.dataset.state = "caution";
  latitude.textContent = `${formatCoordinate(current.lat)} N`;
  longitude.textContent = `${formatCoordinate(current.lon)} E`;
}

function setDaylightGlance(scene) {
  const element = document.querySelector("#glanceSun");
  const value = document.querySelector("#daylightValue");
  const sub = document.querySelector("#daylightSub");
  const daylight = daylightForDisplay();
  element.dataset.state = currentAlertText() ? "warn" : "normal";
  value.classList.remove("sun-times");
  value.textContent = formatDaylightStatus(daylight);
  sub.hidden = false;
  sub.textContent = daylight.sunset
    ? `금일 일몰 ${etaTimeFormatter.format(daylight.sunset)}`
    : LIVE_MODE ? "GPS 위치 필요" : "금일 일몰 계산 불가";
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
  speak(message);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration || 2600);
}

function audioDurationMs(selector, fallback) {
  const audio = document.querySelector(selector);
  const duration = audio ? audio.duration : Number.NaN;
  return Number.isFinite(duration) && duration > 0
    ? Math.ceil((duration + 0.45) * 1000)
    : fallback;
}

function cancelAutoDemo() {
  autoDemo.runId += 1;
  autoDemo.active = false;
  autoDemo.timers.forEach((timer) => window.clearTimeout(timer));
  autoDemo.timers.clear();
  if (autoDemo.walkResolver) {
    const resolve = autoDemo.walkResolver;
    autoDemo.walkResolver = null;
    resolve(false);
  }
}

function waitForAutoDemo(runId, milliseconds) {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      autoDemo.timers.delete(timer);
      resolve(autoDemo.active && autoDemo.runId === runId);
    }, milliseconds);
    autoDemo.timers.add(timer);
  });
}

function waitForAutoWalk(runId) {
  return new Promise((resolve) => {
    autoDemo.walkResolver = (reachedDestination) => {
      autoDemo.walkResolver = null;
      resolve(reachedDestination && autoDemo.active && autoDemo.runId === runId);
    };
  });
}

function completeAutoWalk(reachedDestination) {
  if (!autoDemo.walkResolver) return;
  const resolve = autoDemo.walkResolver;
  autoDemo.walkResolver = null;
  resolve(reachedDestination);
}

function render() {
  const scene = state.scene;
  const current = currentPoint();
  setDaylightGlance(scene);
  updateSeoulClock();
  setCurrentCoordinateGlance(current);
  setEnvironmentGlance(state.environment);
  setCoGlance(state.co);
  setRouteAlert(current);

  const alertText = currentAlertText();
  const alertBox = document.querySelector("#alert");
  if (alertText) {
    document.querySelector("#alertText").textContent = alertText;
    alertBox.hidden = false;
  } else {
    alertBox.hidden = true;
  }
  document.querySelector("#mapPanel").classList.toggle("has-alert", Boolean(alertText));
  if (LIVE_MODE) announce("alert", alertText);
  const arrivalCard = document.querySelector("#arrivalCard");
  const arrivalText = currentArrivalText();
  if (arrivalText) {
    document.querySelector("#arrivalText").textContent = arrivalText;
    arrivalCard.hidden = false;
  } else {
    arrivalCard.hidden = true;
  }
  if (LIVE_MODE) announce("arrival", arrivalText);

  const target = targetPoint();
  const readout = document.querySelector("#readout");
  if (LIVE_MODE) {
    renderLiveReadout(readout, current);
  } else if (!target) {
    readout.hidden = true;
  } else {
    readout.hidden = false;
    const targetLabel = scene.target === "basecamp" ? "BASE CAMP" : "목적지";
    document.querySelector("#readoutLabel").textContent = targetLabel;
    document.querySelector("#readoutBearing").textContent =
      `${String(Math.round(bearingDegrees(current, target))).padStart(3, "0")}°`;
    const route = state.map[scene.route];
    const total = pathLengthMeters(route);
    const remaining = walk.routeKey === scene.route
      ? Math.max(0, total - walk.meters)
      : total;
    const remainingSeconds = remaining / walk.speedMps;
    const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));
    const arrivalTime = new Date(Date.now() + remainingSeconds * 1000);
    document.querySelector("#readoutDistance").textContent = `${Math.round(remaining)} m`;
    document.querySelector("#readoutEta").textContent =
      `예상 도착 ${etaTimeFormatter.format(arrivalTime)} KST`;
    document.querySelector("#readoutRemainingTime").textContent =
      `약 ${remainingMinutes}분 남음`;
  }

  document.querySelector("#mapAttribution").textContent = state.map.attribution;
  if (!LIVE_MODE) {
    document.querySelector("#directorKey").textContent = String(state.sceneKey);
    document.querySelector("#directorScene").textContent = scene.title;
  }
  draw();
}

/* live 판독 카드. 방위·거리·예상 도착은 전부 map_engine 이 계산한 값이고
 * 화면은 그대로 읽어 준다(LLM 이 만든 값이 아니다). */
function renderLiveReadout(readout, current) {
  const info = live.routeInfo;
  if (!info || !current) {
    readout.hidden = true;
    return;
  }
  readout.hidden = false;
  document.querySelector("#readoutLabel").textContent =
    live.targetKind === "basecamp" ? "BASE CAMP" : "목적지";
  document.querySelector("#readoutBearing").textContent =
    `${String(Math.round(Number(info.bearing_deg) || 0)).padStart(3, "0")}°`;
  const distance = Math.round(Number(info.distance_m) || 0);
  document.querySelector("#readoutDistance").textContent = `${distance} m`;
  const minutes = Number.isFinite(Number(info.eta_min))
    ? Math.max(1, Math.ceil(Number(info.eta_min)))
    : Math.max(1, Math.ceil(distance / walk.speedMps / 60));
  document.querySelector("#readoutEta").textContent =
    `예상 도착 ${etaTimeFormatter.format(new Date(Date.now() + minutes * 60000))} KST`;
  document.querySelector("#readoutRemainingTime").textContent = `약 ${minutes}분 남음`;
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
    completeAutoWalk(true);
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

/* 화면에 뜬 문구는 전부 같은 목소리로 읽어 준다.
 *
 * 브라우저 speechSynthesis 는 쓰지 않는다 — Jetson Firefox 에서는 espeak 남성
 * 기계음으로 떨어져 제품 음성(sherpa KSS 여성 0.9배속)과 목소리가 갈린다.
 * 서버 /api/tts 가 같은 파라미터로 합성해 주고, 같은 문장은 서버가 캐시한다.
 *
 * 음성은 보조 수단이다. 합성이 안 되면 조용히 넘어가고 글자는 그대로 남는다. */
const speech = {
  audio: null,
  objectUrl: "",
  lastText: "",
  lastAt: 0,
  unavailable: false,   // 모델이 없는 환경에서 매번 요청하지 않는다
};

async function speak(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned || speech.unavailable) return;
  // 같은 문장이 연달아 렌더될 때 겹쳐 읽지 않는다.
  const now = Date.now();
  if (cleaned === speech.lastText && now - speech.lastAt < 6000) return;
  speech.lastText = cleaned;
  speech.lastAt = now;

  let blob;
  try {
    // <audio src> 대신 fetch 로 받는다. 모델이 없는 개발 PC 에서 503 이 와도
    // 콘솔에 리소스 오류를 남기지 않는다.
    const response = await fetch(`/api/tts?text=${encodeURIComponent(cleaned)}`);
    if (!response.ok) return;
    // 음성이 없는 장치는 JSON 으로 그 사실을 알려 준다. 그 뒤로는 요청하지 않는다.
    if (!String(response.headers.get("Content-Type") || "").startsWith("audio/")) {
      speech.unavailable = true;
      return;
    }
    blob = await response.blob();
  } catch (error) {
    return;  // 음성이 없어도 글자는 그대로 보인다
  }

  if (speech.audio) speech.audio.pause();
  if (speech.objectUrl) URL.revokeObjectURL(speech.objectUrl);
  speech.objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(speech.objectUrl);
  speech.audio = audio;
  const playing = audio.play();
  if (playing && typeof playing.catch === "function") {
    playing.catch(() => {});
  }
}

/* 배너·카드처럼 render 마다 다시 그려지는 것은 문구가 바뀐 순간에만 읽는다.
 * 촬영 화면의 목적지·도착·복귀는 미리 녹음한 WAV 가 따로 있으므로 겹치지 않게
 * 제품 화면에서만 읽는다. 경로 이탈 경고는 녹음이 없어 두 화면 모두 읽는다. */
const announced = { alert: "", arrival: "", routeAlert: "" };

function announce(key, text) {
  const value = String(text || "");
  if (announced[key] === value) return;
  announced[key] = value;
  if (value) speak(value);
}

function playDaylightAudio() {
  speak(daylightWarningText());
}

/* 지금 읽고 있는 문장의 남은 길이(ms). 자동 시연이 문장 중간에 다음 장면으로
 * 넘어가 음성이 잘리지 않게 쓴다. 값이 이상하면 시연이 멈추지 않도록 상한을 둔다. */
function speechRemainingMs() {
  const audio = speech.audio;
  if (!audio || audio.paused || audio.ended) return 0;
  const remaining = (Number(audio.duration) - Number(audio.currentTime)) * 1000;
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.min(8000, Math.round(remaining));
}

function playFixedAudio(kind) {
  if (kind === "warning" || kind === "daylightDetail") {
    playDaylightAudio();
    return;
  }
  const fixedAudio = {
    destination: {
      selector: "#destinationAudio",
      text: "가장 가까운 지점에 호수가 있습니다. 이곳을 목적지로 지정할까요? 네, 목적지로 설정되었습니다.",
    },
    arrival: {
      selector: "#arrivalAudio",
      text: "목적지에 도착하였습니다.",
    },
    basecamp: {
      selector: "#basecampAudio",
      text: "Base Camp에 도착하였습니다.",
    },
  };
  const selected = fixedAudio[kind] || fixedAudio.destination;
  const audio = document.querySelector(selected.selector);
  audio.currentTime = 0;
  const playing = audio.play();
  if (playing && typeof playing.catch === "function") {
    playing.catch(() => speak(selected.text));
  }
}

function setScene(key, options) {
  const sceneKey = Number(key);
  if (!SCENES[sceneKey]) return;
  window.clearTimeout(walkStartTimer);
  stopWalk(false);
  setDestinationSelection(false);
  state.routeDeviationDemo = false;
  state.sceneKey = sceneKey;
  state.scene = SCENES[sceneKey];
  state.daylightAlertSnapshot = sceneKey === 5 ? todayDaylight() : null;
  showToast(state.scene.toast, sceneKey === 4 || sceneKey === 7 ? 4000 : 2600);
  render();

  const withAudio = !options || options.audio !== false;
  if (sceneKey === 2 && withAudio) playFixedAudio("destination");
  if (sceneKey === 4 && withAudio) playFixedAudio("arrival");
  if (sceneKey === 5 && withAudio) playFixedAudio("warning");
  if (sceneKey === 7 && withAudio) playFixedAudio("basecamp");
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

async function selectLiveDestination(event) {
  if (!live.selecting) return;
  const rect = canvas.getBoundingClientRect();
  const point = projection().fromScreen(event.clientX - rect.left, event.clientY - rect.top);
  try {
    await postWaypoint({
      action: "set", kind: "destination", lat: point.lat, lon: point.lon,
    });
    showToast("목적지를 지정했습니다.", 2400);
  } catch (error) {
    showToast(error.message, 2600);
  }
  live.selecting = false;
  setDestinationSelection(false);
  render();
}

function selectMapDestination(event) {
  if (LIVE_MODE) {
    selectLiveDestination(event);
    return;
  }
  cancelAutoDemo();
  if (!state.destinationSelecting) return;
  state.routeDeviationDemo = false;
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
  state.daylightAlertSnapshot = null;
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
  state.routeDeviationDemo = false;
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
    routeSub: "BASE CAMP",
  };
  state.daylightAlertSnapshot = null;
  render();
  showToast("베이스캠프 복귀 경로가 설정되었습니다.", 2800);
}

// `A` 또는 auto_demo_ssh.sh가 시작하는 촬영용 원테이크 시퀀스.
// 장면 3·6은 경로 길이를 코드로 계산해 마커가 끝에 도달한 뒤 다음 장면으로 넘어간다.
async function startAutoDemo() {
  cancelAutoDemo();
  const runId = autoDemo.runId;
  autoDemo.active = true;

  setNight(false, false);
  setScene(1, { audio: false, autoWalk: false });
  handleBasecampButton();
  if (!await waitForAutoDemo(runId, AUTO_DEMO_DELAYS_MS.basecampRegistered)) return;

  setScene(2, { autoWalk: false });
  if (!await waitForAutoDemo(
    runId,
    audioDurationMs("#destinationAudio", AUTO_DEMO_DELAYS_MS.destinationFallback)
  )) return;

  const outboundCompleted = waitForAutoWalk(runId);
  setScene(3);
  if (!await outboundCompleted) return;
  if (!await waitForAutoDemo(
    runId,
    audioDurationMs("#arrivalAudio", AUTO_DEMO_DELAYS_MS.arrivalFallback)
  )) return;

  setScene(5, { autoWalk: false });
  if (!await waitForAutoDemo(runId, AUTO_DEMO_DELAYS_MS.warningFallback)) return;
  // 일조 경고는 합성 문장이라 길이가 그때그때 다르다(해 지기까지 남은 분이 들어간다).
  // 고정 대기(6.2 s)보다 길면 끝까지 들려주고 넘어간다 — 다음 장면 안내가 말을 자르지 않게.
  if (!await waitForAutoDemo(runId, speechRemainingMs())) return;

  const returnCompleted = waitForAutoWalk(runId);
  showBasecampRoute();
  if (!await waitForAutoDemo(runId, AUTO_DEMO_DELAYS_MS.returnRouteShown)) return;
  if (!autoDemo.active || autoDemo.runId !== runId) return;
  startWalk();
  if (!await returnCompleted) return;
  if (!await waitForAutoDemo(
    runId,
    audioDurationMs("#basecampAudio", AUTO_DEMO_DELAYS_MS.basecampArrival)
  )) return;

  setNight(true, true);
  await waitForAutoDemo(runId, AUTO_DEMO_DELAYS_MS.nightMode);
  if (autoDemo.runId === runId) autoDemo.active = false;
}

// D 키: 현재 위치를 경로에서 45 m 밀어내 경로 이탈 경고를 시연한다. 자동 시연은 멈추지 않는다.
function toggleRouteDeviationDemo() {
  if (!activeRoute()) {
    showToast("활성 경로가 없어 이탈 판정을 하지 않습니다.", 2400);
    return;
  }
  state.routeDeviationDemo = !state.routeDeviationDemo;
  render();
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

/* live 모드 조작. 저장·경로 선택은 전부 서버가 판정하고 화면은 결과만 받는다. */
async function postWaypoint(payload) {
  const response = await fetch("/api/waypoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "저장 지점 요청 실패");
  applyLiveDevice(result);
  return result;
}

async function postVoiceCommand(action) {
  const response = await fetch("/api/voice/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "음성 지도 명령 실패");
  applyVoiceEvent(result);
  return result;
}

function applyVoiceEvent(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.device) applyLiveDevice(payload.device);
  if (Number.isFinite(payload.sequence)) {
    live.lastVoiceSequence = Math.max(live.lastVoiceSequence, payload.sequence);
  }
  if (payload.message) showToast(payload.message, 3800);
  render();
}

function connectVoiceEvents() {
  if (!LIVE_MODE || !("EventSource" in window)) return;
  const source = new EventSource("/api/voice/events");
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (Number.isFinite(payload.sequence) && payload.sequence <= live.lastVoiceSequence) return;
      applyVoiceEvent(payload);
    } catch (error) {
      showToast("음성 지도 명령을 화면에 반영하지 못했습니다.", 2600);
    }
  };
}

document.querySelector("#btnDestination").addEventListener("click", () => {
  if (LIVE_MODE) {
    live.selecting = !live.selecting;
    setDestinationSelection(live.selecting);
    showToast(live.selecting ? "지도에서 목적지를 터치하세요." : "목적지 지정을 취소했습니다.", 2400);
    return;
  }
  cancelAutoDemo();
  setDestinationSelection(!state.destinationSelecting);
});
document.querySelector("#btnCheckpoint").addEventListener("click", async () => {
  if (LIVE_MODE) {
    try {
      await postWaypoint({ action: "save_current", kind: "checkpoint" });
      showToast("현재 위치를 체크포인트로 저장했습니다.", 2400);
    } catch (error) {
      showToast(error.message, 2600);
    }
    return;
  }
  cancelAutoDemo();
  saveCheckpoint();
});
document.querySelector("#btnBasecamp").addEventListener("click", async () => {
  if (LIVE_MODE) {
    try {
      if (live.basecamp) {
        await postWaypoint({ action: "select", id: "basecamp" });
        showToast("베이스캠프 귀환 경로를 불러왔습니다.", 2800);
      } else {
        await postWaypoint({ action: "save_current", kind: "basecamp" });
        showToast("현재 위치를 베이스캠프로 저장했습니다.", 2800);
      }
    } catch (error) {
      showToast(error.message, 2600);
    }
    return;
  }
  cancelAutoDemo();
  handleBasecampButton();
});
document.querySelector("#btnNight").addEventListener("click", () => {
  cancelAutoDemo();
  setNight(!state.night, true);
});
canvas.addEventListener("click", selectMapDestination);

// 아래 키 조작과 디렉터 패널은 촬영 전용이다. 제품 화면에는 달지 않는다.
if (!LIVE_MODE) window.addEventListener("keydown", (event) => {
  if (event.key === "a" || event.key === "A") {
    event.preventDefault();
    startAutoDemo();
  } else if (/^[1-7]$/.test(event.key)) {
    cancelAutoDemo();
    setScene(Number(event.key));
  } else if (event.code === "Space") {
    event.preventDefault();
    cancelAutoDemo();
    nextScene();
  } else if (event.key === "b" || event.key === "B") {
    cancelAutoDemo();
    const audioKind = state.sceneKey === 5
      ? "warning"
      : state.sceneKey === 7
        ? "basecamp"
        : state.sceneKey === 4
        ? "arrival"
        : "destination";
    playFixedAudio(audioKind);
  } else if (event.key === "t" || event.key === "T") {
    cancelAutoDemo();
    playFixedAudio("daylightDetail");
  } else if (event.key === "r" || event.key === "R") {
    cancelAutoDemo();
    setScene(1, { audio: false });
  } else if (event.key === "n" || event.key === "N") {
    cancelAutoDemo();
    setNight(!state.night, true);
  } else if (event.key === "c" || event.key === "C") {
    cancelAutoDemo();
    saveCheckpoint();
  } else if (event.key === "d" || event.key === "D") {
    toggleRouteDeviationDemo();
  } else if (event.key === "h" || event.key === "H") {
    const panel = document.querySelector("#director");
    panel.hidden = !panel.hidden;
  }
});

// 브라우저 QA(tests/ui_video_qa.js) 전용 훅. 제품 조작 경로가 아니다.
window.ogtechVideoQa = Object.freeze({
  temperatureLevel,
  routeOffsetMeters,
  routeDeviation: () => routeDeviation(currentPoint()),
  setEnvironment(next) {
    state.environment = { ...state.environment, ...next };
    render();
  },
  toggleRouteDeviationDemo,
});

// autoplay=1 은 1회, autoplay=loop 는 촬영이 끝날 때까지 반복한다.
async function startAutoplay() {
  await new Promise((resolve) => window.setTimeout(resolve, AUTOPLAY_START_DELAY_MS));
  for (;;) {
    await startAutoDemo();
    if (AUTOPLAY_MODE !== "loop") return;
    await new Promise((resolve) => window.setTimeout(resolve, AUTOPLAY_LOOP_PAUSE_MS));
  }
}

window.addEventListener("resize", draw);
setNight(false);
if (LIVE_MODE) {
  // 촬영 시나리오를 쓰지 않는다. 그림틀만 같고 값은 전부 /api/device 에서 온다.
  document.querySelector("#director").hidden = true;
  state.scene = { ...SCENES[1], current: null, target: null, route: null, alert: null, arrival: null };
  connectVoiceEvents();
  render();
} else {
  setScene(1, { audio: false });
}
window.setInterval(() => {
  updateSeoulClock();
  setDaylightGlance(state.scene);
}, 1000);

// URL 파라미터 반영. 두 함수 모두 파라미터가 없으면 스스로 아무것도 하지 않는다.
connectLiveSensors();
if (AUTOPLAY_MODE) startAutoplay();
