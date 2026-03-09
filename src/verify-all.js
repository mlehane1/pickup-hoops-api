const pool = require('./db');
require('dotenv').config();

const verifyAll = async () => {
  try {
    const result = await pool.query(
      'UPDATE users SET is_verified = true WHERE is_verified = false RETURNING email'
    );
    console.log(`Verified ${result.rowCount} accounts:`);
    result.rows.forEach(r => console.log(' -', r.email));
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
};

verifyAll();
