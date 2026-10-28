# Bidderr

Copy a job posting, press one key, paste a ready proposal.
It uses Google Gemini through a **free** API key.

## 1. Get your free Google API key (one time)

1. Open https://aistudio.google.com/apikey and sign in with Google.
2. Click **Create API key**, then copy it.
3. Paste it into Bidderr (Windows: Settings window, Android: the key box) and press **Save**.

The free key has a daily limit. If you hit it, Bidderr tells you; wait a bit and try again.

## 2. Windows

- Install: run `Bidderr-Setup.exe` (from the `latest` release on GitHub).
  Windows may say "Windows protected your PC". Click **More info → Run anyway** (the app is not code-signed).
- Bidderr lives in the tray, near the clock.
- Use it: copy a job posting (`Ctrl+C`), press **`Ctrl+Shift+1`**, wait a few seconds, then paste (`Ctrl+V`).
- Right-click the tray icon for Settings, "Start with Windows" and Quit.

## 3. Android

- Install: download `Bidderr.apk` from the `latest` release on your phone and open it.
  Allow "install unknown apps" for your browser when Android asks.
- Use it either way:
  - Open Bidderr and tap **Paste job & write proposal**, or
  - Select the job text in Chrome or the Upwork app, then tap **Write proposal** in the text menu (or **Share → Bidderr**).
- The proposal is copied automatically. Paste it into the proposal box.

## Edit the prompt

Both apps have an **Edit prompt (admin)** section. Change the text, press **Save prompt**.
**Reset to default** brings back the built-in prompt (in `shared/proposal.js`).

## For developers

- `shared/proposal.js` is the engine (prompt, Gemini call, formatting). It is used by both apps.
- `electron/` is the Windows tray app. `android/` is the Android app (a WebView showing `assets/index.html`).
- `npm test` runs the tests. `npm start` runs the Windows app. `npm run build:exe` builds the installer.
- On every push to `main`, GitHub Actions builds the APK and the installer and puts them on the `latest` release.
- Models are tried in order (see `MODELS` in `shared/proposal.js`). If one is missing or out of free quota, the next one is used.
