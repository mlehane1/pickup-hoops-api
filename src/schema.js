const pool = require('./db');

const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      role VARCHAR(20) NOT NULL DEFAULT 'player',
      mfa_enabled BOOLEAN DEFAULT false,
      mfa_secret VARCHAR(255),
      is_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invite_tokens (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      role VARCHAR(20) DEFAULT 'player',
      created_by VARCHAR(50) REFERENCES users(id),
      used BOOLEAN DEFAULT false,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      used BOOLEAN DEFAULT false,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS games (
      id VARCHAR(50) PRIMARY KEY,
      admin_id VARCHAR(50) REFERENCES users(id),
      title VARCHAR(100) NOT NULL,
      location VARCHAR(200) NOT NULL,
      date DATE NOT NULL,
      time TIME NOT NULL,
      max_spots INTEGER NOT NULL,
      is_recurring BOOLEAN DEFAULT false,
      recurrence VARCHAR(20),
      is_public BOOLEAN DEFAULT true,
      track_stats BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'upcoming',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS game_invites (
      game_id VARCHAR(50) REFERENCES games(id) ON DELETE CASCADE,
      user_id VARCHAR(50) REFERENCES users(id),
      PRIMARY KEY (game_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS game_signups (
      game_id VARCHAR(50) REFERENCES games(id) ON DELETE CASCADE,
      user_id VARCHAR(50) REFERENCES users(id),
      signed_up_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (game_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      game_id VARCHAR(50) REFERENCES games(id) ON DELETE CASCADE,
      user_id VARCHAR(50) REFERENCES users(id),
      date DATE NOT NULL,
      UNIQUE(game_id, user_id, date)
    );

    CREATE TABLE IF NOT EXISTS stats (
      id SERIAL PRIMARY KEY,
      game_id VARCHAR(50) REFERENCES games(id) ON DELETE CASCADE,
      user_id VARCHAR(50) REFERENCES users(id),
      date DATE NOT NULL,
      pts INTEGER DEFAULT 0,
      reb INTEGER DEFAULT 0,
      ast INTEGER DEFAULT 0,
      stl INTEGER DEFAULT 0,
      blk INTEGER DEFAULT 0,
      UNIQUE(game_id, user_id, date)
    );
  `);

  console.log('Tables created successfully');
};

module.exports = createTables;