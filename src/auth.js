const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const pool = require('./db');
const { sendPasswordReset, sendInvite, sendVerification } = require('./mailer');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'master_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireMasterAdmin = (req, res, next) => {
  if (req.user.role !== 'master_admin') {
    return res.status(403).json({ error: 'Master admin access required' });
  }
  next();
};

module.exports.authenticate = authenticate;
module.exports.requireAdmin = requireAdmin;

// ─── REGISTER ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, password, invite_token } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(400).json({ error: 'Email already registered' });

    let role = 'player';
    let inviteRecord = null;

    if (invite_token) {
      const invite = await pool.query(
        'SELECT * FROM invite_tokens WHERE token = $1 AND used = false AND expires_at > NOW()',
        [invite_token]
      );
      if (!invite.rows.length) return res.status(400).json({ error: 'Invalid or expired invite' });
      inviteRecord = invite.rows[0];
      role = inviteRecord.role;
    }

    // Check if this is the very first user — make them master admin
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCount.rows[0].count) === 0) role = 'master_admin';

    const password_hash = await bcrypt.hash(password, 12);
    const id = `u${Date.now()}`;

    const verifyToken = require('crypto').randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, is_verified)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [id, name, email.toLowerCase(), password_hash, role]
    );

    await sendVerification(email, name, verifyToken, id);

    if (inviteRecord) {
      await pool.query('UPDATE invite_tokens SET used = true WHERE id = $1', [inviteRecord.id]);
    }

    res.status(201).json({ message: 'Account created. Please check your email to verify your account.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
router.get('/verify/:userId/:token', async (req, res) => {
  try {
    const { userId, token } = req.params;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!result.rows.length) return res.status(400).send('Invalid verification link');

    await pool.query('UPDATE users SET is_verified = true WHERE id = $1', [userId]);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0B0C0E;color:#E8E9EE">
        <h1 style="color:#F97316">Email Verified</h1>
        <p>Your account is now active. You can close this tab and log in.</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('Verification failed');
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.is_verified) return res.status(401).json({ error: 'Please verify your email before logging in' });

    if (user.mfa_enabled) {
      const tempToken = jwt.sign({ userId: user.id, mfa_pending: true }, JWT_SECRET, { expiresIn: '10m' });
      return res.json({ mfa_required: true, temp_token: tempToken });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mfa_enabled: user.mfa_enabled }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MFA VERIFY ───────────────────────────────────────────────────────────────
router.post('/mfa/verify', async (req, res) => {
  const { temp_token, code } = req.body;
  try {
    const decoded = jwt.verify(temp_token, JWT_SECRET);
    if (!decoded.mfa_pending) return res.status(401).json({ error: 'Invalid token' });

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    const user = result.rows[0];

    const valid = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!valid) return res.status(401).json({ error: 'Invalid MFA code' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mfa_enabled: user.mfa_enabled }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MFA SETUP ────────────────────────────────────────────────────────────────
router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ name: `PickupHoops (${req.user.email})` });
    await pool.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mfa/enable', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
    const valid = speakeasy.totp.verify({
      secret: result.rows[0].mfa_secret,
      encoding: 'base32',
      token: req.body.code,
      window: 1,
    });
    if (!valid) return res.status(401).json({ error: 'Invalid code' });
    await pool.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mfa/disable', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PASSWORD RESET ───────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!result.rows.length) return res.json({ message: 'If that email exists you will receive a reset link' });

    const user = result.rows[0];
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expires]
    );

    await sendPasswordReset(user.email, user.name, token);
    res.json({ message: 'If that email exists you will receive a reset link' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired reset link' });

    const reset = result.rows[0];
    const password_hash = await bcrypt.hash(password, 12);

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, reset.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [reset.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INVITE ───────────────────────────────────────────────────────────────────
router.post('/invite', authenticate, requireAdmin, async (req, res) => {
  const { email, role } = req.body;
  try {
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 3600000); // 7 days

    await pool.query(
      'INSERT INTO invite_tokens (email, token, role, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [email.toLowerCase(), token, role || 'player', req.user.id, expires]
    );

    await sendInvite(email, req.user.name, token, role || 'player');
    res.json({ message: 'Invite sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: MANAGE USERS ──────────────────────────────────────────────────────
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, role, is_verified, mfa_enabled, created_at FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id/role', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [req.body.role, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ME ───────────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    mfa_enabled: req.user.mfa_enabled,
  });
});

module.exports.router = router;