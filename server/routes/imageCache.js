'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
const CACHE_DIR = path.join(__dirname, '..', 'data', 'image-cache');
const DEFAULT_TOKEN = 'STD-QMqT4lxiWqWMVneiePiE';
const DEFAULT_MODEL = 'nai-diffusion-4-5-full';
const DEFAULT_ARTISTS = '[[[artist:dishwasher1910]]], {{yd_(orange_maru)}}, [artist:ciloranko], [artist:sho_(sho_lwlw)], [ningen mame], year 2024,';
const R18_ARTISTS = '{{artist:yd_(orange maru)}}, nixeu, {ikuchan kaoru}, cutesexyrobutts, redrop, [[artist:kojima saya]], lam_(ramdayo), oekakizuki, qiandaiyiyu,';
const DEFAULT_NEGATIVE = '{{{{bad anatomy}}}},{bad feet},bad hands,{{{bad proportions}}},{blurry},cloned face,cropped,{{{deformed}}},{{{disfigured}}},error,{{{extra arms}}},{extra digit},{{{extra legs}}},extra limbs,{{extra limbs}},{fewer digits},{{{fused fingers}}},gross proportions,ink eyes,ink hair,jpeg artifacts,{{{{long neck}}}},low quality,{malformed limbs},{{missing arms}},{missing fingers},{{missing legs}},{{{more than 2 nipples}}},mutated hands,{{{mutation}}},normal quality,owres,{{poorly drawn face}},{{poorly drawn hands}},reen eyes,signature,text,{{too many fingers}},{{{ugly}}},username,uta,watermark,worst quality,{{{more than 2 legs}}}';
const inflight = new Map();

fs.mkdirSync(CACHE_DIR, { recursive: true });

router.use(requireAuth);

function readSettings() {
    try {
        const row = db.prepare('SELECT value FROM data_store WHERE key = ?').get('silly_tavern_settings');
        if (!row) return {};
        return JSON.parse(row.value) || {};
    } catch (_) {
        return {};
    }
}

function normalizeString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function buildSpec(prompt, overrides = {}) {
    const settings = readSettings();
    const imageStyle = normalizeString(overrides.imageStyle, normalizeString(settings.imageStyle, 'default'));
    const imageSize = normalizeString(overrides.imageSize, normalizeString(settings.imageSize, '竖图'));
    const imageGenKey = normalizeString(overrides.imageGenKey, normalizeString(settings.imageGenKey, DEFAULT_TOKEN));
    const artists = imageStyle === 'r18' ? R18_ARTISTS : DEFAULT_ARTISTS;

    return {
        prompt,
        imageStyle,
        imageSize,
        imageGenKey,
        artists,
        model: DEFAULT_MODEL,
        steps: '40',
        scale: '6',
        cfg: '0',
        sampler: 'k_dpmpp_2m_sde',
        negative: DEFAULT_NEGATIVE,
        nocache: '0',
        noiseSchedule: 'karras'
    };
}

function buildCacheKey(spec) {
    const stable = {
        prompt: spec.prompt,
        imageStyle: spec.imageStyle,
        imageSize: spec.imageSize,
        artists: spec.artists,
        model: spec.model,
        steps: spec.steps,
        scale: spec.scale,
        cfg: spec.cfg,
        sampler: spec.sampler,
        negative: spec.negative,
        nocache: spec.nocache,
        noiseSchedule: spec.noiseSchedule
    };
    return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}

function buildUpstreamUrl(spec) {
    const url = new URL('https://std.loliyc.com/generate');
    url.searchParams.set('tag', spec.prompt);
    url.searchParams.set('token', spec.imageGenKey);
    url.searchParams.set('model', spec.model);
    url.searchParams.set('artist', spec.artists);
    url.searchParams.set('size', spec.imageSize);
    url.searchParams.set('steps', spec.steps);
    url.searchParams.set('scale', spec.scale);
    url.searchParams.set('cfg', spec.cfg);
    url.searchParams.set('sampler', spec.sampler);
    url.searchParams.set('negative', spec.negative);
    url.searchParams.set('nocache', spec.nocache);
    url.searchParams.set('noise_schedule', spec.noiseSchedule);
    return url.toString();
}

