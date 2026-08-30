/* OGTECH 건국대학교 시연 영상 전용 MAP — 1024x600
 *
 * 기본 상태의 현재 위치·센서 값은 촬영용 합성값이다. 그래서 녹색 LIVE 상태를 쓰지 않는다.
 * URL 파라미터 `?live=1`을 붙이면 온·습도·CO 칸만 app.py의 /api/device(STM32 텔레메트리)
 * 실값으로 바뀌고 유효한 CO는 녹색 LIVE로 표시한다. 위치·경로는 여전히 시나리오다.
 * `?autoplay=1`(1회) 또는 `?autoplay=loop`(반복)는 로드 직후 `A` 키와 같은 원테이크를 시작한다.
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
const LIVE_SENSORS = PAGE_PARAMS.get("live") === "1";
const AUTOPLAY_MODE = ["1", "loop"].includes(PAGE_PARAMS.get("autoplay") || "")
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
  return walk.position || state.map[state.scene.current];
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
    const targetLabel = "목적지";
    drawMarker(sceneTarget, targetLabel, cssVar("--cyan"), projector, "square");
  } else if (state.sceneKey >= 2) {
    drawMarker(state.map.destination, "목적지", cssVar("--cyan"), projector, "square");
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
  render();
}

function markLiveDisconnected() {
  if (!state.live.connected) return;
  state.live.connected = false;
  state.environment = { temperatureC: NaN, humidityPct: NaN };
  state.co = { valid: false, ppm: NaN, level: "unknown", alarm: false, warmingUp: false };
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
  const deviation = routeDeviation(current);
  const routeAlert = document.querySelector("#routeAlert");
  if (deviation && deviation.offRoute) {
    document.querySelector("#routeAlertText").textContent =
      `경로 이탈 · ${Math.round(deviation.offsetM)} m · 현재 위치와 경로를 확인하세요`;
    routeAlert.hidden = false;
  } else {
    routeAlert.hidden = true;
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
  return state.daylightAlertSnapshot || todayDaylight();
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
  if (daylight.pastSunset) return `${daylight.remainingMinutes}분 초과`;
  return formatDaylightRemaining(daylight.remainingMinutes);
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function setCurrentCoordinateGlance(current) {
  document.querySelector("#currentLatitude").textContent =
    `${formatCoordinate(current.lat)} N`;
  document.querySelector("#currentLongitude").textContent =
    `${formatCoordinate(current.lon)} E`;
}

function setDaylightGlance(scene) {
  const element = document.querySelector("#glanceSun");
  const value = document.querySelector("#daylightValue");
  const sub = document.querySelector("#daylightSub");
  const daylight = daylightForDisplay();
  element.dataset.state = scene.alert ? "warn" : "normal";
  value.classList.remove("sun-times");
  value.textContent = formatDaylightStatus(daylight);
  sub.hidden = false;
  sub.textContent = daylight.sunset
    ? `금일 일몰 ${etaTimeFormatter.format(daylight.sunset)}`
    : "금일 일몰 계산 불가";
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

  const alertBox = document.querySelector("#alert");
  if (scene.alert) {
    document.querySelector("#alertText").textContent = daylightWarningText();
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

function fallbackSpeech(text) {
  if (!("speechSynthesis" in window)) return false;
  const koreanVoice = window.speechSynthesis.getVoices().find((voice) =>
    String(voice.lang).toLowerCase().startsWith("ko")
  );
  if (!koreanVoice) return false;
  window.speechSynthesis.cancel();
  const message = new SpeechSynthesisUtterance(text);
  message.lang = "ko-KR";
  message.voice = koreanVoice;
  message.rate = 0.92;
  window.speechSynthesis.speak(message);
  return true;
}

function playDaylightAudio() {
  if (fallbackSpeech(daylightWarningText())) return;
  showToast("한국어 TTS가 없어 일조 경고는 화면에만 표시합니다", 3200);
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
    playing.catch(() => fallbackSpeech(selected.text));
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

function selectMapDestination(event) {
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

document.querySelector("#btnDestination").addEventListener("click", () => {
  cancelAutoDemo();
  setDestinationSelection(!state.destinationSelecting);
});
document.querySelector("#btnCheckpoint").addEventListener("click", () => {
  cancelAutoDemo();
  saveCheckpoint();
});
document.querySelector("#btnBasecamp").addEventListener("click", () => {
  cancelAutoDemo();
  handleBasecampButton();
});
document.querySelector("#btnNight").addEventListener("click", () => {
  cancelAutoDemo();
  setNight(!state.night, true);
});
canvas.addEventListener("click", selectMapDestination);

window.addEventListener("keydown", (event) => {
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

// 시연은 실외에서 하고 키보드가 없다. 화면 오른쪽 가장자리에 보이지 않는 세로 띠를 두고
// 두 번 누르면 Space 와 똑같이(cancelAutoDemo + nextScene) 다음 장면으로 넘어간다.
// 촬영에 잡히지 않도록 평소에는 아무것도 그리지 않는다. 첫 번째 터치에만 안쪽 모서리에
// 1px 선이 잠깐 떠서 "한 번 눌렸다"는 것만 알려 준다.
// 아래 96px 은 조작 버튼 4개 자리라 비워 두고, 위 504px(계기 84 + 지도 420)만 덮는다.
const SCENE_STRIP_WIDTH_PX = 56;      // 8.4mm — 베젤을 잡은 엄지로 누르기 충분하다
const SCENE_STRIP_ARM_MS = 1200;      // 이 안에 한 번 더 눌러야 넘어간다

function installSceneAdvanceStrip() {
  const screen = document.querySelector(".screen");
  if (!screen) return;

  const strip = document.createElement("button");
  strip.type = "button";
  strip.id = "sceneAdvanceStrip";
  strip.setAttribute("aria-label", "다음 장면으로 넘기기 (두 번 누르기)");
  Object.assign(strip.style, {
    position: "absolute",
    top: "0",
    right: "0",
    width: `${SCENE_STRIP_WIDTH_PX}px`,
    height: "calc(100% - 96px)",
    margin: "0",
    padding: "0",
    border: "0",
    borderLeft: "1px solid transparent",
    background: "transparent",
    cursor: "pointer",
    zIndex: "800",
    appearance: "none",
    outline: "none",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  });

  let armedUntil = 0;
  let armTimer = 0;

  const disarm = () => {
    armedUntil = 0;
    strip.style.borderLeftColor = "transparent";
  };

  strip.addEventListener("click", (event) => {
    // 지도 캔버스의 목적지 지정 클릭으로 새어 나가지 않게 막는다.
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now <= armedUntil) {
      window.clearTimeout(armTimer);
      disarm();
      cancelAutoDemo();
      nextScene();
      return;
    }
    armedUntil = now + SCENE_STRIP_ARM_MS;
    strip.style.borderLeftColor = cssVar("--amber");
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(disarm, SCENE_STRIP_ARM_MS);
  });

  screen.append(strip);
}

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
setScene(1, { audio: false });
window.setInterval(() => {
  updateSeoulClock();
  setDaylightGlance(state.scene);
}, 1000);

// URL 파라미터 반영. 두 함수 모두 파라미터가 없으면 스스로 아무것도 하지 않는다.
connectLiveSensors();
if (AUTOPLAY_MODE) startAutoplay();
installSceneAdvanceStrip();
