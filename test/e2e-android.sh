#!/usr/bin/env bash
# End-to-end test of the Android app on an emulator (run inside android-emulator-runner).
# 1) Share a job to Bidderr.  2) Turn on the bubble, open a job page in Chrome, tap the bubble.
# Both must open Bidderr with the job text. With no API key the app must say so clearly.
# Screenshots and UI dumps go to $OUT.
set -uo pipefail
# The emulator action can hang while its shutdown waits for emulator child processes.
# Start a detached fallback that stops those children if the action is still stuck.
cleanup_emulator() {
  (
    sleep 10
    pkill -TERM -x qemu-system-x86_64 2>/dev/null || true
    pkill -TERM -x crashpad_handler 2>/dev/null || true
    sleep 2
    pkill -KILL -x qemu-system-x86_64 2>/dev/null || true
    pkill -KILL -x crashpad_handler 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
}
trap cleanup_emulator EXIT
# Prevent a wedged adb shell/uiautomator call from holding the CI job open.
adb() { command timeout 20s adb "$@"; }
APK="${1:-Bidderr.apk}"
OUT="${OUT:-e2e-android}"
mkdir -p "$OUT"
PKG=com.bidderr.app
fail() {
  echo "FAILED: $*"
  shot failure
  adb logcat -d -v time -s BidderrBubble:I AndroidRuntime:E WindowManager:E AccessibilityManagerService:E ActivityManager:E > "$OUT/logcat.txt" || true
  exit 1
}
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/$1.xml" 2>/dev/null || true; }
tap_text() {
  local needle="$1" xml="$2" coords
  coords=$(python3 - "$xml" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
needle = sys.argv[2].casefold()
for node in root.iter("node"):
    if needle not in node.attrib.get("text", "").casefold():
        continue
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if match:
        left, top, right, bottom = map(int, match.groups())
        print((left + right) // 2, (top + bottom) // 2)
        break
else:
    raise SystemExit(1)
PY
  ) || return 1
  read -r x y <<< "$coords"
  echo "Tapping '$needle' at $x,$y"
  adb shell input tap "$x" "$y"
}
# Wait until the screen shows some text (WebView text shows up in the UI dump).
wait_for_text() {
  for _ in $(seq 1 30); do
    dump "$2"
    if grep -q "$1" "$OUT/$2.xml"; then return 0; fi
    sleep 2
  done
  return 1
}
# The floating writer is a small see-through window that UI dumps don't always include, so it
# reports each step to Android's log (WebView console, tag "chromium"). Wait for a line there.
wait_for_log() {
  for _ in $(seq 1 30); do
    adb logcat -d -s chromium:I > "$OUT/$2.log" 2>/dev/null || true
    if grep -q "$1" "$OUT/$2.log"; then return 0; fi
    sleep 1
  done
  return 1
}

adb install -r "$APK" || fail "install"
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

echo "=== 1. Share a job to Bidderr"
adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT "'SHARED JOB: Hi I am Sarah, I need my blurry logo redrawn as a clean vector for print. Budget 40 dollars.'" \
  -n $PKG/.MainActivity || fail "start with share"
wait_for_text "No API key yet" 1-share || fail "app did not show the no-key message after a share"
grep -q "SHARED JOB" "$OUT/1-share.xml" || fail "the shared job text is not shown in the app"
shot 1-share
echo "PASS share"

echo "=== 1b. Text menu 'Write proposal' opens only the floating writer bubble"
adb shell am force-stop $PKG
adb logcat -c
adb shell am start -a android.intent.action.PROCESS_TEXT -t text/plain \
  --es android.intent.extra.PROCESS_TEXT "'MENU JOB: Hello, I need a flyer for my gym opening next week. Budget 30 dollars.'" \
  -n $PKG/.WriterActivity || fail "start writer"
wait_for_log "bidderr-writer\] read .*MENU JOB" 1b-writer || fail "the floating writer did not get the selected text"
wait_for_log "bidderr-writer\] error: .*No API key yet" 1b-writer || fail "the floating writer did not show the no-key message"
shot 1b-writer
adb shell dumpsys activity activities | grep -m1 -E "mResumedActivity|topResumedActivity" | tee "$OUT/1b-activity.txt"
grep -q "WriterActivity" "$OUT/1b-activity.txt" || fail "the text menu opened something else than the floating writer"
grep -q "MainActivity" "$OUT/1b-activity.txt" && fail "the text menu opened the full app instead of the bubble"
adb shell am force-stop $PKG
echo "PASS text menu writer"

echo "=== 2. Bubble over Chrome"
if ! adb shell pm list packages | grep -q com.android.chrome; then
  echo "Chrome is not on this emulator image; skipping the bubble test"; exit 0
fi
# Serve the job page from the runner; the emulator reaches it as localhost:8765.
mkdir -p "$OUT/site"
echo '<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Logo redraw</h1><p>BUBBLE JOB: Hello, my logo is blurry and I need it redrawn as a vector for print. Budget 40 dollars.</p></body></html>' > "$OUT/site/job.html"
(cd "$OUT/site" && python3 -m http.server 8765 >/dev/null 2>&1 &)
adb reverse tcp:8765 tcp:8765
sleep 1
# Skip Chrome's first-run pages on the fresh emulator to keep this test focused on the bubble.
adb shell "echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
# Clear Chrome's first-run prompt before enabling the accessibility service. UIAutomator's
# temporary automation connection unbinds accessibility services, so don't use it afterward
# until the bubble has been tapped.
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main \
  -d "http://localhost:8765/job.html" || fail "open chrome"
sleep 3
for _ in $(seq 1 15); do
  dump 2-chrome
  if grep -q "BUBBLE JOB" "$OUT/2-chrome.xml"; then break; fi
  if tap_text "No thanks" "$OUT/2-chrome.xml"; then
    sleep 2
    continue
  fi
  if tap_text "Use without an account" "$OUT/2-chrome.xml"; then
    sleep 2
    continue
  fi
  if tap_text "Accept & continue" "$OUT/2-chrome.xml"; then
    sleep 2
    continue
  fi
  break
done
wait_for_text "BUBBLE JOB" 2-chrome || fail "chrome did not show the job page"
shot 2-chrome-ready

adb shell settings put secure enabled_accessibility_services $PKG/$PKG.BubbleService
adb shell settings put secure accessibility_enabled 1
# Starting the app clears Android's stopped-package state and lets the enabled service bind.
adb shell am start -n $PKG/.MainActivity || fail "start app with bubble enabled"
for _ in $(seq 1 10); do
  adb shell dumpsys accessibility > "$OUT/accessibility.txt"
  if grep -qi "BubbleService" "$OUT/accessibility.txt"; then break; fi
  sleep 1
done
grep -qi "BubbleService" "$OUT/accessibility.txt" || fail "accessibility service did not bind"
# Return to the already initialized page without UIAutomator disrupting the service.
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main \
  -d "http://localhost:8765/job.html" || fail "return to Chrome"
sleep 3
adb shell dumpsys activity activities | grep -m1 -E "mResumedActivity|topResumedActivity" | tee "$OUT/2-activity.txt"
grep -q "com.android.chrome" "$OUT/2-activity.txt" || fail "Chrome is not in front before bubble tap"
# Wait until the bubble's overlay window is really visible (View.VISIBLE = 0x0) before tapping.
bubble_visible() {
  adb shell dumpsys window windows > "$OUT/2-windows.txt" 2>/dev/null || true
  # Only the bubble window's own block: from its "Window #" line to the next one.
  awk -v id="u0 $PKG}" '/^ *Window #/ { inside = index($0, id) > 0 } inside' "$OUT/2-windows.txt" \
    | grep -q "mViewVisibility=0x0"
}
for attempt in 1 2 3; do
  for _ in $(seq 1 8); do bubble_visible && break; sleep 1; done
  bubble_visible && break
  echo "bubble not visible yet (attempt $attempt): bring Chrome to the front again"
  adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main \
    -d "http://localhost:8765/job.html" >/dev/null || true
  sleep 3
done
bubble_visible || fail "the B bubble did not show over Chrome"
shot 2-chrome-with-bubble

# The bubble (56dp) sits on the right edge, its top at half the usable height. Tap its middle;
# +16dp stays inside the bubble whatever the size of the navigation bar.
read -r W H < <(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | tr x ' ')
DENSITY=$(adb shell wm density | grep -o '[0-9]*' | tail -1)
DP=$(( DENSITY ))
X=$(( W - (36 * DP / 160) ))
Y=$(( H / 2 + (16 * DP / 160) ))
echo "screen ${W}x${H} density $DENSITY, tapping bubble at $X,$Y"
adb logcat -c
adb shell input tap "$X" "$Y"
wait_for_log "bidderr-writer\] read" 3-after-bubble || fail "tapping the bubble did not start the floating writer"
grep -q "bidderr-writer\] read .*BUBBLE JOB" "$OUT/3-after-bubble.log" || fail "the bubble did not read the job text from Chrome"
wait_for_log "bidderr-writer\] error: .*No API key yet" 3-after-bubble || fail "the writer did not show the no-key message after the bubble tap"
shot 3-after-bubble
adb shell dumpsys activity activities | grep -m1 -E "mResumedActivity|topResumedActivity" | tee "$OUT/3-activity.txt"
grep -q "WriterActivity" "$OUT/3-activity.txt" || fail "the bubble tap did not open the floating writer"
echo "PASS bubble"
echo "ALL ANDROID END-TO-END TESTS PASSED"
touch "$OUT/PASS"
