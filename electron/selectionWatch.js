// Notices when the user probably selected a block of text, so the "Write proposal" bubble can
// pop up next to the mouse. Windows has no "text selected" event, so we watch the mouse:
//   - a drag across text (long, or over more than one line)
//   - a triple-click (selects a paragraph)
//   - Ctrl+A (selects everything)
// Window moves/resizes, the desktop, File Explorer and Bidderr's own windows are ignored.
const { screen } = require('electron');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('BIDDERR_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ BIDDERR_RECT *rect)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hWnd, _Out_ uint16_t *name, int max)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *pid)');

const VK_LBUTTON = 0x01;
const VK_CONTROL = 0x11;
const VK_A = 0x41;
const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'CabinetWClass', 'Shell_SecondaryTrayWnd']);

const isDown = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

function windowInfo(hwnd = GetForegroundWindow()) {
  if (!hwnd) return null;
  const rect = {};
  GetWindowRect(hwnd, rect);
  const name = new Uint16Array(64);
  const n = GetClassNameW(hwnd, name, 64);
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return {
    key: koffi.address(hwnd).toString(),
    rect: `${rect.left},${rect.top},${rect.right},${rect.bottom}`,
    className: String.fromCharCode(...name.slice(0, Math.max(0, n))),
    pid: pid[0],
  };
}

// Returns a stop() function. onSelection(point, reason) is called with the mouse position.
function startSelectionWatch({ onSelection, isEnabled, log = () => {} }) {
  let down = null; // { at, time, win } while the left button is held
  let clicks = []; // recent short clicks, for triple-click
  let ctrlA = false;
  let failed = false;

  const allowed = (win) => win && win.pid !== process.pid && !IGNORED_CLASSES.has(win.className);

  const tick = () => {
    if (!isEnabled()) {
      down = null;
      return;
    }
    const now = Date.now();
    const button = isDown(VK_LBUTTON);

    if (button && !down) {
      down = { at: screen.getCursorScreenPoint(), time: now, win: windowInfo() };
    } else if (!button && down) {
      const at = screen.getCursorScreenPoint();
      const dx = at.x - down.at.x;
      const dy = at.y - down.at.y;
      const distance = Math.hypot(dx, dy);
      const win = windowInfo();
      // Same window, same place and size: the user selected inside it (did not move it).
      const sameWindow = win && down.win && win.key === down.win.key && win.rect === down.win.rect;

      if (distance < 6) {
        clicks = clicks.filter((c) => now - c.time < 700 && Math.hypot(c.at.x - at.x, c.at.y - at.y) < 12);
        clicks.push({ at, time: now });
        if (clicks.length >= 3 && sameWindow && allowed(win)) {
          clicks = [];
          onSelection(at, 'triple-click');
        }
      } else if ((distance >= 100 || Math.abs(dy) >= 24) && now - down.time > 120 && sameWindow && allowed(win)) {
        clicks = [];
        onSelection(at, 'drag');
      }
      down = null;
    }

    const pressed = isDown(VK_CONTROL) && isDown(VK_A);
    if (pressed && !ctrlA && allowed(windowInfo())) onSelection(screen.getCursorScreenPoint(), 'ctrl+a');
    ctrlA = pressed;
  };

  const timer = setInterval(() => {
    try {
      tick();
    } catch (e) {
      // never let the watcher crash the app, but say what went wrong (once)
      if (!failed) log(`[select] watcher error: ${e.message}`);
      failed = true;
    }
  }, 30);
  return () => clearInterval(timer);
}

module.exports = { startSelectionWatch, windowInfo };
