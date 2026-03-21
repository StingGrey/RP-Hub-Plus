'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const db = require('./db');
const { errorHandler } = require('./middleware');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const passkeyRoutes = require('./routes/passkey');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy (behind Caddy)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.tailwindcss.com",
                "https://unpkg.com",
                "https://cdn.jsdelivr.net"
            ],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "https:"],
            frameSrc: ["'self'", "https:", "blob:"],
            fontSrc: ["'self'", "https:", "data:"],
        }
    },
    crossOriginEmbedderPolicy: false
}));

// Compression
app.use(compression());

// Body parsing — 50MB limit for base64 avatars
app.use(express.json({ limit: '50mb' }));

// Session
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.sqlite',
        dir: path.join(__dirname, 'data'),
        concurrentDB: true
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    name: isProd ? '__Host-sid' : 'sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: isProd,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/'
    }
}));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/passkey', passkeyRoutes);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..'), {
    index: false,
    extensions: ['html']
}));

// SPA: serve index.html for all non-API routes
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Error handler
app.use(errorHandler);

// Start
app.listen(PORT, () => {
    console.log(`[RP-Hub Server] Running on port ${PORT} (${isProd ? 'production' : 'development'})`);
});
