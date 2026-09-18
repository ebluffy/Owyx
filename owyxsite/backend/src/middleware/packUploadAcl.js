/**
 * Gate /uploads/packs/* so catalog ACL (open/whitelist/blacklist) cannot be
 * bypassed via anonymous express.static. Prefer
 * GET /api/launcher/v1/packs/:id/download for new clients.
 */
const path = require('path');
const catalog = require('../routes/catalog');

const PACK_FILE_RE = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.(zip|mrpack)$/i;

async function packUploadAcl(req, res, next) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).json({ error: 'method not allowed' });
    }
    const base = path.basename(req.path || '');
    const match = PACK_FILE_RE.exec(base);
    if (!match) {
      return res.status(404).json({ error: 'pack not found' });
    }
    const packId = match[1].toLowerCase();
    const result = await require('../database/connection').query(
      `SELECT * FROM packs WHERE id = $1 AND published = true`,
      [packId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'pack not found' });
    }
    const allowed = await catalog.filterByAcl(req, result.rows, 'pack');
    if (!allowed[0]) {
      return res.status(404).json({ error: 'pack not found' });
    }
    return next();
  } catch (error) {
    console.error('packUploadAcl:', error);
    return res.status(500).json({ error: 'pack access check failed' });
  }
}

module.exports = { packUploadAcl, PACK_FILE_RE };
