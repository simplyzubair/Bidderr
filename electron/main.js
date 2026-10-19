const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen, Tray, Menu } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

let mainWindow = null;
let tray = null;
let alwaysOnTopState = true;
let lastExternalHwnd = null;

let currentShortcuts = {
  feedContext: 'Alt+Shift+C',
  autoBid: 'Alt+Shift+B',
  autoReply: 'Alt+Shift+R',
  toggleWindow: 'Alt+Shift+V',
};

const isDev = process.env.NODE_ENV === 'development';

// Runs a PowerShell script as a direct argv entry
function runPowerShell(script, callback) {
  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
    (err, stdout, stderr) => {
      if (callback) callback(err, (stdout || '').trim(), (stderr || '').trim());
    }
  );
}

const GET_FOREGROUND_WINDOW_SCRIPT = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -Name Win32GFW -Namespace CloserAI; [CloserAI.Win32GFW]::GetForegroundWindow().ToInt64()`;

function trackExternalForegroundWindow() {
  runPowerShell(GET_FOREGROUND_WINDOW_SCRIPT, (err, stdout) => {
    if (!err && stdout && stdout !== '0') {
      lastExternalHwnd = stdout;
    }
  });
}

function restoreExternalFocus(callback) {
  if (!lastExternalHwnd) {
    callback();
    return;
  }
  const script = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);' -Name Win32SFW -Namespace CloserAI; [CloserAI.Win32SFW]::SetForegroundWindow([IntPtr]${lastExternalHwnd})`;
  runPowerShell(script, () => callback());
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight, y: workY } = primaryDisplay.workArea;

  const windowWidth = 400;
  const windowHeight = Math.min(820, screenHeight - 60);
  const posX = screenWidth - windowWidth - 15;
  const posY = workY + Math.floor((screenHeight - windowHeight) / 2);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: posX,
    y: posY,
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    show: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  mainWindow.on('blur', trackExternalForegroundWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupTray();
  registerAllShortcuts(currentShortcuts);
}

function setupTray() {
  if (tray) return;

  try {
    const iconPath = path.join(__dirname, '../public/icon.png');
    tray = new Tray(iconPath);
  } catch (e) {
    console.log('Tray icon not found, running without system tray');
    return;
  }

  if (tray) {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Closer AI Widget', enabled: false },
      { type: 'separator' },
      {
        label: 'Show / Hide',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isVisible()) mainWindow.hide();
            else {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
      },
      {
        label: 'Toggle Always On Top',
        type: 'checkbox',
        checked: alwaysOnTopState,
        click: (menuItem) => {
          alwaysOnTopState = menuItem.checked;
          if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTopState);
        },
      },
      { type: 'separator' },
      { label: 'Quit Closer AI', click: () => app.quit() },
    ]);

    tray.setToolTip('Closer AI - Instant Sales & Reply Assistant');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) mainWindow.hide();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  }
}

function sendCopyKeystroke(callback) {
  runPowerShell(`$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^{c}')`, callback);
}

function sendPasteKeystroke(callback) {
  runPowerShell(`$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^{v}')`, callback);
}

function captureSelectedText(callback) {
  const wasFocused = mainWindow && mainWindow.isFocused();
  const oldClipboardText = clipboard.readText();
  clipboard.clear();

  const doCapture = () => {
    sendCopyKeystroke(() => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const newText = clipboard.readText();
        if (newText && newText.trim()) {
          clearInterval(interval);
          if (wasFocused && mainWindow) mainWindow.focus();
          callback(newText.trim());
        } else if (attempts >= 8) {
          clearInterval(interval);
          if (oldClipboardText) {
            clipboard.writeText(oldClipboardText);
          }
          if (wasFocused && mainWindow) mainWindow.focus();
          callback(oldClipboardText || '');
        }
      }, 50);
    });
  };

  if (wasFocused) {
    restoreExternalFocus(() => setTimeout(doCapture, 80));
  } else {
    setTimeout(doCapture, 10);
  }
}

function pasteSelectedText() {
  const wasFocused = mainWindow && mainWindow.isFocused();

  const doPaste = () => {
    sendPasteKeystroke(() => {
      if (wasFocused && mainWindow) {
        setTimeout(() => mainWindow.focus(), 250);
      }
    });
  };

  if (wasFocused) {
    restoreExternalFocus(() => setTimeout(doPaste, 80));
  } else {
    doPaste();
  }
}

function registerAllShortcuts(shortcutsObj) {
  globalShortcut.unregisterAll();
  if (shortcutsObj) {
    currentShortcuts = { ...currentShortcuts, ...shortcutsObj };
  }

  // 1. Feed Context (Alt+Shift+C)
  if (currentShortcuts.feedContext) {
    try {
      globalShortcut.register(currentShortcuts.feedContext, () => {
        captureSelectedText((capturedText) => {
          if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('hotkey-action', { action: 'FEED_CONTEXT', text: capturedText });
          }
        });
      });
      console.log(`Registered feedContext: ${currentShortcuts.feedContext}`);
    } catch (e) {
      console.error('Error registering feedContext shortcut:', e);
    }
  }

  // 2. Auto Bid (Alt+Shift+B)
  if (currentShortcuts.autoBid) {
    try {
      globalShortcut.register(currentShortcuts.autoBid, () => {
        captureSelectedText((capturedText) => {
          if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('hotkey-action', { action: 'AUTO_BID', text: capturedText });
          }
        });
      });
      console.log(`Registered autoBid: ${currentShortcuts.autoBid}`);
    } catch (e) {
      console.error('Error registering autoBid shortcut:', e);
    }
  }

  // 3. Auto Reply (Alt+Shift+R)
  if (currentShortcuts.autoReply) {
    try {
      globalShortcut.register(currentShortcuts.autoReply, () => {
        captureSelectedText((capturedText) => {
          if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('hotkey-action', { action: 'AUTO_REPLY', text: capturedText });
          }
        });
      });
      console.log(`Registered autoReply: ${currentShortcuts.autoReply}`);
    } catch (e) {
      console.error('Error registering autoReply shortcut:', e);
    }
  }

  // 4. Toggle Window Visibility (Alt+Shift+V)
  if (currentShortcuts.toggleWindow) {
    try {
      globalShortcut.register(currentShortcuts.toggleWindow, () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      });
      console.log(`Registered toggleWindow: ${currentShortcuts.toggleWindow}`);
    } catch (e) {
      console.error('Error registering toggleWindow shortcut:', e);
    }
  }
}

// IPC Handlers
ipcMain.handle('read-clipboard', () => {
  return clipboard.readText();
});

ipcMain.handle('write-clipboard', (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('trigger-copy-selection', () => {
  return new Promise((resolve) => {
    captureSelectedText((text) => {
      resolve(text);
    });
  });
});

ipcMain.handle('trigger-paste-selection', () => {
  pasteSelectedText();
  return true;
});

ipcMain.handle('toggle-always-on-top', (event, flag) => {
  alwaysOnTopState = typeof flag === 'boolean' ? flag : !alwaysOnTopState;
  if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTopState);
  return alwaysOnTopState;
});

ipcMain.handle('update-shortcuts', (event, shortcutsObj) => {
  registerAllShortcuts(shortcutsObj);
  return currentShortcuts;
});

ipcMain.handle('update-hotkey', (event, shortcutKey) => {
  registerAllShortcuts({ autoBid: shortcutKey });
  return currentShortcuts;
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('hide-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('close-app', () => {
  app.quit();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
