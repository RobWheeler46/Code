const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');

require('./db'); // ensure schema is initialized

const authRoutes = require('./routes/auth');
const watchlistRoutes = require('./routes/watchlists');
const assetRoutes = require('./routes/assets');
const signalRoutes = require('./routes/signals');
const alertRoutes = require('./routes/alerts');
const noteRoutes = require('./routes/notes');
const settingsRoutes = require('./routes/settings');
const dashboardRoutes = require('./routes/dashboard');
const { requireAuth } = require('./lib/middleware');
const scheduler = require('./lib/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));

app.use('/api', authRoutes);
app.use('/api/watchlists', requireAuth, watchlistRoutes);
app.use('/api/assets', requireAuth, assetRoutes);
app.use('/api/signals', requireAuth, signalRoutes);
app.use('/api/alerts', requireAuth, alertRoutes);
app.use('/api/notes', requireAuth, noteRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Market Research Desk running at http://localhost:${PORT}`);
  scheduler.start();
});
