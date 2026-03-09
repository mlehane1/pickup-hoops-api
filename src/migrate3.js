const pool = require('./db');
require('dotenv').config();

const migrate = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_scores (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(50) REFERENCES games(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        team1_name VARCHAR(100) NOT NULL DEFAULT 'Team 1',
        team2_name VARCHAR(100) NOT NULL DEFAULT 'Team 2',
        team1_score INTEGER DEFAULT 0,
        team2_score INTEGER DEFAULT 0,
        is_final BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('game_scores table created');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
};

migrate();
