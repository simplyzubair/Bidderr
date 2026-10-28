#!/usr/bin/env bash
# End-to-end test of the Android app on an emulator (run inside android-emulator-runner).
# 1) Share a job to Bidderr.  2) Turn on the bubble, open a job page in Chrome, tap the bubble.
# Both must open Bidderr with the job text. With no API key the app must say so clearly.
# Screenshots and UI dumps go to $OUT.
set -uo pipefail
APK="${1:-Bidderr.apk}"
OUT="${OUT:-e2e-android}"
mkdir -p "$OUT"
PKG=com.bidderr.app
fail() { echo "FAILED: $*"; shot failure; exit 1; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/$1.xml" 2>/dev/null || true; }
# Wait until the screen shows some text (WebView text shows up in the UI dump).
wait_for_text() {
  for _ in $(seq 1 30); do
    dump "$2"
    if grep -q "$1" "$OUT/$2.xml"; then return 0; fi
    sleep 2
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

echo "=== 2. Bubble over Chrome"
if ! adb shell pm list packages | grep -q com.android.chrome; then
  echo "Chrome is not on this emulator image; skipping the bubble test"; exit 0
fi
adb shell settings put secure enabled_accessibility_services $PKG/$PKG.BubbleService
adb shell settings put secure accessibility_enabled 1
# Skip Chrome's first-run screens.
adb shell 'echo "chrome --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
adb shell am set-debug-app --persistent com.android.chrome
adb shell am force-stop $PKG
# Serve the job page from the runner; the emulator reaches it as localhost:8765.
mkdir -p "$OUT/site"
echo '<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Logo redraw</h1><p>BUBBLE JOB: Hello, my logo is blurry and I need it redrawn as a vector for print. Budget 40 dollars.</p></body></html>' > "$OUT/site/job.html"
(cd "$OUT/site" && python3 -m http.server 8765 >/dev/null 2>&1 &)
adb reverse tcp:8765 tcp:8765
sleep 1
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main \
  -d "http://localhost:8765/job.html" || fail "open chrome"
wait_for_text "BUBBLE JOB" 2-chrome || fail "chrome did not show the job page"
sleep 2
shot 2-chrome-with-bubble

# The bubble (56dp) sits on the right edge, its top at half the usable height. Tap its middle;
# +16dp stays inside the bubble whatever the size of the navigation bar.
read -r W H < <(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | tr x ' ')
DENSITY=$(adb shell wm density | grep -o '[0-9]*' | tail -1)
DP=$(( DENSITY ))
X=$(( W - (36 * DP / 160) ))
Y=$(( H / 2 + (16 * DP / 160) ))
echo "screen ${W}x${H} density $DENSITY, tapping bubble at $X,$Y"
adb shell input tap "$X" "$Y"
wait_for_text "No API key yet" 3-after-bubble || fail "tapping the bubble did not open Bidderr"
adb shell dumpsys activity activities | grep -m1 -E "mResumedActivity|topResumedActivity" | tee "$OUT/3-activity.txt"
grep -q "$PKG" "$OUT/3-activity.txt" || fail "Bidderr is not in front after the bubble tap"
grep -q "BUBBLE JOB" "$OUT/3-after-bubble.xml" || fail "the bubble did not read the job text from Chrome"
shot 3-after-bubble
echo "PASS bubble"
echo "ALL ANDROID END-TO-END TESTS PASSED"
