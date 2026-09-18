const express = require('express');
const router = express.Router();
const {
    authenticateToken,
    requireRole
} = require('./auth');
const db = require('../database/connection');

const KEY_RE = /^[a-z0-9_-]+$/i;

function sanitizeKey(key) {
    const k = String(key || '').trim().toLowerCase();
    if (!k || k.length > 100 || !KEY_RE.test(k)) return null;
    return k;
}

function serializeValue(value) {
    if (value === undefined) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function parseStoredValue(raw) {
    if (raw == null) return raw;
    if (typeof raw !== 'string') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** Flatten nested settings into sanitized DB keys: server.name → server_name */
function flattenSettings(obj, prefix = '', out = {}) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    for (const [k, v] of Object.entries(obj)) {
        const part = sanitizeKey(k);
        if (!part) continue;
        const key = prefix ? `${prefix}_${part}` : part;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            flattenSettings(v, key, out);
        } else {
            out[key] = v;
        }
    }
    return out;
}

/** Apply flat keys like server_name back onto defaults.server.name when possible */
function applyFlatOverrides(defaults, flat) {
    const result = JSON.parse(JSON.stringify(defaults));
    for (const [key, raw] of Object.entries(flat)) {
        const value = parseStoredValue(raw);
        const parts = key.split('_');
        if (parts.length >= 2 && result[parts[0]] && typeof result[parts[0]] === 'object') {
            let cursor = result[parts[0]];
            for (let i = 1; i < parts.length - 1; i++) {
                if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') {
                    cursor[parts[i]] = {};
                }
                cursor = cursor[parts[i]];
            }
            cursor[parts[parts.length - 1]] = value;
        } else {
            result[key] = value;
        }
    }
    return result;
}

async function loadDbOverrides() {
    const result = await db.query(
        `SELECT setting_key, setting_value FROM server_settings
         WHERE category = 'config' OR setting_key LIKE 'server_%'
            OR setting_key LIKE 'applications_%'
            OR setting_key LIKE 'security_%'
            OR setting_key LIKE 'email_%'`
    );
    const flat = {};
    for (const row of result.rows) {
        const key = sanitizeKey(row.setting_key);
        if (key) flat[key] = row.setting_value;
    }
    return flat;
}

// Public site settings — no game-server IP (product is site + launcher).
router.get('/settings/public', async (req, res) => {
    try {
        const result = await db.query('SELECT setting_key, setting_value FROM server_settings');
        const settings = {};
        result.rows.forEach((row) => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json({
            siteName: settings['server-name'] || 'Owyx',
            siteDescription: settings['server-description'] || null,
            discordInvite: settings['discord-invite'] || null,
            telegramInvite: settings['telegram-invite'] || null,
        });
    } catch (error) {
        console.error('Ошибка получения публичных настроек:', error);
        res.json({
            siteName: 'Owyx',
            siteDescription: null,
            discordInvite: null,
            telegramInvite: null,
        });
    }
});

router.get('/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const defaults = require('../config/settings');
        const flat = await loadDbOverrides();
        const settings = applyFlatOverrides(defaults, flat);

        res.json({
            success: true,
            settings: {
                server: settings.server,
                applications: settings.applications,
                security: settings.security,
                email: settings.email
            }
        });
    } catch (error) {
        console.error('Ошибка получения настроек:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление настроек — persist to server_settings (never rewrite settings.js)
router.post('/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { settings } = req.body;

        if (!settings) {
            return res.status(400).json({ error: 'Настройки не предоставлены' });
        }

        const flat = flattenSettings(settings);
        const keys = Object.keys(flat);
        if (keys.length === 0) {
            return res.status(400).json({ error: 'Нет допустимых ключей настроек' });
        }

        for (const [key, value] of Object.entries(flat)) {
            const serialized = serializeValue(value);
            if (serialized == null) continue;
            const settingType =
                typeof value === 'boolean' ? 'boolean' :
                typeof value === 'number' ? 'integer' : 'string';

            await db.query(
                `INSERT INTO server_settings (setting_key, setting_value, setting_type, category, description, updated_by)
                 VALUES ($1, $2, $3, 'config', $4, $5)
                 ON CONFLICT (setting_key)
                 DO UPDATE SET
                    setting_value = EXCLUDED.setting_value,
                    setting_type = EXCLUDED.setting_type,
                    category = 'config',
                    updated_at = CURRENT_TIMESTAMP,
                    updated_by = EXCLUDED.updated_by`,
                [key, serialized, settingType, `config override: ${key}`, req.user.id]
            );
        }

        await db.query(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [req.user.id, 'settings_update', `Обновлены настройки сервера (${keys.length} ключей)`]
        );

        res.json({
            success: true,
            message: 'Настройки успешно обновлены'
        });

    } catch (error) {
        console.error('Ошибка обновления настроек:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Сброс настроек к значениям по умолчанию — clear DB overrides (do not rewrite settings.js)
router.post('/settings/reset', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { section } = req.body;

        if (section && typeof section === 'string') {
            const prefix = sanitizeKey(section);
            if (prefix) {
                await db.query(
                    `DELETE FROM server_settings
                     WHERE category = 'config' AND setting_key LIKE $1`,
                    [`${prefix}_%`]
                );
            }
        } else {
            await db.query(`DELETE FROM server_settings WHERE category = 'config'`);
        }

        await db.query(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [req.user.id, 'settings_reset', `Сброшена секция настроек: ${section || 'all'}`]
        );

        res.json({
            success: true,
            message: 'Настройки сброшены к значениям по умолчанию'
        });

    } catch (error) {
        console.error('Ошибка сброса настроек:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

const pluginGone = (_req, res) => {
    res.status(410).json({
        error: 'gone',
        message: 'Minecraft plugin APIs are retired. Use the Owyx launcher and site account.'
    });
};
router.get('/settings/server-info', pluginGone);
router.get('/plugin/server-info', pluginGone);
router.get('/plugin/server-access', pluginGone);
router.post('/settings/server-data', pluginGone);

module.exports = router;
