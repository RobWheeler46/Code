const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// Returns false (without throwing) if SMTP isn't configured - email alerts are optional (FR-044).
async function sendAlertEmail(subject, text) {
  const transport = getTransport();
  if (!transport || !process.env.ALERT_EMAIL_TO) return false;
  await transport.sendMail({
    from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject,
    text
  });
  return true;
}

module.exports = { sendAlertEmail };
