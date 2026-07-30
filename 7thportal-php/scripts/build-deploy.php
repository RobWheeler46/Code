<?php
// Assembles exactly the files that belong on the production server into
// ./dist, so deploying by hand (FTP/SFTP/file manager copy-paste) is just
// "upload the contents of dist" rather than guessing what to skip.
//
// Unlike the Node version's build script, there's no dependency-install step
// here - plain PHP files run immediately, nothing to compile or npm install.

$root = dirname(__DIR__);
$outDir = $root . '/dist';

function rrmdir(string $dir): void
{
    if (!is_dir($dir)) return;
    foreach (scandir($dir) as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = "$dir/$item";
        is_dir($path) ? rrmdir($path) : unlink($path);
    }
    rmdir($dir);
}

function copyTree(string $src, string $dest): void
{
    if (is_dir($src)) {
        if (!is_dir($dest)) mkdir($dest, 0775, true);
        foreach (scandir($src) as $item) {
            if ($item === '.' || $item === '..') continue;
            copyTree("$src/$item", "$dest/$item");
        }
    } else {
        $destDir = dirname($dest);
        if (!is_dir($destDir)) mkdir($destDir, 0775, true);
        copy($src, $dest);
    }
}

rrmdir($outDir);
mkdir($outDir, 0775, true);

// Deliberately does NOT include .env (create fresh on the server with real
// secrets - never upload the local dev one) or data/ contents (the SQLite db
// and uploaded photos are runtime state, not source).
$include = ['src', 'webroot', '.env.example', 'README.md'];
foreach ($include as $item) {
    $srcPath = "$root/$item";
    if (!file_exists($srcPath)) { echo "Warning - expected but not found (skipped): $item\n"; continue; }
    copyTree($srcPath, "$outDir/$item");
}

// Empty placeholder so there's somewhere for the db/uploads to be created on
// first run - but the data/.htaccess deny-all fallback (defence in depth if
// a host won't let the document root be pointed at webroot/ only) is real
// source, not a placeholder, and must be copied like anything else.
mkdir("$outDir/data/gallery-uploads", 0775, true);
touch("$outDir/data/gallery-uploads/.gitkeep");
if (file_exists("$root/data/.htaccess")) copy("$root/data/.htaccess", "$outDir/data/.htaccess");

echo "\n7thPortal (PHP) deploy build ready in ./dist\n\n";
// Stamp a build id into dist/webroot/build.txt - the home page fetches it and
// shows "Build <id>" in the footer, so you can confirm which build is live after
// a deploy. Timestamp plus the short git commit hash when git is available.
$gitHash = trim((string) @shell_exec('git -C ' . escapeshellarg($root) . ' rev-parse --short HEAD 2>/dev/null'));
$buildId = date('Y-m-d H:i') . ($gitHash !== '' ? " ($gitHash)" : '');
file_put_contents("$outDir/webroot/build.txt", $buildId);

echo "Build id: $buildId  <- shown on the home page footer; check it matches after deploying\n\n";

// Cache-busting: append ?v=<version> to every local css/js reference in the
// deployed HTML. Without this, browsers keep serving the previously-cached
// style.css/*.js after a redeploy and changes appear not to have shipped. The
// version changes every build, so each deploy forces a fresh fetch. Only the
// dist copies are rewritten - the source HTML stays clean.
$assetVer = date('YmdHi') . ($gitHash !== '' ? "-$gitHash" : '');
$rewritten = 0;
foreach (glob("$outDir/webroot/*.html") as $hf) {
    $html = file_get_contents($hf);
    $new = preg_replace_callback(
        '~\b(href|src)="((?:css|js)/[^"?]+\.(?:css|js))"~i',
        fn($m) => $m[1] . '="' . $m[2] . '?v=' . $assetVer . '"',
        $html
    );
    if ($new !== $html) { file_put_contents($hf, $new); $rewritten++; }
}
echo "Cache-busting: stamped ?v=$assetVer onto css/js links in $rewritten HTML file(s).\n";
echo "  -> after deploying, a normal refresh picks up the new assets. If the PAGE\n";
echo "     itself looks stale, hard-refresh once (Ctrl+F5 / Cmd+Shift+R).\n\n";
echo "Included: " . implode(', ', $include) . " (plus an empty data/ placeholder)\n\n";
echo "Not included (by design):\n";
echo "  - .env                             -> create fresh on the server with real secrets; never upload your local one\n";
echo "  - data/*.db*, data/gallery-uploads -> runtime state; do not overwrite existing production data on redeploy\n\n";
echo "On the server (see README \"Deployment layout\" for why this split matters):\n";
echo "  1. Upload the whole dist/ folder to one place in your hosting account OUTSIDE public_html - e.g. a\n";
echo "     sibling folder like ~/7thportal-php (src/, data/, webroot/ and .env.example all stay together).\n";
echo "  2. In cPanel, set the portal.7thswindon.org.uk subdomain's Document Root to that folder's webroot/\n";
echo "     subfolder specifically - NOT the dist/ folder itself. This is what keeps src/ and data/ off the\n";
echo "     public internet; if your host won't let you set a custom document root, see the README's fallback note.\n";
echo "  3. First deploy only: copy .env.example to .env next to src/ (NOT inside webroot/), then fill in real values.\n";
echo "  4. Confirm PHP's pdo_sqlite, gd and curl extensions are enabled (ask your host if unsure).\n";
echo "  5. Confirm mod_rewrite is enabled so webroot/.htaccess can route API requests to index.php.\n\n";
echo "On redeploys: skip step 3 - your server's .env and data/ already exist and must not be overwritten.\n";
