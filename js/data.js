const fixedCard = (id, title, subtitle, danger, steps, supplies = []) =>
  Object.freeze({ id, title, subtitle, danger, steps, supplies });

export const SCENARIOS = Object.freeze({
  bleeding: fixedCard(
    "bleeding",
    "출혈",
    "상처를 직접 압박하고 위험 신호를 확인합니다.",
    "피가 분출하거나 압박해도 멈추지 않으면 즉시 구조 도움을 요청하세요.",
    [
      "가능하면 장갑을 끼고 주변이 안전한지 확인합니다.",
      "멸균 거즈나 깨끗한 천을 상처 위에 올리고 손바닥으로 계속 누릅니다.",
      "피가 배어나와도 거즈를 떼지 말고 그 위에 더 올려 압박을 유지합니다.",
    ],
    [
      { slot: "A", name: "멸균 거즈" },
      { slot: "B", name: "압박 붕대" },
    ],
  ),
  cut: fixedCard(
    "cut",
    "베임·찰과상",
    "가벼운 상처를 세척하고 보호합니다.",
    "출혈이 계속되거나 깊게 박힌 물체가 있으면 직접 제거하지 마세요.",
    [
      "가능하면 손을 씻거나 장갑을 착용합니다.",
      "깨끗한 물이나 생리식염수로 상처 주변을 부드럽게 씻습니다.",
      "멸균 거즈로 덮고 붕대로 느슨하게 고정합니다.",
    ],
    [
      { slot: "A", name: "멸균 거즈" },
      { slot: "C", name: "생리식염수" },
    ],
  ),
  burn: fixedCard(
    "burn",
    "화상",
    "열원에서 벗어나 화상 부위를 식힙니다.",
    "얼굴·손·관절의 화상, 넓은 화상, 호흡 이상은 구조 도움 대상입니다.",
    [
      "불, 뜨거운 물체, 전기 등 원인에서 벗어납니다.",
      "가능하면 흐르는 시원한 물로 20분 정도 식힙니다. 얼음을 직접 대지 않습니다.",
      "화상 패드나 깨끗한 천으로 느슨하게 덮고 물집은 터뜨리지 않습니다.",
    ],
    [{ slot: "C", name: "화상 패드" }],
  ),
  foreign_object: fixedCard(
    "foreign_object",
    "절단·이물질 위험",
    "깊게 박힌 물체를 빼지 않고 주변을 고정합니다.",
    "절단, 깊은 이물질, 대량 출혈은 즉시 구조 도움 대상입니다.",
    [
      "깊게 박힌 물체는 제거하지 않습니다.",
      "물체 자체가 아닌 주변에 거즈를 대어 출혈을 줄입니다.",
      "붕대나 천으로 주변을 느슨하게 고정하고 움직임을 줄입니다.",
    ],
    [
      { slot: "A", name: "멸균 거즈" },
      { slot: "B", name: "압박 붕대" },
    ],
  ),
  splint: fixedCard(
    "splint",
    "골절·염좌 의심",
    "다친 부위를 현재 자세에서 지지합니다.",
    "뼈가 보이거나 손끝·발끝의 색과 감각이 변하면 구조 도움을 요청하세요.",
    [
      "다친 부위를 억지로 펴거나 맞추지 않습니다.",
      "수건, 옷, 판으로 다친 부위의 위아래를 함께 받칩니다.",
      "너무 세지 않게 고정하고 손끝·발끝의 색과 감각을 확인합니다.",
    ],
    [{ slot: "B", name: "부목·붕대" }],
  ),
  hypothermia: fixedCard(
    "hypothermia",
    "저체온·동상 위험",
    "바람과 비를 피하고 몸통부터 보온합니다.",
    "의식 저하, 호흡 이상, 떨림 중단은 즉시 구조 도움 대상입니다.",
    [
      "가능한 빨리 따뜻하고 건조한 장소로 이동합니다.",
      "젖은 옷을 벗기고 보온포나 담요로 몸통부터 감쌉니다.",
      "완전히 의식이 있을 때만 따뜻한 음료를 천천히 마시게 합니다.",
    ],
    [{ slot: "D", name: "보온포" }],
  ),
  heat: fixedCard(
    "heat",
    "더위·탈수",
    "시원한 곳으로 이동하고 몸을 식힙니다.",
    "의식이 없거나 혼란스럽고 피부가 매우 뜨거우면 즉시 구조 도움을 요청하세요.",
    [
      "그늘이나 냉방 가능한 곳으로 이동하고 활동을 멈춥니다.",
      "조이는 장비와 옷을 느슨하게 하고 몸을 식힙니다.",
      "의식이 분명할 때만 물이나 전해질 음료를 천천히 마십니다.",
    ],
    [{ slot: "D", name: "냉찜질팩" }],
  ),
  co: fixedCard(
    "co",
    "일산화탄소 의심",
    "밀폐 공간에서 벗어나 신선한 공기가 있는 곳으로 이동합니다.",
    "본인의 안전을 먼저 확보하고, 밖으로 나온 뒤 즉시 구조 도움을 요청하세요.",
    [
      "가능한 빨리 신선한 공기가 있는 곳으로 이동합니다.",
      "밖으로 나온 뒤 구조 도움을 요청합니다.",
      "구조대가 안전하다고 하기 전까지 밀폐 공간에 다시 들어가지 않습니다.",
    ],
  ),
  bite: fixedCard(
    "bite",
    "벌 쏘임·뱀 물림",
    "현장에서 떨어져 움직임을 줄이고 전신 반응을 확인합니다.",
    "호흡 곤란, 전신 부종, 의식 저하 또는 뱀 물림은 구조 도움 대상입니다.",
    [
      "벌이나 뱀이 있는 장소에서 안전한 곳으로 이동합니다.",
      "다친 부위를 심장보다 낮게 두고 움직임을 줄입니다.",
      "상처를 째거나 빨지 말고 전신 반응을 계속 확인합니다.",
    ],
    [{ slot: "D", name: "냉찜질팩" }],
  ),
  cpr: fixedCard(
    "cpr",
    "성인 심폐소생술",
    "반응과 정상 호흡이 없으면 구조 요청과 가슴압박을 시작합니다.",
    "현장이 위험하면 먼저 본인의 안전을 확보하세요.",
    [
      "주변 사람을 지목해 119 신고와 자동심장충격기 요청을 부탁합니다.",
      "가슴 중앙에 두 손을 겹치고 강하고 빠르게 가슴압박을 시행합니다.",
      "구조대가 도착하거나 정상 호흡이 돌아올 때까지 중단하지 않습니다.",
    ],
  ),
  unknown: fixedCard(
    "unknown",
    "직접 선택 필요",
    "말씀하신 상황을 안전하게 분류하지 못했습니다.",
    "생명 위험이 의심되면 분류를 다시 시도하지 말고 즉시 위험 도움으로 이동하세요.",
    ["아래 상황 목록에서 가장 가까운 항목을 직접 선택합니다."],
  ),
});

