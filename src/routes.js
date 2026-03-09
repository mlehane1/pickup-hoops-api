const express = require('express');
const router = express.Router();
const pool = require('./db');
const { authenticate } = require('./auth');

// ─── USERS ────────────────────────────────────────────────────────────────────

router.get('/users', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role FROM users ORDER BY role, name'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GAMES ────────────────────────────────────────────────────────────────────

router.get('/games', authenticate, async (req, res) => {
  try {
    const games = await pool.query('SELECT * FROM games ORDER BY date ASC');

    for (let game of games.rows) {
      const invites = await pool.query(
        'SELECT user_id FROM game_invites WHERE game_id = $1', [game.id]
      );
      const signups = await pool.query(
        'SELECT user_id FROM game_signups WHERE game_id = $1', [game.id]
      );
      game.invited_ids = invites.rows.map(r => r.user_id);
      game.signup_ids = signups.rows.map(r => r.user_id);
    }

    res.json(games.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/games/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });

    const game = result.rows[0];

    const invites = await pool.query(
      'SELECT user_id FROM game_invites WHERE game_id = $1', [game.id]
    );
    const signups = await pool.query(
      'SELECT user_id FROM game_signups WHERE game_id = $1', [game.id]
    );
    const attendance = await pool.query(
      'SELECT user_id, date FROM attendance WHERE game_id = $1', [game.id]
    );
    const stats = await pool.query(
      'SELECT user_id, date, pts, reb, ast, stl, blk FROM stats WHERE game_id = $1', [game.id]
    );

    game.invited_ids = invites.rows.map(r => r.user_id);
    game.signup_ids = signups.rows.map(r => r.user_id);

    game.attendance = {};
    attendance.rows.forEach(r => {
      const d = r.date.toISOString().split('T')[0];
      if (!game.attendance[d]) game.attendance[d] = [];
      game.attendance[d].push(r.user_id);
    });

    game.stats = {};
    stats.rows.forEach(r => {
      const d = r.date.toISOString().split('T')[0];
      if (!game.stats[d]) game.stats[d] = {};
      game.stats[d][r.user_id] = {
        pts: r.pts, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk
      };
    });

    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games', authenticate, async (req, res) => {
  const { id, admin_id, title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats, invited_ids } = req.body;
  try {
    await pool.query(
      `INSERT INTO games (id, admin_id, title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, admin_id, title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats]
    );

    if (invited_ids?.length) {
      for (const uid of invited_ids) {
        await pool.query(
          'INSERT INTO game_invites (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, uid]
        );
      }
    }

    const game = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
    res.status(201).json(game.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/games/:id', authenticate, async (req, res) => {
  const { title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats, status, invited_ids } = req.body;
  try {
    await pool.query(
      `UPDATE games SET title=$1, location=$2, date=$3, time=$4, max_spots=$5,
       is_recurring=$6, recurrence=$7, is_public=$8, track_stats=$9, status=$10
       WHERE id=$11`,
      [title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats, status, req.params.id]
    );

    await pool.query('DELETE FROM game_invites WHERE game_id = $1', [req.params.id]);
    if (invited_ids?.length) {
      for (const uid of invited_ids) {
        await pool.query(
          'INSERT INTO game_invites (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, uid]
        );
      }
    }

    const game = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    res.json(game.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/games/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SIGNUPS ──────────────────────────────────────────────────────────────────

router.post('/games/:id/signup', authenticate, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO game_signups (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, req.body.user_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/games/:id/signup', authenticate, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM game_signups WHERE game_id = $1 AND user_id = $2',
      [req.params.id, req.body.user_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────

router.post('/games/:id/attendance', authenticate, async (req, res) => {
  const { date, user_ids } = req.body;
  try {
    await pool.query(
      'DELETE FROM attendance WHERE game_id = $1 AND date = $2',
      [req.params.id, date]
    );
    for (const uid of user_ids) {
      await pool.query(
        'INSERT INTO attendance (game_id, user_id, date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.params.id, uid, date]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.post('/games/:id/stats', authenticate, async (req, res) => {
  const { date, stats } = req.body;
  try {
    for (const [uid, s] of Object.entries(stats)) {
      await pool.query(
        `INSERT INTO stats (game_id, user_id, date, pts, reb, ast, stl, blk)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (game_id, user_id, date)
         DO UPDATE SET pts=$4, reb=$5, ast=$6, stl=$7, blk=$8`,
        [req.params.id, uid, date, s.pts, s.reb, s.ast, s.stl, s.blk]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;