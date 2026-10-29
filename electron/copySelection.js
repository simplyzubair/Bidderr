// Copies the text selected in the app the user is looking at, so the hotkey works without
// pressing Ctrl+C first. Talks to Windows directly (user32.dll through koffi): no PowerShell,
// and the user's clipboard is never emptied.
const { clipboard } = require('electron');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

// INPUT for a key press, laid out like the 64-bit Windows struct (40 bytes).
const INPUT = koffi.struct('BIDDERR_KEY_INPUT', {
  type: 'uint32',
  pad1: 'uint32',
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
  pad2: 'uint64',
});

const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, BIDDERR_KEY_INPUT *pInputs, int cbSize)');
const MapVirtualKeyW = user32.func('uint32 __stdcall MapVirtualKeyW(uint32 uCode, uint32 uMapType)');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const GetClipboardSequenceNumber = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)');

const VK = { SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, LWIN: 0x5b, C: 0x43, ONE: 0x31 };
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const INPUT_SIZE = koffi.sizeof(INPUT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDown = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

// Sends key events like a real keyboard (virtual key + hardware scan code).
function sendKeys(events) {
  const inputs = events.map(([vk, up]) => ({
    type: 1, // INPUT_KEYBOARD
    pad1: 0,
    wVk: 0,
    wScan: MapVirtualKeyW(vk, 0),
    dwFlags: KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0),
    time: 0,
    dwExtraInfo: 0,
    pad2: 0,
  }));
  return SendInput(inputs.length, inputs, INPUT_SIZE);
}

function foregroundTitle() {
  const buf = new Uint16Array(256);
  const n = GetWindowTextW(GetForegroundWindow(), buf, 256);
  return String.fromCharCode(...buf.slice(0, Math.max(0, n)));
}

// Wait for the user to let go of the hotkey (Ctrl, Shift, Alt, 1), so the app we send Ctrl+C to
// sees a clean Ctrl+C and not Ctrl+Shift+C. Anything still held after ~1s is released for them.
async function waitForHotkeyRelease() {
  const keys = [VK.CONTROL, VK.SHIFT, VK.MENU, VK.LWIN, VK.ONE];
  for (let i = 0; i < 70 && keys.some(isDown); i++) await sleep(15);
  const stuck = keys.filter(isDown);
  if (stuck.length) sendKeys(stuck.map((vk) => [vk, true]));
  await sleep(20);
}

// Returns { text, copied, info }. copied=false means nothing was selected, so the text is
// whatever was already in the clipboard ("copy first, then press the hotkey" still works).
async function copySelection() {
  await waitForHotkeyRelease();
  const window = foregroundTitle();
  const before = GetClipboardSequenceNumber();
  const sent = sendKeys([
    [VK.CONTROL, false],
    [VK.C, false],
    [VK.C, true],
    [VK.CONTROL, true],
  ]);
  const info = `window="${window}" sent=${sent}/4`;

  for (let i = 0; i < 60; i++) {
    if (GetClipboardSequenceNumber() !== before) {
      // Some apps write the clipboard in several steps; give them a moment to finish.
      for (let j = 0; j < 10; j++) {
        const text = clipboard.readText();
        if (text.trim()) return { text, copied: true, info };
        await sleep(15);
      }
      break;
    }
    await sleep(15);
  }
  return { text: clipboard.readText(), copied: false, info };
}

// Pastes the clipboard into whatever box has the keyboard focus (the "Paste" bubble).
async function pasteClipboard() {
  await waitForHotkeyRelease();
  const sent = sendKeys([
    [VK.CONTROL, false],
    [0x56, false], // V
    [0x56, true],
    [VK.CONTROL, true],
  ]);
  return { sent, window: foregroundTitle() };
}

module.exports = { copySelection, pasteClipboard };
