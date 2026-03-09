const pool = require('./db');
require('dotenv').config();

const migrate = async () => {
  try {
    await pool.query('ALTER TABLE games RENAME COLUMN admin_id TO owner_id');
    console.log('Renamed admin_id to owner_id');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_managers (
        game_id VARCHAR(50) REFERENCES games(id) ON DELETE CASCADE,
        user_id VARCHAR(50) REFERENCES users(id),
        PRIMARY KEY (game_id, user_id)
      )
    `);
    console.log('Created game_managers table');

    await pool.query("UPDATE users SET role = 'user' WHERE role = 'player'");
    console.log('Updated user roles');

    console.log('Migration complete');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
};

migrate();
