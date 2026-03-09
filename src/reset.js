const pool = require('./db');
require('dotenv').config();

const reset = async () => {
  try {
    await pool.query(`
      DROP TABLE IF EXISTS stats CASCADE;
      DROP TABLE IF EXISTS attendance CASCADE;
      DROP TABLE IF EXISTS game_signups CASCADE;
      DROP TABLE IF EXISTS game_invites CASCADE;
      DROP TABLE IF EXISTS games CASCADE;
      DROP TABLE IF EXISTS password_reset_tokens CASCADE;
      DROP TABLE IF EXISTS invite_tokens CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);
    console.log('Tables dropped');
    process.exit(0);
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exit(1);
  }
};

reset();
