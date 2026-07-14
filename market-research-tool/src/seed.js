const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./lib/auth');

function run() {
  const existing = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (existing) {
    console.log(`A user already exists (username: ${existing.username}). Nothing to do.`);
    return;
  }

  const username = process.argv[2] || 'rob';
  const password = process.argv[3] || crypto.randomBytes(9).toString('base64url');

  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hashPassword(password));

  db.prepare(`
    INSERT INTO watchlists (user_id, name, description, category)
    VALUES (1, 'Main Watchlist', 'Default personal watchlist', 'general')
  `).run();

  console.log('Seed complete.');
  console.log('');
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  if (!process.argv[3]) {
    console.log('');
    console.log('(This password was generated - save it now, it will not be shown again.');
    console.log(' Run `npm run seed <username> <password>` instead to set your own.)');
  }
}

run();
