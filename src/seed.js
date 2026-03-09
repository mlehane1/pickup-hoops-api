const pool = require('./db');
require('dotenv').config();

const seed = async () => {
  try {
    await pool.query(`
      INSERT INTO users (id, name, role) VALUES
        ('admin1', 'Coach Rivera', 'admin'),
        ('admin2', 'Marcus Hill', 'admin'),
        ('p1', 'DeShawn Brooks', 'player'),
        ('p2', 'Tyler Nguyen', 'player'),
        ('p3', 'Jordan Weiss', 'player'),
        ('p4', 'Kevin Osei', 'player'),
        ('p5', 'Amir Saleh', 'player'),
        ('p6', 'Chris Patel', 'player'),
        ('p7', 'Dante Cruz', 'player'),
        ('p8', 'Noah Williams', 'player')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('Users seeded successfully');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
};

seed();
