export const title = "홈";

/*
 * Home is a dispatch panel, not a menu.
 *
 * 01 is a different class of event from 02-04: it is time-critical, it must
 * never wait on the LLM, and picking it by mistake is far less costly than
 * missing it. So it gets the full width, the only red on the screen, and a
 * hazard-striped grip rail — the same visual grammar as a physical master
 * warning. 02-04 are equal-weight tiles below it.
 */
export function mount(root, context) {
  const isDemo = context.getMode() === "demo";
  const modeLabel = isDemo
    ? "DEMO — 모의 데이터 / 실제 하드웨어 아님"
    : "LIVE — 로컬 API 응답만 표시";

  root.innerHTML = `
    <section class="screen home-screen">
      <header class="home-intro">
        <div>
          <p class="eyebrow">OFFLINE FIELD ASSIST</p>
          <h1>무엇을 도와드릴까요?</h1>
        </div>
        <p>${modeLabel}</p>
      </header>

      <button class="home-action danger-action" type="button" data-route="triage">
        <span class="action-number" aria-hidden="true">01</span>
        <span>
          <h2>즉시 위험 도움</h2>
          <p>의식 없음 · 정상 호흡 아님 · 멈추지 않는 대량 출혈 · CPR</p>
        </span>
        <span class="action-arrow" aria-hidden="true">START ›</span>
      </button>

      <div class="home-grid" aria-label="주요 기능">
        <button class="home-action" type="button" data-route="medical">
          <span class="action-number">02 / MEDICAL</span>
          <h2>부상·증상 도움</h2>
          <p>말하거나 직접 선택해 검수된 고정 카드를 엽니다.</p>
          <span class="action-arrow" aria-hidden="true">열기 ›</span>
        </button>

        <button class="home-action" type="button" data-route="inventory">
          <span class="action-number">03 / SUPPLY</span>
          <h2>의료 물품 찾기</h2>
          <p>실제 칸과 같은 A~D 배치와 LED 명령 상태를 봅니다.</p>
          <span class="action-arrow" aria-hidden="true">열기 ›</span>
        </button>

        <button class="home-action" type="button" data-route="rescue">
          <span class="action-number">04 / RESCUE</span>
          <h2>구조 문자</h2>
          <p>위치 · 인원 · 상태를 확인한 뒤 고정 양식으로 전송합니다.</p>
          <span class="action-arrow" aria-hidden="true">열기 ›</span>
        </button>
      </div>
    </section>`;

  root.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => context.navigate(button.dataset.route));
  });
}
