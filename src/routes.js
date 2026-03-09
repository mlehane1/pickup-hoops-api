const express = require('express');
const router = express.Router();
const pool = require('./db');
const { authenticate } = require('./auth');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const enrichGame = async (game) => {
  const [invites, signups, managers] = await Promise.all([
    pool.query('SELECT user_id FROM game_invites WHERE game_id = $1', [game.id]),
    pool.query('SELECT user_id FROM game_signups WHERE game_id = $1', [game.id]),
    pool.query('SELECT user_id FROM game_managers WHERE game_id = $1', [game.id]),
  ]);
  game.invited_ids = invites.rows.map(r => r.user_id);
  game.signup_ids = signups.rows.map(r => r.user_id);
  game.manager_ids = managers.rows.map(r => r.user_id);
  return game;
};

const canManage = (game, userId) =>
  game.owner_id === userId || game.manager_ids?.includes(userId);

// ─── USERS ────────────────────────────────────────────────────────────────────

router.get('/users', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role FROM users ORDER BY name'
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
    const enriched = await Promise.all(games.rows.map(enrichGame));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/games/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });

    const game = await enrichGame(result.rows[0]);

    const [attendance, stats] = await Promise.all([
      pool.query('SELECT user_id, date FROM attendance WHERE game_id = $1', [game.id]),
      pool.query('SELECT user_id, date, pts, reb, ast, stl, blk FROM stats WHERE game_id = $1', [game.id]),
    ]);

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
  const { id, title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats, invited_ids } = req.body;
  try {
    await pool.query(
      `INSERT INTO games (id, owner_id, title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, req.user.id, title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats]
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
    res.status(201).json(await enrichGame(game.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/games/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });
    const game = await enrichGame(result.rows[0]);

    if (!canManage(game, req.user.id) && req.user.role !== 'master_admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { title, location, date, time, max_spots, is_recurring, recurrence, is_public, track_stats, status, invited_ids, manager_ids } = req.body;

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

    // Only owner can change managers
    if (game.owner_id === req.user.id) {
      await pool.query('DELETE FROM game_managers WHERE game_id = $1', [req.params.id]);
      if (manager_ids?.length) {
        for (const uid of manager_ids) {
          await pool.query(
            'INSERT INTO game_managers (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.params.id, uid]
          );
        }
      }
    }

    const updated = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    res.json(await enrichGame(updated.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/games/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });
    const game = result.rows[0];

    if (game.owner_id !== req.user.id && req.user.role !== 'master_admin') {
      return res.status(403).json({ error: 'Only the game owner can delete this game' });
    }

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
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });
    const game = await enrichGame(result.rows[0]);

    if (!canManage(game, req.user.id) && req.user.role !== 'master_admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { date, user_ids } = req.body;
    await pool.query('DELETE FROM attendance WHERE game_id = $1 AND date = $2', [req.params.id, date]);
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
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });
    const game = await enrichGame(result.rows[0]);

    if (!canManage(game, req.user.id) && req.user.role !== 'master_admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { date, stats } = req.body;
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

// ─── SCORES ───────────────────────────────────────────────────────────────────

router.get('/games/:id/scores', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM game_scores WHERE game_id = $1 ORDER BY date DESC, id DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games/:id/scores', authenticate, async (req, res) => {
  try {
    const game = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!game.rows.length) return res.status(404).json({ error: 'Game not found' });
    const enriched = await enrichGame(game.rows[0]);
    if (!canManage(enriched, req.user.id) && req.user.role !== 'master_admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { date, team1_name, team2_name } = req.body;
    const result = await pool.query(
      `INSERT INTO game_scores (game_id, date, team1_name, team2_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, date, team1_name || 'Team 1', team2_name || 'Team 2']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/games/:id/scores/:scoreId', authenticate, async (req, res) => {
  try {
    const { team1_score, team2_score, team1_name, team2_name, is_final } = req.body;
    const result = await pool.query(
      `UPDATE game_scores
       SET team1_score = $1, team2_score = $2, team1_name = $3,
           team2_name = $4, is_final = $5, updated_at = NOW()
       WHERE id = $6 AND game_id = $7 RETURNING *`,
      [team1_score, team2_score, team1_name, team2_name, is_final, req.params.scoreId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Score not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/games/:id/scores/:scoreId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM game_scores WHERE id = $1 AND game_id = $2', [req.params.scoreId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
