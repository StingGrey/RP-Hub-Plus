'use strict';

const express = require('express');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// RP config — will be set from env
function getRpConfig() {
    const origin = process.env.RP_ORIGIN || 'http://localhost:3000';
    const url = new URL(origin);
    return {
        rpName: 'Roleplay Hub',
        rpID: url.hostname,
        origin: origin
    };
}

// POST /api/passkey/register/options — generate registration challenge (requires login)
router.post('/register/options', requireAuth, async (req, res) => {
    try {
        const { rpName, rpID } = getRpConfig();
        const userId = req.session.userId;
        const username = req.session.username;

        // Get existing passkeys to exclude
        const existingKeys = db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?')
            .all(userId);

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userName: username,
            userDisplayName: username,
            attestationType: 'none',
            excludeCredentials: existingKeys.map(k => ({
                id: k.credential_id,
                transports: k.transports ? JSON.parse(k.transports) : undefined
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred'
            }
        });

        // Store challenge in session
        req.session.passkeyChallenge = options.challenge;
        res.json(options);
    } catch (err) {
        console.error('Passkey register options error:', err);
        res.status(500).json({ ok: false, error: '生成注册选项失败' });
    }
});

// POST /api/passkey/register/verify — verify and save credential (requires login)
router.post('/register/verify', requireAuth, async (req, res) => {
    try {
        const { credential, name } = req.body;
        const { rpID, origin } = getRpConfig();
        const expectedChallenge = req.session.passkeyChallenge;

        if (!expectedChallenge) {
            return res.status(400).json({ ok: false, error: '无效的注册会话' });
        }

        const verification = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ ok: false, error: '注册验证失败' });
        }

        const { credential: cred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

        db.prepare(`
            INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            cred.id,
            req.session.userId,
            cred.id,
            Buffer.from(cred.publicKey),
            cred.counter,
            JSON.stringify(credential.response?.transports || []),
            name || `Passkey ${new Date().toLocaleDateString()}`
        );

        // Clear challenge
        delete req.session.passkeyChallenge;

        res.json({
            ok: true,
            passkey: {
                id: cred.id,
                name: name || `Passkey ${new Date().toLocaleDateString()}`,
                createdAt: Date.now()
            }
        });
    } catch (err) {
        console.error('Passkey register verify error:', err);
        res.status(500).json({ ok: false, error: '注册验证失败' });
    }
});

// POST /api/passkey/login/options — generate authentication challenge (no auth required)
router.post('/login/options', async (req, res) => {
    try {
        const { rpID } = getRpConfig();

        // Get all passkeys for allowCredentials
        const passkeys = db.prepare('SELECT credential_id, transports FROM passkeys').all();

        if (passkeys.length === 0) {
            return res.status(404).json({ ok: false, error: '未注册任何 Passkey' });
        }

        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials: passkeys.map(pk => ({
                id: pk.credential_id,
                transports: pk.transports ? JSON.parse(pk.transports) : undefined
            })),
            userVerification: 'preferred'
        });

        req.session.passkeyChallenge = options.challenge;
        res.json(options);
    } catch (err) {
        console.error('Passkey login options error:', err);
        res.status(500).json({ ok: false, error: '生成认证选项失败' });
    }
});

// POST /api/passkey/login/verify — verify authentication (no auth required)
router.post('/login/verify', async (req, res) => {
    try {
        const { credential } = req.body;
        const { rpID, origin } = getRpConfig();
        const expectedChallenge = req.session.passkeyChallenge;

        if (!expectedChallenge) {
            return res.status(400).json({ ok: false, error: '无效的认证会话' });
        }

        // Find the passkey
        const passkey = db.prepare('SELECT * FROM passkeys WHERE credential_id = ?')
            .get(credential.id);

        if (!passkey) {
            return res.status(400).json({ ok: false, error: '未知的 Passkey' });
        }

        const verification = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: passkey.credential_id,
                publicKey: passkey.public_key,
                counter: passkey.counter,
                transports: passkey.transports ? JSON.parse(passkey.transports) : undefined
            }
        });

        if (!verification.verified) {
            return res.status(401).json({ ok: false, error: '认证失败' });
        }

        // Update counter
        db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?')
            .run(verification.authenticationInfo.newCounter, passkey.id);

        // Get user info
        const user = db.prepare('SELECT id, username FROM users WHERE id = ?')
            .get(passkey.user_id);

        // Clear challenge and create session
        delete req.session.passkeyChallenge;

        // Reset any lockout on successful passkey login
        db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?')
            .run(user.id);

        req.session.regenerate((err) => {
            if (err) {
                return res.status(500).json({ ok: false, error: '登录失败' });
            }
            req.session.userId = user.id;
            req.session.username = user.username;
            res.json({ ok: true, user: { username: user.username } });
        });
    } catch (err) {
        console.error('Passkey login verify error:', err);
        res.status(500).json({ ok: false, error: '认证失败' });
    }
});

// GET /api/passkey/list — list registered passkeys (requires login)
router.get('/list', requireAuth, (req, res) => {
    const passkeys = db.prepare('SELECT id, name, created_at FROM passkeys WHERE user_id = ?')
        .all(req.session.userId);
    res.json({ passkeys });
});

// DELETE /api/passkey/:id — delete a passkey (requires login)
router.delete('/:id', requireAuth, (req, res) => {
    const result = db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.session.userId);
    if (result.changes === 0) {
        return res.status(404).json({ ok: false, error: 'Passkey 不存在' });
    }
    res.json({ ok: true });
});

module.exports = router;
