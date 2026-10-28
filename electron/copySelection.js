// Copies the text selected in the app the user is looking at, so the hotkey works without
// pressing Ctrl+C first. Talks to Windows directly (user32.dll through koffi): no PowerShell,
// and the user's clipboard is never emptied.
const { clipboard } = require('electron');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const GetClipboardSequenceNumber = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)');

const VK = { SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, C: 0x43, ONE: 0x31 };
const KEYUP = 0x0002;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDown = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;
const key = (vk, up) => keybd_event(vk, 0, up ? KEYUP : 0, 0);

// Wait (briefly) for the user to let go of Shift, Alt and 1, otherwise the app we send Ctrl+C to
// would see Ctrl+Shift+C. Keys still held after that are released for them.
async function waitForHotkeyRelease() {
  const keys = [VK.SHIFT, VK.MENU, VK.ONE];
  for (let i = 0; i < 40 && keys.some(isDown); i++) await sleep(15);
  for (const vk of keys) if (isDown(vk)) key(vk, true);
}

// Returns { text, copied }. copied=false means nothing was selected, so the text is whatever
// was already in the clipboard (the "copy first, then press the hotkey" way still works).
async function copySelection() {
  await waitForHotkeyRelease();
  const before = GetClipboardSequenceNumber();
  key(VK.CONTROL, false);
  key(VK.C, false);
  key(VK.C, true);
  key(VK.CONTROL, true);

  for (let i = 0; i < 60; i++) {
    await sleep(25);
    if (GetClipboardSequenceNumber() !== before) {
      // Some apps write the clipboard in several steps; give them a moment to finish.
      for (let j = 0; j < 10; j++) {
        await sleep(30);
        const text = clipboard.readText();
        if (text.trim()) return { text, copied: true };
      }
      break;
    }
  }
  return { text: clipboard.readText(), copied: false };
}

module.exports = { copySelection };
