'use strict';

const express = require('express');
const argon2 = require('argon2');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// Rate limit: 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { ok: false, error: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip
});

// Lockout duration based on failed attempts
function getLockDuration(attempts) {
    if (attempts >= 20) return 24 * 60 * 60 * 1000; // 24h
    if (attempts >= 10) return 60 * 60 * 1000;       // 1h
    if (attempts >= 5) return 15 * 60 * 1000;         // 15min
    return 0;
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
        }

        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

        // Uniform error message to prevent user enumeration
        const FAIL_MSG = '用户名或密码错误';

        if (!user) {
            // Fake delay to prevent timing attacks
            await argon2.hash('dummy-password-for-timing');
            return res.status(401).json({ ok: false, error: FAIL_MSG });
        }

        // Check lockout
        if (user.locked_until > Date.now()) {
            const remainingMs = user.locked_until - Date.now();
            const remainingMin = Math.ceil(remainingMs / 60000);
            return res.status(429).json({
                ok: false,
                error: `账户已锁定，请 ${remainingMin} 分钟后再试`
            });
        }

        // Verify password
        const valid = await argon2.verify(user.password_hash, password);

        if (!valid) {
            const newAttempts = user.failed_attempts + 1;
            const lockDuration = getLockDuration(newAttempts);
            const lockedUntil = lockDuration > 0 ? Date.now() + lockDuration : 0;

            db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
                .run(newAttempts, lockedUntil, user.id);

            const response = { ok: false, error: FAIL_MSG };
            if (lockDuration > 0) {
                response.error = `登录失败次数过多，账户已锁定 ${Math.ceil(lockDuration / 60000)} 分钟`;
            }
            return res.status(401).json(response);
        }

        // Success — reset failed attempts
        db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?')
            .run(user.id);

        // Regenerate session to prevent fixation
        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regenerate error:', err);
                return res.status(500).json({ ok: false, error: '登录失败' });
            }
            req.session.userId = user.id;
            req.session.username = user.username;
            res.json({ ok: true, user: { username: user.username } });
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ ok: false, error: '登录失败' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ ok: false, error: '登出失败' });
        }
        res.clearCookie('__Host-sid');
        res.json({ ok: true });
    });
});

// GET /api/auth/status
router.get('/status', (req, res) => {
    if (req.session && req.session.userId) {
        const passkeyCount = db.prepare('SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?')
            .get(req.session.userId).count;
        return res.json({
            authenticated: true,
            username: req.session.username,
            passkeyRegistered: passkeyCount > 0
        });
    }
    res.status(401).json({ authenticated: false });
});

module.exports = router;
