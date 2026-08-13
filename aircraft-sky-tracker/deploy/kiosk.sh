#!/usr/bin/env bash
# Chromium full-screen kiosk launcher for the Raspberry Pi display (FRD §89).
#
# Autostart example (~/.config/lxsession/LXDE-pi/autostart or a desktop entry):
#   @/home/pi/aircraft-sky-tracker/deploy/kiosk.sh
#
# Waits for the backend, disables screen blanking, and opens the tracker
# full-screen with browser chrome suppressed.
set -euo pipefail

URL="${TRACKER_URL:-http://localhost:3000}"

# Prevent the display from sleeping (FRD §89).
xset s off || true
xset -dpms || true
xset s noblank || true

# Wait until the backend answers before launching the browser.
until curl -sf "${URL}/api/health" >/dev/null 2>&1; do
  sleep 1
done

# Prefer chromium-browser, fall back to chromium.
CHROMIUM="$(command -v chromium-browser || command -v chromium)"

exec "${CHROMIUM}" \
  --kiosk \
  --incognito \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --app="${URL}"
