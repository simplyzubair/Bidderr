# Bidderr (repo simplyzubair/Bidderr, public; local folder is still D:\Projects\Closer)

- Proposal writer: Windows tray app (Electron, Ctrl+Shift+1) + Android app (WebView + floating bubble). See README.md.
- One engine for both: `shared/proposal.js` (UMD script: `require` in Electron, `<script>` in the WebView). Keep it dependency-free.
- Releases: every push to `main` (not `*.md` / `website/`) publishes `v2.0.<run>`; both apps pick it up from GitHub releases and show an "Update now" button (Windows downloads in the background first). Never hand-tag.
- Android signing key lives only in GitHub secrets + `D:\Backups\bidderr-signing` + NAS `~/Backups/bidderr-signing`. Never commit it.
- Website: `bash scripts/deploy-website.sh` (host nginx on `co`, `/var/www/bidderr`, certbot HTTPS, Cloudflare DNS only).
- No Java/Android SDK on mini-pc-6: the APK only builds in GitHub Actions.
- The Ctrl+Shift+1 auto-copy can't be tested on mini-pc-6 (no active desktop session); test on a real PC.
- In this T3 shell `ELECTRON_RUN_AS_NODE=1` is set; unset it before launching Electron.
