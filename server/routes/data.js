'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// All data routes require authentication
router.use(requireAuth);

// GET /api/data/:key — read single key
router.get('/:key', (req, res) => {
    const row = db.prepare('SELECT value, updated_at FROM data_store WHERE key = ?')
        .get(req.params.key);
    if (!row) {
        return res.status(404).json({ error: 'Key not found' });
    }
    res.json({ key: req.params.key, value: JSON.parse(row.value), updatedAt: row.updated_at });
});

// PUT /api/data/:key — create or update
router.put('/:key', (req, res) => {
    const { value } = req.body;
    if (value === undefined) {
        return res.status(400).json({ error: 'Missing value' });
    }
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES (?, ?, ?)')
        .run(req.params.key, JSON.stringify(value), now);
    res.json({ ok: true, updatedAt: now });
});

// DELETE /api/data/:key — delete
router.delete('/:key', (req, res) => {
    const result = db.prepare('DELETE FROM data_store WHERE key = ?').run(req.params.key);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Key not found' });
    }
    res.json({ ok: true });
});

// POST /api/data/bulk — read multiple keys at once
router.post('/bulk', (req, res) => {
    const { keys } = req.body;
    if (!Array.isArray(keys)) {
        return res.status(400).json({ error: 'keys must be an array' });
    }
    const placeholders = keys.map(() => '?').join(',');
    const rows = db.prepare(`SELECT key, value FROM data_store WHERE key IN (${placeholders})`)
        .all(...keys);

    const data = {};
    for (const row of rows) {
        data[row.key] = JSON.parse(row.value);
    }
    res.json({ data });
});

// POST /api/data/export — export all data as JSON
router.post('/export', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM data_store').all();
    const data = {};
    for (const row of rows) {
        data[row.key] = JSON.parse(row.value);
    }
    res.json({ exportedAt: Date.now(), data });
});

// POST /api/data/import — import data from JSON (merge/overwrite)
router.post('/import', (req, res) => {
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid import data' });
    }
    const now = Date.now();
    const stmt = db.prepare('INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES (?, ?, ?)');
    const insertMany = db.transaction((entries) => {
        for (const [key, value] of entries) {
            stmt.run(key, JSON.stringify(value), now);
        }
    });
    insertMany(Object.entries(data));
    res.json({ ok: true, importedKeys: Object.keys(data).length });
});

module.exports = router;
