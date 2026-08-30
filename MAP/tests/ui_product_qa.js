/* 1024×600 제품 UI의 터치 크기·야간 모드 회귀 검사(부팅 안내 모달은 2026-08-30 제거).
 * 실행 환경에는 Playwright가 필요하며 제품 런타임에는 포함하지 않는다. */

"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:8899/product/";
const outputDir = path.resolve(process.argv[3] || "test-results");

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const launchOptions = { headless: true };
  if (process.env.OGTECH_BROWSER_EXECUTABLE) {
    launchOptions.executablePath = process.env.OGTECH_BROWSER_EXECUTABLE;
  }
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
    // 2026-08-30: 부팅 안내 모달(#bootNotice)은 제거됨 — 로드 직후 잠금 없이 조작 가능해야 한다.
    await page.locator("#btnDestination").waitFor({ state: "visible" });
    const noBoot = await page.evaluate(() => ({
      noticeAbsent: document.querySelector("#bootNotice") === null,
      screenInert: document.querySelector("#screen").inert,
    }));
    await page.screenshot({ path: path.join(outputDir, "product_boot_1024x600.png") });
    requireCondition(noBoot.noticeAbsent, "제거된 부팅 안내 모달(#bootNotice)이 DOM에 남아 있음");
    requireCondition(!noBoot.screenInert, "부팅 모달 없이도 본 화면이 inert 상태임");

    await page.keyboard.press("N");
    await page.waitForFunction(() => document.documentElement.dataset.night === "on", null, { timeout: 3_000 });

    const product = await page.evaluate(() => {
      const targets = [...document.querySelectorAll(".action")].map((item) => {
        const rect = item.getBoundingClientRect();
        return { id: item.id, width: rect.width, height: rect.height };
      });
      return {
        document: {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        },
        screenInert: document.querySelector("#screen").inert,
        night: document.documentElement.dataset.night,
        targets,
      };
    });
    await page.screenshot({ path: path.join(outputDir, "product_night_1024x600.png") });

    requireCondition(!product.screenInert, "제품 화면이 잠금 상태임");
    requireCondition(product.night === "on", "잠금 해제 뒤 N 키 야간 모드가 동작하지 않음");
    requireCondition(product.document.scrollWidth <= 1024 && product.document.scrollHeight <= 600, "제품 화면이 1024×600 문서 영역을 넘침");
    requireCondition(product.targets.length === 4 && product.targets.every((item) => item.height >= 80), "하단 주요 동작 터치 높이가 80px 미만임");
    requireCondition(browserErrors.length === 0, `브라우저 오류 발생: ${browserErrors.join(" | ")}`);

    await page.keyboard.press("N");
    const result = {
      version: 1,
      passed: true,
      viewport: "1024x600",
      boot_notice_removed: noBoot.noticeAbsent,
      product: {
        night_voice_control: product.night === "on",
        touch_targets: product.targets,
        document_size: product.document,
      },
      browser_errors: browserErrors,
    };
    fs.writeFileSync(path.join(outputDir, "product_ui_1024x600.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