export const SCENARIO_ORDER = Object.freeze([
  "bleeding",
  "cut",
  "burn",
  "foreign_object",
  "splint",
  "hypothermia",
  "heat",
  "co",
  "bite",
]);

export const INVENTORY_ITEMS = Object.freeze([
  { id: "gauze", slot: "A", name: "멸균 거즈", aliases: ["거즈"], quantity: 10, expiry: "2027-11-30", led: "#f04b43", available: true, autoOpenAllowed: true },
  { id: "gloves", slot: "A", name: "일회용 장갑", aliases: ["장갑"], quantity: 6, expiry: "2028-02-28", led: "#f04b43", available: true, autoOpenAllowed: true },
  { id: "bandage", slot: "B", name: "압박 붕대", aliases: ["붕대", "탄력 붕대"], quantity: 3, expiry: "2028-04-30", led: "#ff9e36", available: true, autoOpenAllowed: true },
  { id: "splint", slot: "B", name: "접이식 부목", aliases: ["부목"], quantity: 1, expiry: null, led: "#ff9e36", available: true, autoOpenAllowed: true },
  { id: "burn-pad", slot: "C", name: "화상 패드", aliases: ["화상", "화상 거즈"], quantity: 2, expiry: "2027-06-30", led: "#2e91ff", available: true, autoOpenAllowed: true },
  { id: "saline", slot: "C", name: "생리식염수", aliases: ["식염수", "세척"], quantity: 2, expiry: "2027-02-28", led: "#2e91ff", available: true, autoOpenAllowed: true },
  { id: "blanket", slot: "D", name: "응급 보온포", aliases: ["보온포", "담요"], quantity: 2, expiry: null, led: "#25a36f", available: true, autoOpenAllowed: true },
  { id: "cold-pack", slot: "D", name: "냉찜질팩", aliases: ["냉팩", "아이스팩"], quantity: 1, expiry: "2027-08-31", led: "#25a36f", available: true, autoOpenAllowed: true },
]);

const CLASSIFY_RULES = Object.freeze([
  ["bleeding", ["피가", "출혈", "지혈", "피 나"]],
  ["cut", ["베였", "베임", "까졌", "찰과상", "긁혔"]],
  ["burn", ["화상", "데였", "뜨거운", "물집"]],
  ["foreign_object", ["박혔", "찔렸", "유리", "못이", "절단"]],
  ["splint", ["부러", "골절", "접질", "삐었", "부목"]],
  ["hypothermia", ["저체온", "동상", "너무 추", "떨려"]],
  ["heat", ["열사병", "탈수", "더위", "너무 더", "온열"]],
  ["co", ["일산화탄소", "연탄", "화로", "밀폐", "텐트 안"]],
  ["bite", ["벌에", "쏘였", "뱀", "물렸"]],
]);

export function classifyDemo(text) {
  const normalized = String(text).trim().toLowerCase();
  const matched = CLASSIFY_RULES.find(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)));
  const scenarioId = matched?.[0] || "unknown";
  return {
    scenario_id: scenarioId,
    scenario_title: SCENARIOS[scenarioId].title,
    classifier: "demo-rule",
    raw_text: text,
  };
}

export function queryInventoryDemo(text) {
  const normalized = String(text).trim().toLowerCase();
  const item = INVENTORY_ITEMS.find((candidate) =>
    [candidate.name, ...candidate.aliases].some((name) => normalized.includes(name.toLowerCase())),
  );
  return { item: item || null, matched: Boolean(item) };
}

export const SLOT_META = Object.freeze({
  A: { position: "왼쪽 위", color: "#f04b43" },
  B: { position: "오른쪽 위", color: "#ff9e36" },
  C: { position: "왼쪽 아래", color: "#2e91ff" },
  D: { position: "오른쪽 아래", color: "#25a36f" },
});
