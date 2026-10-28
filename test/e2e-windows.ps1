# End-to-end test of the Windows hotkey, on a real desktop (GitHub's windows-latest runner).
# It runs Bidderr against a fake Gemini server, selects a job in real apps, presses the real
# Ctrl+Shift+1 keys and checks the proposal lands in the clipboard. Screenshots go to $work.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $env:RUNNER_TEMP 'bidderr-e2e'
if (-not $env:RUNNER_TEMP) { $work = Join-Path $env:TEMP 'bidderr-e2e' }
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory $work | Out-Null
$appLog = Join-Path $work 'app.log'
$mockLog = Join-Path $work 'mock.log'
New-Item -ItemType File $appLog, $mockLog | Out-Null

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace E2E -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT rect);
[DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
public static bool ClickTextArea(IntPtr h) {
  RECT r;
  if (!GetWindowRect(h, out r)) return false;
  int x = r.Left + Math.Min(200, Math.Max(40, (r.Right - r.Left) / 3));
  int y = r.Top + Math.Min(190, Math.Max(100, (r.Bottom - r.Top) / 3));
  if (!SetCursorPos(x, y)) return false;
  mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
  mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  return true;
}
'@

function Key([byte]$vk, [bool]$up) { [E2E.Win]::keybd_event($vk, 0, $(if ($up) { 2 } else { 0 }), [UIntPtr]::Zero) }

# Like a person: hold Ctrl and Shift, tap 1, let go.
function Press-Hotkey {
  Key 0x11 $false; Start-Sleep -Milliseconds 40
  Key 0x10 $false; Start-Sleep -Milliseconds 40
  Key 0x31 $false; Start-Sleep -Milliseconds 120
  Key 0x31 $true;  Start-Sleep -Milliseconds 60
  Key 0x10 $true;  Key 0x11 $true
}

function Press-Keys([byte[]]$mods, [byte]$vk) {
  $prefix = ''
  if ($mods -contains 0x11) { $prefix += '^' }
  if ($mods -contains 0x10) { $prefix += '+' }
  if ($mods -contains 0x12) { $prefix += '%' }
  $key = switch ($vk) {
    0x23 { '{END}' }
    0x41 { 'a' }
    0x43 { 'c' }
    default { throw "Unsupported test key: $vk" }
  }
  [System.Windows.Forms.SendKeys]::SendWait("$prefix$key")
  Start-Sleep -Milliseconds 150
}

# Verify the test app actually received the selection shortcut, then restore the test clipboard
# and select again so Bidderr itself has to perform the copy.
function Assert-Selection([string]$expected) {
  $saved = Get-Clipboard -Raw
  Press-Keys @(0x11) 0x43 # Ctrl+C probe
  Start-Sleep -Milliseconds 200
  $selected = Get-Clipboard -Raw
  if (-not $selected.Contains($expected)) { throw "Could not select text containing '$expected': $selected" }
  Set-Clipboard -Value $saved
  Press-Keys @(0x11) 0x41 # Restore the selection for the hotkey test
  Start-Sleep -Milliseconds 200
}

function Focus-Process($proc) {
  for ($i = 0; $i -lt 60 -and $proc.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 250; $proc.Refresh() }
  $h = $proc.MainWindowHandle
  if ($h -eq 0) { throw "No window for $($proc.ProcessName)" }
  for ($i = 0; $i -lt 10; $i++) {
    Key 0x12 $false; Key 0x12 $true   # Alt tap lets this script move the focus
    [E2E.Win]::ShowWindow($h, 9) | Out-Null
    [E2E.Win]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Milliseconds 300
    if ([E2E.Win]::GetForegroundWindow() -eq $h) {
      if (-not [E2E.Win]::ClickTextArea($h)) { throw "Could not click inside $($proc.ProcessName)" }
      Start-Sleep -Milliseconds 200
      return
    }
  }
  throw "Could not focus $($proc.ProcessName)"
}

function Wait-Log([string]$pattern, [int]$seconds, [int]$after = 0) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $lines = @(Get-Content $appLog)
    $hit = $lines | Select-Object -Skip $after | Select-String -Pattern $pattern | Select-Object -First 1
    if ($hit) { return $hit.Line }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for log: $pattern"
}

function Shot([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $work "$name.png"))
  $g.Dispose(); $bmp.Dispose()
}

$BOLD_D = [char]::ConvertFromUtf32(0x1D403)   # the Unicode bold "D" of "Delivery Time"

