const pool = require('./db');
require('dotenv').config();

const migrate = async () => {
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255),
        ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
    `);

    await pool.query(`DELETE FROM game_signups`);
    await pool.query(`DELETE FROM game_invites`);
    await pool.query(`DELETE FROM attendance`);
    await pool.query(`DELETE FROM stats`);
    await pool.query(`DELETE FROM games`);
    await pool.query(`DELETE FROM users`);

    await pool.query(`
      ALTER TABLE users ALTER COLUMN email SET NOT NULL;
    `).catch(() => {});

    console.log('Migration complete');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
};

migrate();