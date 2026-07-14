# Deploying 7thPortal to digital.7thswindon.org.uk

A literal checklist. For *why* things are laid out this way, see `README.md`.

## Before you start

- [ ] You have cPanel (or equivalent) access to the hosting behind `7thswindon.org.uk`.
- [ ] You've registered an OSM app at OSM → My Account → My Apps, with redirect URI `https://digital.7thswindon.org.uk/auth/osm/callback`, and have its **Client ID** and **Client Secret** to hand.
- [ ] You know your hosting account's home directory path (cPanel shows this, usually something like `/home/yourusername`).

## Step 1 — Build the package

On your own machine, in this folder:

```
php scripts/build-deploy.php
php scripts/zip-dist.php
```

This creates `7thportal-php-deploy.zip` (also leaves the unzipped version in `dist/` if you'd rather upload file-by-file via FTP instead). The zip contains `src/`, `webroot/`, `data/.htaccess`, `.env.example` and the README - that's everything, nothing else needs to be uploaded.

(`zip-dist.php` matters, don't substitute Windows' own "Compress to ZIP" or PowerShell's `Compress-Archive` here - both store backslash path separators that some server-side unzip tools mishandle, silently producing files with literal backslashes in their names instead of real folders. `zip-dist.php` uses PHP's zip library directly to avoid that.)

## Step 2 — Upload it to ONE location, outside public_html

Using cPanel's File Manager: click **Upload**, pick `7thportal-php-deploy.zip`, then once it's uploaded, right-click it in File Manager and choose **Extract** - do this **outside `public_html`**, directly in your home directory, e.g. into a new folder:

```
/home/yourusername/7thportal-php/
```

so you end up with:

```
/home/yourusername/7thportal-php/
  src/
  webroot/
  data/.htaccess
  .env.example
  README.md
```

**Do not** put this folder inside `public_html`. The whole point of this layout is that `src/` (your code) and the `data/` folder you're about to create are never reachable by a web browser - only `webroot/` is.

(No zip tool handy, or prefer FTP? Upload the contents of the unzipped `dist/` folder file-by-file instead - same end result.)

## Step 3 — Point the subdomain at webroot/, not at the folder itself

In cPanel → **Domains** (or **Subdomains**), edit `digital.7thswindon.org.uk` (or create it if it doesn't exist yet) and set its **Document Root** to:

```
/home/yourusername/7thportal-php/webroot
```

**Not** `/home/yourusername/7thportal-php`. This one field is what keeps your database and uploaded photos off the public internet.

If your hosting plan doesn't let you set a custom document root at all (some very basic plans force it to be a fixed folder under `public_html`), tell me and we'll adjust - the fallback `.htaccess` deny-rules in `src/` and `data/` give some protection, but a forced document root inside the code folder isn't the intended setup.

## Step 4 — Create the .env file

Still in File Manager, inside `/home/yourusername/7thportal-php/` (next to `src/`, **not** inside `webroot/`):

1. Copy `.env.example` to a new file named `.env`.
2. Edit `.env` and set:

```
OSM_CLIENT_ID=<your real Client ID from OSM>
OSM_CLIENT_SECRET=<your real Client Secret from OSM>
OSM_REDIRECT_URI=https://digital.7thswindon.org.uk/auth/osm/callback

SESSION_SECRET=<any long random string - mash the keyboard>

APP_ENV=production

ALLOW_DEMO_MODE=false
```

Leave `SMTP_*` blank for now (parent invite links will show as a copyable URL to the admin instead of emailing automatically - fine to start with).

**Set `ALLOW_DEMO_MODE=false` for the real deployment.** Demo accounts have real admin/leader privileges over whatever real data ends up in this database - leaving demo mode on once real families are using it means anyone who visits the site could click "Demo: Admin view" and get in. Demo mode is for local testing only.

## Step 5 — Confirm PHP has what it needs

In cPanel, look for **"MultiPHP Manager"** or **"Select PHP Version"** for the `digital.7thswindon.org.uk` domain and check:

- [ ] PHP version is 8.1 or newer
- [ ] These extensions are enabled: `pdo_sqlite`, `gd`, `curl`, `mbstring` (there's usually a checklist of extensions in the same screen)
- [ ] `mod_rewrite` is available (essentially always true on cPanel; only worth checking if step 6 fails)

If `pdo_sqlite` or `gd` aren't listed as available at all, tell me - that would need a different hosting plan or a workaround.

## Step 6 — Test it

Visit `https://digital.7thswindon.org.uk/` in a browser. You should see the 7thPortal homepage with a **"Log in with OSM"** button and no Demo Mode buttons (since you set `ALLOW_DEMO_MODE=false`).

Click **Log in with OSM** and sign in with your own OSM account - since this is the very first login, you'll automatically become the Portal Administrator.

If instead you get a blank page, a PHP error, or a 500 error:
- Check cPanel's **Errors** log (or `error_log` inside your account) for the actual PHP error message.
- Send me exactly what it says and I'll help fix it.

## Step 7 — Verify the database/photos aren't publicly reachable

Once the app has run at least once (so `data/7thportal.db` exists), try visiting:

```
https://digital.7thswindon.org.uk/../data/7thportal.db
```

(or ask me and I'll give you the exact adjusted URL based on where things ended up). This **must** fail (404 or 403). If it somehow loads the database file, stop and tell me immediately - that means the document root wasn't set correctly in Step 3.

## Redeploying later (after the first successful deploy)

1. `php scripts/build-deploy.php` again.
2. Upload the new `src/` and `webroot/` contents, overwriting the old ones.
3. **Do not** touch `.env` or `data/` on the server - those hold your real configuration and real data. The build never includes them, so as long as you only copy what's in `dist/`, they're safe.
