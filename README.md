# Bidderr

Select a job post, press one key (or tap one bubble), paste a ready proposal.
It uses Google Gemini through a **free** API key.

Download: **https://bidderr.skillsgeek.com**

## 1. Get your free Google API key (once per device)

1. Open https://aistudio.google.com/apikey and sign in with Google.
2. Click **Create API key**, then copy it.
3. Paste it into Bidderr (Windows: Settings window, Android: the key box) and press **Save**.

The key is saved on this device only (encrypted), so set it up separately on each computer or phone. The free key has a daily limit. If you hit it, Bidderr tells you; wait a bit and try again.

**Optional backup:** add a free OpenRouter key (https://openrouter.ai/keys) under **Backup AI**. When Google is busy or out of free quota, Bidderr uses one of OpenRouter's free models instead.

## 2. Windows

- Install `Bidderr-Setup.exe`. If Windows warns you, click **More info → Run anyway** (the app is not code-signed).
- Bidderr lives in the tray, near the clock, and starts with Windows.
- Use it: select the job post (drag over it, triple-click it, or `Ctrl+A`). The round **Bidderr bubble**
  pops up next to the mouse: click it (or press **`Ctrl+Shift+1`**). Wait for the green paste badge,
  then click the proposal box and the bubble. Bidderr copies the ready proposal again just before pasting.
  The selection bubble can be turned off in the window or the tray menu, or set to show only in web browsers.
- The shortcut can be changed under **Shortcut** in the window.
- **Recent proposals** keeps your last 30 proposals on the PC, each with a Copy button.
- New versions download by themselves (checked at start and every hour). Press **Update now** (window, tray menu or the corner box) to install; otherwise it installs when Bidderr quits.

## 3. Android

- Install `Bidderr.apk`. Allow "install unknown apps" when Android asks.
- Select the job text in Chrome or the Upwork app and tap **✍ Write proposal** in the text menu.
  Only a small bubble shows at the bottom (the app does not open): sound 1 = writing, sound 2 = proposal ready.
  Wait for the ready message, return to the job, then paste.
- Optional **B bubble** (Accessibility; the app shows the steps): tap B on a job page to write without
  selecting. When ready it turns into a green **Paste** button that pastes into the box you tapped.
- Quick on/off for the B bubble: add the **Bidderr bubble** tile to Quick Settings.
- **Recent proposals** keeps your last 30 proposals on the phone.
- When an update is out, the app shows **Update now**.

## Profiles and prompts

Pick your work under **Your work**: **Vector Tracing**, **Embroidery Digitizing** or **General Design**.
Each profile has its own prompt (offer list, file formats, delivery time). If the job post asks
screening questions, the proposal ends with short answers ("(fill in)" where only you know).

To change a profile's prompt: pick it, open **Advanced: writing instructions**, edit, press **Save prompt**.
**Reset to default** brings back that profile's built-in prompt (in `shared/proposal.js`).

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
