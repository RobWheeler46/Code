const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');

require('./db'); // ensure schema is initialized

const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const { requireAuth } = require('./lib/middleware');

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
app.use('/api/requests', requestRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// Reference data needed by the new-request form (groups a requester belongs to, etc.)
app.get('/api/form-options', requireAuth, (req, res) => {
  const activityForm = require('./lib/activityForm');
  res.json({
    leaderSectionOrRole: activityForm.LEADER_SECTION_OR_ROLE,
    attendingSections: activityForm.ATTENDING_SECTIONS,
    riskAssessmentWording: activityForm.RISK_ASSESSMENT_WORDING,
    rulesConfirmationWording: activityForm.RULES_CONFIRMATION_WORDING,
    accuracyConfirmationWording: activityForm.ACCURACY_CONFIRMATION_WORDING,
    maxFiles: activityForm.MAX_FILES,
    maxFileSizeMb: activityForm.MAX_FILE_SIZE_MB
  });
});

app.get('/api/admin/requesters', requireAuth, (req, res) => {
  if (!req.userRoles.isAdmin) return res.status(403).json({ error: 'Administrator access required.' });
  const db = require('./db');
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.name, u.email FROM users u
    JOIN user_groups ug ON ug.user_id = u.id
    JOIN groups g ON g.id = ug.group_id
    WHERE g.type = 'requester' AND u.active = 1
    ORDER BY u.name
  `).all();
  res.json(users);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'One of the uploaded files is too large.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`7th Swindon Form Request Manager running at http://localhost:${PORT}`);
});
