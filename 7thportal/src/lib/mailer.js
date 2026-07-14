const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Returns false (without throwing) if SMTP isn't configured - the admin UI
// falls back to showing the invite link to copy/send manually.
async function sendInviteEmail(toEmail, firstName, setupUrl) {
  const transport = getTransport();
  if (!transport) return false;
  await transport.sendMail({
    from: process.env.INVITE_EMAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: '7thPortal - set up your parent/carer account',
    text: `Hi ${firstName},\n\nA 7th Swindon Scout Group leader has set up a 7thPortal account for you so you can view your child's information.\n\nSet your password here: ${setupUrl}\n\nThis link expires in 7 days.\n`,
  });
  return true;
}

module.exports = { sendInviteEmail };