function getImagePath(key) {
    return path.join(CACHE_DIR, `${key}.png`);
}

function getMetaPath(key) {
    return path.join(CACHE_DIR, `${key}.json`);
}

async function fetchToCache(spec, key) {
    const imagePath = getImagePath(key);
    if (fs.existsSync(imagePath)) return imagePath;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const tempPath = path.join(CACHE_DIR, `${key}.tmp`);

    try {
        const response = await fetch(buildUpstreamUrl(spec), {
            signal: controller.signal,
            headers: { 'User-Agent': 'RPHub/1.0' }
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`上游返回 ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            const text = await response.text().catch(() => '');
            throw new Error(`上游未返回图片 (${contentType || 'unknown'})${text ? `: ${text.slice(0, 300)}` : ''}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tempPath, buffer);
        fs.renameSync(tempPath, imagePath);
        fs.writeFileSync(getMetaPath(key), JSON.stringify({
            cachedAt: Date.now(),
            prompt: spec.prompt,
            imageStyle: spec.imageStyle,
            imageSize: spec.imageSize,
            model: spec.model,
            contentType
        }, null, 2));

        return imagePath;
    } finally {
        clearTimeout(timeout);
        if (fs.existsSync(tempPath)) {
            fs.rmSync(tempPath, { force: true });
        }
    }
}

async function ensureImage(prompt, overrides = {}) {
    const cleanPrompt = normalizeString(prompt);
    if (!cleanPrompt) {
        throw new Error('缺少 prompt');
    }

    const spec = buildSpec(cleanPrompt, overrides);
    const key = buildCacheKey(spec);
    const imagePath = getImagePath(key);

    if (!fs.existsSync(imagePath)) {
        if (!inflight.has(key)) {
            inflight.set(key, fetchToCache(spec, key).finally(() => inflight.delete(key)));
        }
        await inflight.get(key);
    }

    return { key, imagePath };
}

router.get('/file/:key.png', (req, res) => {
    const key = String(req.params.key || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(key)) {
        return res.status(400).json({ ok: false, error: 'invalid key' });
    }

    const imagePath = getImagePath(key);
    if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ ok: false, error: 'not found' });
    }

    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('png');
    res.sendFile(imagePath);
});

router.get('/render', async (req, res, next) => {
    try {
        const prompt = normalizeString(req.query.prompt);
        if (!prompt) {
            return res.status(400).json({ ok: false, error: 'missing prompt' });
        }

        const { imagePath } = await ensureImage(prompt);
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.type('png');
        res.sendFile(imagePath);
    } catch (err) {
        next(err);
    }
});

router.post('/ensure-bulk', async (req, res, next) => {
    try {
        const prompts = Array.isArray(req.body?.prompts) ? req.body.prompts : null;
        if (!prompts) {
            return res.status(400).json({ ok: false, error: 'prompts must be an array' });
        }
        if (prompts.length > 12) {
            return res.status(400).json({ ok: false, error: 'too many prompts' });
        }

        const overrides = {
            imageStyle: normalizeString(req.body?.imageStyle),
            imageSize: normalizeString(req.body?.imageSize),
            imageGenKey: normalizeString(req.body?.imageGenKey)
        };

        const items = [];
        for (const prompt of prompts) {
            const cleanPrompt = normalizeString(prompt);
            if (!cleanPrompt) continue;
            const { key } = await ensureImage(cleanPrompt, overrides);
            items.push({ prompt: cleanPrompt, key, url: `${req.baseUrl}/file/${key}.png` });
        }

        res.json({ ok: true, items });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
