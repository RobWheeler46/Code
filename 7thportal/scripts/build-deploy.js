// Assembles exactly the files that belong on the production server into
// ./dist, so deploying by hand (FTP/SFTP/file manager copy-paste) is just
// "upload the contents of dist" rather than guessing what to skip.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

// Everything the running app needs. Deliberately does NOT include
// node_modules (reinstalled on the server from package-lock.json instead -
// avoids shipping platform-specific binaries), .env (must be created fresh
// on the server with real secrets - never copy the local dev one), or data/
// (the SQLite db and uploaded photos are runtime state, not source).
const INCLUDE = [
  'package.json',
  'package-lock.json',
  'README.md',
  '.env.example',
  'src',
  'public',
];

function main() {
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const copied = [];
  const missing = [];
  for (const item of INCLUDE) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) { missing.push(item); continue; }
    fs.cpSync(src, path.join(OUT_DIR, item), { recursive: true });
    copied.push(item);
  }

  // Empty placeholder so the server has somewhere to create the db/uploads
  // on first run, without risking an empty data/ folder being skipped by
  // some FTP clients that don't upload directories with no files in them.
  fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'data', '.gitkeep'), '');

  console.log('\n7thPortal deploy build ready in ./dist\n');
  console.log('Included:');
  copied.forEach(m => console.log(`  - ${m}`));
  if (missing.length) {
    console.log('\nWarning - expected but not found (skipped):');
    missing.forEach(m => console.log(`  - ${m}`));
  }
  console.log('\nNot included (by design):');
  console.log('  - node_modules                     -> run "npm install --omit=dev" on the server instead');
  console.log('  - .env                             -> create fresh on the server with real secrets; never upload your local one');
  console.log('  - data/*.db*, data/gallery-uploads  -> runtime state; do not overwrite existing production data on redeploy');
  console.log('\nOn the server:');
  console.log('  1. Upload everything inside ./dist (not the dist folder itself) to the app directory');
  console.log('  2. First deploy only: cp .env.example .env, then fill in real values (OSM_CLIENT_ID/SECRET/REDIRECT_URI, SESSION_SECRET, PORT, etc.)');
  console.log('  3. npm install --omit=dev');
  console.log('  4. node src/server.js   (or run it under a process manager such as pm2 so it restarts on crash/reboot)');
  console.log('\nOn redeploys: skip step 2 - your server\'s .env and data/ already exist and must not be overwritten.\n');
}

main();
