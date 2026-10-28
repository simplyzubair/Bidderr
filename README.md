# Bidderr

Select a job post, press one key (or tap one bubble), paste a ready proposal.
It uses Google Gemini through a **free** API key.

Download: **https://bidderr.skillsgeek.com**

## 1. Get your free Google API key (one time)

1. Open https://aistudio.google.com/apikey and sign in with Google.
2. Click **Create API key**, then copy it.
3. Paste it into Bidderr (Windows: Settings window, Android: the key box) and press **Save**.

The free key has a daily limit. If you hit it, Bidderr tells you; wait a bit and try again.

## 2. Windows

- Install `Bidderr-Setup.exe`. If Windows warns you, click **More info → Run anyway** (the app is not code-signed).
- Bidderr lives in the tray, near the clock, and starts with Windows.
- Use it: select the job post with the mouse (`Ctrl+A` selects the whole page), press **`Ctrl+Shift+1`**,
  wait for the "Proposal ready" message, then paste (`Ctrl+V`). No `Ctrl+C` needed.
- New versions download by themselves (checked at start and every hour). Press **Update now** (window, tray menu or the corner box) to install; otherwise it installs when Bidderr quits.

## 3. Android

- Install `Bidderr.apk`. Allow "install unknown apps" when Android asks.
- Turn on the **floating B bubble** (the app shows the steps). Then open a job in Chrome or the Upwork app,
  tap **B**, and you come back to the job with the proposal copied. Tap the proposal box and paste.
- Without the bubble: select the job text, tap **Write proposal** in the text menu (or **Share → Bidderr**).
- When an update is out, the app shows **Update now**.

## Edit the prompt

Both apps have an **Edit prompt (admin)** section. Change the text, press **Save prompt**.
**Reset to default** brings back the built-in prompt (in `shared/proposal.js`).

## For developers

- `shared/proposal.js` is the engine (prompt, Gemini call, formatting). Both apps use it.
- `electron/` is the Windows tray app. `android/` is the Android app: a WebView showing `assets/index.html`,
  plus `BubbleService` (accessibility service that draws the bubble and reads the screen text when tapped).
- `website/` is the download page, served by host nginx on Contabo from `/var/www/bidderr`.
  Deploy changes with `bash scripts/deploy-website.sh`.
- `npm test` runs the tests. `npm start` runs the Windows app (it can use the `BIDDERR_API_KEY` env var).
- Every push to `main` (except `*.md` and `website/`) builds and publishes release `v2.0.<run number>`.
  Installed apps update from it.
- Android signing key: GitHub secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD`,
  backups in `D:\Backups\bidderr-signing` and NAS `~/Backups/bidderr-signing`. Never lose it: phones can't update without it.
