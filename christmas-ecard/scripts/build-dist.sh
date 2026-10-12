#!/bin/sh
# Builds dist/: upload app/ ABOVE the web root and public_html/ as the web root (cPanel layout).
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/app/data dist/public_html
cp -r src dist/app/src
cp .env.example dist/app/.env.example
# version shown in the site footer: date, short commit, and -modified if src or public had uncommitted changes
V=$(date +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
[ -n "$(git status --porcelain src public 2>/dev/null)" ] && V="$V-modified"
printf '%s' "$V" > dist/app/VERSION
echo "Built version $V"
cp -r public/assets dist/public_html/assets
sed 's#/\.\./src/#/../app/src/#' public/index.php > dist/public_html/index.php
printf 'Require all denied\n' > dist/app/data/.htaccess
printf 'Require all denied\n' > dist/app/src/.htaccess
printf 'RewriteEngine On\nRewriteCond %%{REQUEST_FILENAME} !-f\nRewriteRule ^ index.php [L]\nHeader always set Strict-Transport-Security "max-age=31536000"\n' > dist/public_html/.htaccess
cat > dist/DEPLOY.md <<'EOF'
# Deploy (cPanel)
1. Upload `app/` to your home directory, next to (not inside) public_html. Upload `public_html/` contents to the subdomain's document root.
2. In `app/`, copy `.env.example` to `.env` and fill it in (APP_URL, Postmark, Stripe). Make `app/data/` writable (755 or 775).
3. Cron every 5 min: `php /home/USER/app/src/cli.php queue`. Daily: `php /home/USER/app/src/cli.php purge`.
4. First administrator: put `ADMIN_EMAIL=you@example.com` in `.env`, then register on the site with that address and confirm it from the email. You become the first restricted administrator (it only works while there is none), and visiting /admin asks you to set up two step sign in. No default password exists. With a terminal you can instead run `php /home/USER/app/src/cli.php admin you@example.com` after registering.
5. Email: either set POSTMARK_TOKEN (best: gives bounce and delivery feedback), or for a first set up send through the Group mail account with SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (tls), SMTP_USER, SMTP_PASS and MAIL_FROM in `.env`. SMTP has no bounce feedback. Use Admin > Email and help > send a test to check it.
6. Add the Stripe and Postmark webhooks (see project README).
Requires PHP 8.2+ with pdo_sqlite and curl.
EOF
(cd dist && powershell -NoProfile -Command "Compress-Archive -Path app,public_html,DEPLOY.md -DestinationPath ../christmas-ecard-deploy.zip -Force")
mv christmas-ecard-deploy.zip dist/
