// Copies whatever text is selected in the app the user is looking at, so the hotkey works
// without pressing Ctrl+C first. A PowerShell helper stays running in the background
// (compiling its Win32 code once), so each copy only takes a few milliseconds.
const { spawn } = require('child_process');
const { clipboard } = require('electron');

const HELPER = `
Add-Type -Namespace Bidderr -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'
function Key($vk, $up) { [Bidderr.Keys]::keybd_event($vk, 0, $(if ($up) { 2 } else { 0 }), [UIntPtr]::Zero) }
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq 'copy') {
    # Let go of Shift and 1 from the hotkey, otherwise the app sees Ctrl+Shift+C.
    Key 0x10 $true; Key 0xA0 $true; Key 0xA1 $true; Key 0x31 $true
    Key 0x11 $false; Key 0x43 $false; Key 0x43 $true; Key 0x11 $true
    [Console]::Out.WriteLine('done')
  }
}
`;

let helper = null;
let waiting = null;

function startHelper() {
  const encoded = Buffer.from(HELPER, 'utf16le').toString('base64');
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
  });
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', (chunk) => {
    if (chunk.includes('done') && waiting) {
      waiting();
      waiting = null;
    }
  });
  helper.on('exit', () => {
    helper = null;
  });
}

function pressCtrlC() {
  if (!helper) startHelper();
  return new Promise((resolve) => {
    waiting = resolve;
    helper.stdin.write('copy\n');
    setTimeout(resolve, 3000); // never hang if the helper is stuck
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns the selected text. If nothing is selected, returns what was already in the
// clipboard (so "copy first, then press the hotkey" still works).
async function copySelection() {
  const before = clipboard.readText();
  clipboard.clear();
  await pressCtrlC();
  for (let i = 0; i < 20; i++) {
    const text = clipboard.readText();
    if (text.trim()) return text;
    await sleep(50);
  }
  if (process.env.BIDDERR_DEBUG) console.log('[copy] nothing selected, using the old clipboard');
  if (before) clipboard.writeText(before);
  return before;
}

function stopHelper() {
  helper?.kill();
}

module.exports = { copySelection, startHelper, stopHelper };
