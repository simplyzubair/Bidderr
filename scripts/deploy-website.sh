#!/usr/bin/env bash
# Copies the download page to Contabo (ssh host "co") and reloads nginx.
# The page links to the newest GitHub release, so it only needs deploying when the page itself changes.
set -euo pipefail
cd "$(dirname "$0")/.."

ssh co 'mkdir -p /var/www/bidderr'
for f in website/index.html website/version.js website/logo.svg website/icon.png; do
  ssh co "cat > /var/www/bidderr/$(basename "$f")" < "$f"
done
ssh co 'chmod 644 /var/www/bidderr/* && nginx -t && systemctl reload nginx'
echo "Deployed to https://bidderr.skillsgeek.com"
