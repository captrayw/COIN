const express  = require('express');
const { Pool } = require('pg');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/',      (req, res) => res.sendFile(path.join(__dirname, 'coin-flip.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ── Database ──
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  Promise.all([
    pool.query(`CREATE TABLE IF NOT EXISTS scores (
      id         SERIAL PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      score      INTEGER NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )`),
    pool.query(`CREATE TABLE IF NOT EXISTS extra_lives (
      name       TEXT PRIMARY KEY,
      granted_at TIMESTAMP DEFAULT NOW()
    )`),
    pool.query(`CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
  ]).catch(console.error);
}

// ── Scores ──
app.get('/api/scores', async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const { rows } = await pool.query(
      'SELECT name, score FROM scores ORDER BY score DESC LIMIT $1', [limit]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/scores', async (req, res) => {
  if (!pool) return res.json({ ok: true });
  const { name, score } = req.body;
  if (!name || typeof score !== 'number') return res.status(400).json({ error: 'Invalid data' });
  try {
    await pool.query(`
      INSERT INTO scores (name, score) VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE
        SET score = GREATEST(scores.score, EXCLUDED.score), updated_at = NOW()
    `, [name.trim().slice(0, 30), score]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Extra Lives ──
app.get('/api/extra-life', async (req, res) => {
  if (!pool) return res.json({ hasLife: false });
  const { name } = req.query;
  if (!name) return res.json({ hasLife: false });
  try {
    const { rows } = await pool.query('SELECT 1 FROM extra_lives WHERE name = $1', [name.trim()]);
    res.json({ hasLife: rows.length > 0 });
  } catch (e) { res.json({ hasLife: false }); }
});

app.get('/api/all-lives', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!pool) return res.json([]);
  const { rows } = await pool.query('SELECT name FROM extra_lives ORDER BY granted_at DESC');
  res.json(rows);
});

app.post('/api/grant-life', async (req, res) => {
  const { name, secret } = req.body;
  if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!pool) return res.json({ ok: true });
  try {
    await pool.query(`INSERT INTO extra_lives (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name.trim()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/use-life', async (req, res) => {
  if (!pool) return res.json({ ok: true });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  try {
    await pool.query('DELETE FROM extra_lives WHERE name = $1', [name.trim()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Global Reset ──
app.get('/api/reset-check', async (req, res) => {
  if (!pool) return res.json({ ts: 0 });
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'global_reset_ts'");
    res.json({ ts: rows.length ? parseInt(rows[0].value) : 0 });
  } catch (e) { res.json({ ts: 0 }); }
});

app.post('/api/global-reset', async (req, res) => {
  const { secret } = req.body;
  if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!pool) return res.json({ ok: true });
  try {
    const ts = Date.now().toString();
    await pool.query(`
      INSERT INTO settings (key, value) VALUES ('global_reset_ts', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1
    `, [ts]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
