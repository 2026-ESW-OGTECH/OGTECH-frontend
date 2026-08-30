#!/usr/bin/env bash
set -euo pipefail

# 정본 화면은 /video/ 다(2026-08-30 사용자 지시). ?live=1 이면 온·습도·CO를 STM32 실값으로
# 채우고, 값이 3초 넘게 끊기면 꾸며내지 않고 "—"로 떨어뜨린다.
# 촬영용 자동 재생이 필요하면 OGTECH_KIOSK_URL 에 &autoplay=1 (또는 loop)을 덧붙인다.
KIOSK_URL="${OGTECH_KIOSK_URL:-http://127.0.0.1:8790/video/?live=1}"
# Firefox 전용 프로필: 정전 후 세션 복구·안전 모드·첫 실행 안내가 제품 화면을 가리지 않게 한다.
FIREFOX_PROFILE="${OGTECH_FIREFOX_PROFILE:-${XDG_CONFIG_HOME:-$HOME/.config}/ogtech/firefox-kiosk}"

wait_for_map() {
  local i
  for i in $(seq 1 60); do
    if python3 - "${KIOSK_URL}" <<'PY' 2>/dev/null; then return 0; fi
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read(64)
PY
    sleep 1
  done
  echo "경고: ${KIOSK_URL} 응답을 60초 동안 받지 못했습니다. 브라우저는 그대로 띄웁니다." >&2
}

prepare_firefox_profile() {
  mkdir -p "${FIREFOX_PROFILE}"
  cat > "${FIREFOX_PROFILE}/user.js" <<'PREFS'
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.sessionstore.max_resumed_crashes", 0);
user_pref("toolkit.startup.max_resumed_crashes", -1);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("app.update.enabled", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("dom.disable_beforeunload", true);
user_pref("media.autoplay.default", 0);
user_pref("media.autoplay.blocking_policy", 0);
user_pref("full-screen-api.warning.timeout", 0);
PREFS
  rm -f "${FIREFOX_PROFILE}/.parentlock" "${FIREFOX_PROFILE}/lock" 2>/dev/null || true
}

wait_for_map

if command -v firefox >/dev/null 2>&1; then
  prepare_firefox_profile
  exec firefox --kiosk --no-remote --profile "${FIREFOX_PROFILE}" "${KIOSK_URL}"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium-browser"
elif command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
else
  echo "Firefox 또는 Chromium 실행 파일을 찾지 못했습니다." >&2
  exit 1
fi

exec "${CHROMIUM_BIN}" \
  --kiosk \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  "${KIOSK_URL}"