# Runs one case: $prepare sets up the screen, then the real hotkey is pressed.
function Run-Case([string]$name, [scriptblock]$prepare, [string]$expectJob, [string]$expectCopied) {
  Write-Host "=== $name"
  Set-Clipboard -Value 'OLD CLIPBOARD TEXT'
  & $prepare
  $logLines = @(Get-Content $appLog).Count
  $mockLines = @(Get-Content $mockLog).Count
  Press-Hotkey
  Wait-Log "\[copy\] selection copied=$expectCopied" 15 $logLines | Write-Host
  Wait-Log '\[hud\] ok: Proposal copied' 20 $logLines | Write-Host
  Start-Sleep -Milliseconds 300
  Shot $name
  $clipboardDeadline = (Get-Date).AddSeconds(3)
  do {
    $clip = Get-Clipboard -Raw
    if ($clip.Contains($BOLD_D) -and $clip.Contains('Best,')) { break }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $clipboardDeadline)
  if (-not $clip.Contains($BOLD_D) -or -not $clip.Contains('Best,')) { throw "$name - clipboard does not hold the proposal: $clip" }
  $sent = @(Get-Content $mockLog | Select-Object -Skip $mockLines)
  if ($sent.Count -lt 1) { throw "$name - Bidderr never called the API" }
  $job = ($sent[-1] | ConvertFrom-Json).job
  if (-not $job.Contains($expectJob)) { throw "$name - API got the wrong job text: $job" }
  Write-Host "PASS $name"
}

$procs = @()
try {
  # Fake Gemini
  $env:MOCK_LOG = $mockLog
  $procs += Start-Process node -ArgumentList "`"$root\test\mockGemini.js`"" -PassThru -WindowStyle Hidden

  # Bidderr (developer run, pointed at the fake Gemini)
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $env:BIDDERR_API_BASE = 'http://127.0.0.1:8787'
  $env:BIDDERR_API_KEY = 'test-key'
  $env:BIDDERR_LOG = $appLog
  $procs += Start-Process "$root\node_modules\electron\dist\electron.exe" -ArgumentList "`"$root`"" -PassThru
  Wait-Log 'hotkey registered=True|hotkey registered=true' 40 | Write-Host
  Start-Sleep 2
  Shot '0-started'

  # 1. Notepad: select all, press the hotkey. No Ctrl+C.
  $jobFile = Join-Path $work 'job.txt'
  Set-Content $jobFile "NOTEPAD JOB: Hi, I am Sarah. I need my blurry logo redrawn as a clean vector file for print. Budget 40 dollars."
  $notepad = Start-Process notepad.exe $jobFile -PassThru
  $procs += $notepad
  Run-Case '1-notepad-selection' { Focus-Process $notepad; Press-Keys @(0x11) 0x41 <# Ctrl+A #>; Assert-Selection 'NOTEPAD JOB' } 'NOTEPAD JOB' 'true'

  # 2. Nothing selected, job copied before: uses the clipboard.
  Run-Case '2-copied-first' {
    Focus-Process $notepad; Press-Keys @(0x11) 0x23 <# Ctrl+End clears the selection #>
    Start-Sleep -Milliseconds 200
    Set-Clipboard -Value 'COPIED JOB: I need a business card designed in two days, simple and modern, budget 25 dollars.'
  } 'COPIED JOB' 'false'

  # 3. A job page in Chrome: select all, press the hotkey.
  $page = Join-Path $work 'job.html'
  Set-Content $page '<html><body><h1>Logo redraw</h1><p>CHROME JOB: Hello, I am Sarah. My logo is blurry and I need it redrawn as a vector for print. Budget $40.</p></body></html>'
  $chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
  $chromeProc = Start-Process $chrome -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$work\chrome", '--new-window', "file:///$($page -replace '\\','/')" -PassThru
  $procs += $chromeProc
  Start-Sleep 5
  $chromeWin = Get-Process chrome | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  Run-Case '3-chrome-selection' { Focus-Process $chromeWin; Start-Sleep 1; Press-Keys @(0x11) 0x41; Assert-Selection 'CHROME JOB' } 'CHROME JOB' 'true'

  Write-Host 'ALL END-TO-END TESTS PASSED'
} catch {
  Shot 'failure'
  Write-Host "FAILED: $_"
  Write-Host '--- app log'; Get-Content $appLog
  Write-Host '--- mock log'; Get-Content $mockLog
  exit 1
} finally {
  foreach ($p in $procs) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
  Get-Process chrome, electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
