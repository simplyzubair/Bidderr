#!/usr/bin/env bash
# End-to-end test of the Android app on an emulator (run inside android-emulator-runner).
# 1) Share a job to Bidderr.  1b) Text menu "Write proposal".  2) The tile / app-icon shortcut.
# Each must reach Bidderr with the job. With no API key the app must say so clearly.
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

echo "=== 2. Tile / app-icon shortcut opens the floating writer with the copied job"
adb logcat -c
# The same intent the Quick Settings tile and the long-press shortcut send. The clipboard may be
# empty here; what matters is that the writer opens, reads it, and answers (no key yet).
adb shell am start -a com.bidderr.app.WRITE_COPIED -n $PKG/.WriterActivity || fail "start writer from shortcut"
wait_for_log "bidderr-writer\] read" 2-shortcut || fail "the shortcut did not start the floating writer"
wait_for_log "bidderr-writer\] error: .*No API key yet" 2-shortcut || fail "the writer did not answer after the shortcut"
shot 2-shortcut
adb shell dumpsys activity activities | grep -m1 -E "mResumedActivity|topResumedActivity" | tee "$OUT/2-activity.txt"
grep -q "WriterActivity" "$OUT/2-activity.txt" || fail "the shortcut did not open the floating writer"
echo "PASS shortcut"
echo "ALL ANDROID END-TO-END TESTS PASSED"
touch "$OUT/PASS"
