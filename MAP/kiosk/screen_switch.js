/* 화면 선택으로 돌아가는 숨은 복귀 영역.
 *
 * 키오스크는 Firefox --kiosk 라 주소창도 탭도 없다. 촬영 화면에 눈에 보이는
 * 전환 버튼을 두면 그대로 영상에 찍히므로, 왼쪽 위 모서리에 투명한 영역을
 * 두고 두 번 눌렀을 때만 이동한다. 한 번만 누르면 안내만 잠깐 뜨고 사라진다.
 *
 * 상단 계기 스트립 위에 얹으므로 지도 캔버스의 목적지 지정 클릭과 겹치지 않는다.
 */

"use strict";

(function installScreenSwitch() {
  const TARGET = "/select/";
  const SIZE_PX = 96;          // 12mm 터치 규격보다 크게
  const SECOND_TAP_MS = 1200;  // 이 안에 한 번 더 눌러야 이동
  const HINT_MS = 1400;

  const zone = document.createElement("button");
  zone.type = "button";
  zone.id = "screenSwitchZone";
  zone.setAttribute("aria-label", "화면 선택으로 돌아가기 (두 번 누르기)");
  Object.assign(zone.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: `${SIZE_PX}px`,
    height: `${SIZE_PX}px`,
    padding: "0",
    margin: "0",
    border: "0",
    background: "transparent",
    cursor: "pointer",
    zIndex: "9000",
    // 촬영에 잡히지 않도록 어떤 그림도 그리지 않는다.
    appearance: "none",
    outline: "none",
  });

  const hint = document.createElement("div");
  hint.id = "screenSwitchHint";
  hint.textContent = "한 번 더 누르면 화면 선택";
  Object.assign(hint.style, {
    position: "fixed",
    top: "12px",
    left: `${SIZE_PX + 12}px`,
    padding: "10px 14px",
    border: "1px solid #f5b942",
    background: "#101616",
    color: "#f5b942",
    font: "700 20px/1 system-ui, sans-serif",
    zIndex: "9001",
    pointerEvents: "none",
  });
  hint.hidden = true;

  let armedUntil = 0;
  let hintTimer = 0;

  zone.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now <= armedUntil) {
      window.location.href = TARGET;
      return;
    }
    armedUntil = now + SECOND_TAP_MS;
    hint.hidden = false;
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hint.hidden = true;
    }, HINT_MS);
  });

  const attach = () => {
    document.body.append(zone, hint);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
})();
