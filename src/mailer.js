const Mailjet = require('node-mailjet');
require('dotenv').config();

const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

const FROM_EMAIL = process.env.MAILJET_FROM_EMAIL;
const FROM_NAME = 'Pickup Hoops';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3001';

const sendEmail = async (to, toName, subject, htmlContent) => {
  console.log(`[MAILER] Attempting to send "${subject}" to ${to}`);
  console.log(`[MAILER] From: ${FROM_EMAIL}`);
  console.log(`[MAILER] API Key present: ${!!process.env.MAILJET_API_KEY}`);
  console.log(`[MAILER] Secret Key present: ${!!process.env.MAILJET_SECRET_KEY}`);

  try {
    const result = await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [
        {
          From: { Email: FROM_EMAIL, Name: FROM_NAME },
          To: [{ Email: to, Name: toName }],
          Subject: subject,
          HTMLPart: htmlContent,
        },
      ],
    });
    console.log(`[MAILER] Success - Status: ${result.response.status}`);
    console.log(`[MAILER] Response:`, JSON.stringify(result.body, null, 2));
  } catch (err) {
    console.error(`[MAILER] Failed to send email to ${to}`);
    console.error(`[MAILER] Error:`, err.message);
    if (err.response) {
      console.error(`[MAILER] Response status:`, err.response.status);
      console.error(`[MAILER] Response body:`, JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }
};

const emailWrapper = (content) => `
  <div style="background:#0B0C0E;padding:40px 20px;font-family:sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#141518;border:1px solid #2A2D36;border-radius:12px;padding:32px;">
      <div style="margin-bottom:24px;">
        <span style="font-size:22px;font-weight:900;color:#F97316;letter-spacing:2px;">PICKUP.HOOPS</span>
      </div>
      ${content}
      <div style="margin-top:32px;padding-top:20px;border-top:1px solid #2A2D36;font-size:12px;color:#6B7280;">
        If you didn't request this email you can safely ignore it.
      </div>
    </div>
  </div>
`;

const sendVerification = async (email, name, token, userId) => {
  const link = `${API_URL}/api/auth/verify/${userId}/${token}`;
  console.log(`[MAILER] Verification link: ${link}`);
  await sendEmail(email, name, 'Verify your Pickup Hoops account', emailWrapper(`
    <h2 style="color:#E8E9EE;margin:0 0 8px;">Hey ${name},</h2>
    <p style="color:#9CA3AF;margin:0 0 24px;">Verify your email to activate your account.</p>
    <a href="${link}" style="display:inline-block;background:#F97316;color:#fff;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:1px;">
      VERIFY EMAIL
    </a>
    <p style="color:#6B7280;font-size:12px;margin-top:20px;">Link expires in 24 hours.</p>
  `));
};

const sendPasswordReset = async (email, name, token) => {
  const link = `${APP_URL}/reset-password?token=${token}`;
  console.log(`[MAILER] Password reset link: ${link}`);
  await sendEmail(email, name, 'Reset your Pickup Hoops password', emailWrapper(`
    <h2 style="color:#E8E9EE;margin:0 0 8px;">Password Reset</h2>
    <p style="color:#9CA3AF;margin:0 0 24px;">Click below to set a new password for your account.</p>
    <a href="${link}" style="display:inline-block;background:#F97316;color:#fff;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:1px;">
      RESET PASSWORD
    </a>
    <p style="color:#6B7280;font-size:12px;margin-top:20px;">Link expires in 1 hour.</p>
  `));
};

const sendInvite = async (email, inviterName, token, role) => {
  const link = `${APP_URL}/register?invite=${token}`;
  console.log(`[MAILER] Invite link: ${link}`);
  await sendEmail(email, email, "You've been invited to Pickup Hoops", emailWrapper(`
    <h2 style="color:#E8E9EE;margin:0 0 8px;">You're invited!</h2>
    <p style="color:#9CA3AF;margin:0 0 8px;">${inviterName} has invited you to join Pickup Hoops as a <strong style="color:#F97316">${role}</strong>.</p>
    <p style="color:#9CA3AF;margin:0 0 24px;">Sign up to start joining pickup basketball games.</p>
    <a href="${link}" style="display:inline-block;background:#F97316;color:#fff;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:1px;">
      ACCEPT INVITE
    </a>
    <p style="color:#6B7280;font-size:12px;margin-top:20px;">Invite expires in 7 days.</p>
  `));
};

module.exports = { sendVerification, sendPasswordReset, sendInvite };
