# Bidderr (repo simplyzubair/Bidderr, public; local folder is still D:\Projects\Closer)

- Proposal writer: Windows tray app (Electron; selection bubble + Ctrl+Shift+1) + Android app (WebView; text-menu "Write proposal" opens the floating `WriterActivity`, optional accessibility B bubble pastes). See README.md.
- One engine for both: `shared/proposal.js` (UMD script: `require` in Electron, `<script>` in the WebView). Keep it dependency-free.
- Releases: every push to `main` (not `*.md` / `website/`) publishes `v2.0.<run>`; both apps pick it up from GitHub releases and show an "Update now" button (Windows downloads in the background first). Never hand-tag.
- Android signing key lives only in GitHub secrets + `D:\Backups\bidderr-signing` + NAS `~/Backups/bidderr-signing`. Never commit it.
- Website: `bash scripts/deploy-website.sh` (host nginx on `co`, `/var/www/bidderr`, certbot HTTPS, Cloudflare DNS only).
- Before every push run the local checks: `npm test`, `node --check` on all JS, a dev start, the packaged `--smoke-test`, and the APK build: `$env:JAVA_HOME='D:\Tools\jdk17'; $env:ANDROID_HOME='D:\Tools\android-sdk'; D:\Tools\gradle-8.7\bin\gradle -p android assembleRelease` (needs `android/local.properties` with `sdk.dir=D\:\\Tools\\android-sdk`, gitignored). Desktop/emulator e2e only run in CI: push a branch and `gh workflow run build.yml --ref <branch>`; merge to `main` only when green (failed runs email the user).
- Hotkey, selection bubble and paste can't be tested on mini-pc-6 (no active desktop session); `test/e2e-windows.ps1` covers them on GitHub's Windows runner.
- In this T3 shell `ELECTRON_RUN_AS_NODE=1` is set; unset it before launching Electron.
