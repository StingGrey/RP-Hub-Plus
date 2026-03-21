'use strict';

// Auth middleware: reject if not logged in
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ ok: false, error: '未登录' });
}

// Global error handler
function errorHandler(err, req, res, _next) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message || err);
    res.status(500).json({ ok: false, error: '服务器内部错误' });
}

module.exports = { requireAuth, errorHandler };
