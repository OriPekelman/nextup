/**
 * NextUp — a party queue server.
 *
 * Data model: one JSON file per "nextup" (e.g. data/wvgd.json) with:
 *   { slug, title, created, items: [...], currentIndex }
 *
 * Items are an ordered array. `currentIndex` points at the item currently
 * being shown (-1 = nothing shown yet). Items at index < currentIndex are
 * "already shown", the item at index > currentIndex are upcoming. The
 * "top of the queue" — the one contributors cannot displace — is the
 * item at index currentIndex + 1.
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- light-weight .env loader (no dependency) --------------------------------
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        let v = m[2];
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
} catch (_) { /* ignore */ }

const PORT = parseInt(process.env.PORT, 10) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const APP_NAME = process.env.APP_NAME || 'NextUp';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIEWS_DIR = path.join(__dirname, 'views');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// --- helpers ---------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const RESERVED = new Set(['api', 'static', 'uploads', 'favicon.ico', 'robots.txt']);

function safeSlug(slug) {
  if (typeof slug !== 'string') return null;
  slug = slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  if (RESERVED.has(slug)) return null;
  return slug;
}

function dataPath(slug) {
  return path.join(DATA_DIR, `${slug}.json`);
}

function load(slug) {
  const s = safeSlug(slug);
  if (!s) return null;
  const p = dataPath(s);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function save(slug, data) {
  const s = safeSlug(slug);
  if (!s) return false;
  const tmp = dataPath(s) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dataPath(s));
  return true;
}

function detectType(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      return 'youtube';
    }
    return 'url';
  } catch (_) {
    return 'url';
  }
}

function youTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:embed|shorts)\/([^/?#]+)/);
    if (m) return m[1];
  } catch (_) {}
  return null;
}

function newId() { return crypto.randomBytes(6).toString('hex'); }

function publicItem(item) {
  // what we expose to clients; currently identical to stored shape
  return item;
}

function publicState(data) {
  return {
    slug: data.slug,
    title: data.title,
    created: data.created,
    currentIndex: data.currentIndex,
    items: data.items.map(publicItem)
  };
}

// --- multer (image uploads) -------------------------------------------------

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const slug = safeSlug(req.params.slug);
      if (!slug) return cb(new Error('bad slug'));
      const dir = path.join(UPLOADS_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, newId() + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(req, file, cb) {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('only images allowed'));
    // SVG can carry scripts, and uploads are served from the app's own origin
    if (/svg/i.test(file.mimetype) || /\.svgz?$/i.test(file.originalname)) return cb(new Error('SVG not allowed'));
    cb(null, true);
  }
});

// --- routes: API ------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({ baseUrl: BASE_URL, appName: APP_NAME });
});

app.post('/api/create', (req, res) => {
  let { slug, title } = req.body || {};
  slug = (slug || '').trim().toLowerCase();
  if (!slug) {
    // generate a memorable-ish random slug
    slug = crypto.randomBytes(3).toString('hex'); // 6 hex chars
  }
  const s = safeSlug(slug);
  if (!s) return res.status(400).json({ error: 'Invalid slug. Use 2–32 lowercase letters, digits or dashes; must start with a letter or digit.' });
  if (fs.existsSync(dataPath(s))) return res.status(409).json({ error: 'That nextup already exists.' });
  const data = {
    slug: s,
    title: (title || '').trim() || s,
    created: new Date().toISOString(),
    items: [],
    currentIndex: -1
  };
  save(s, data);
  res.json({ slug: s, title: data.title });
});

app.get('/api/:slug', (req, res) => {
  const data = load(req.params.slug);
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(publicState(data));
});

// Add an item.
// Accepts multipart/form-data (for images) OR application/json (text/url/youtube).
app.post('/api/:slug/items', (req, res, next) => {
  // Decide whether to run multer based on content-type
  if (req.is('multipart/form-data')) return upload.single('file')(req, res, next);
  next();
}, (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug) return res.status(400).json({ error: 'bad slug' });
  const data = load(slug);
  if (!data) return res.status(404).json({ error: 'not found' });

  const body = req.body || {};
  let type = (body.type || '').trim();
  const contributor = (body.contributor || '').toString().trim().slice(0, 80) || null;
  const caption = (body.caption || '').toString().trim().slice(0, 280) || null;

  // position = desired index in the array. Default: end (LILO).
  let position = parseInt(body.position, 10);
  if (isNaN(position)) position = data.items.length;

  // Minimum allowed position:
  //   currentIndex + 1 is the "top of upcoming" — can't be displaced.
  //   so newly added items must land at (currentIndex + 2) or later.
  //   Exception: if there is currently no upcoming item at all, the first
  //   contribution obviously lands in the top slot — that's fine, nothing to
  //   displace.
  const upcomingStart = data.currentIndex + 1;
  const hasUpcoming = upcomingStart < data.items.length;
  const minPos = hasUpcoming ? (upcomingStart + 1) : upcomingStart;
  const maxPos = data.items.length;
  position = Math.max(minPos, Math.min(position, maxPos));

  let content = null;
  if (type === 'image' || req.file) {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    type = 'image';
    content = `/uploads/${slug}/${req.file.filename}`;
  } else if (type === 'text') {
    content = (body.content || '').toString();
    if (!content.trim()) return res.status(400).json({ error: 'Text is empty.' });
    if (content.length > 10000) content = content.slice(0, 10000);
  } else if (type === 'url' || type === 'youtube' || type === 'link') {
    const raw = (body.content || '').toString().trim();
    if (!raw) return res.status(400).json({ error: 'URL is empty.' });
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch (_) { return res.status(400).json({ error: 'Invalid URL.' }); }
    type = detectType(url);
    content = url;
  } else {
    return res.status(400).json({ error: 'Unknown item type.' });
  }

  const item = {
    id: newId(),
    type,
    content,
    caption,
    contributor,
    added: new Date().toISOString(),
    shown: false,
    shownAt: null
  };
  data.items.splice(position, 0, item);
  save(slug, data);
  res.json({ item: publicItem(item), position, state: publicState(data) });
});

// Move an item up/down (manage interface only). You cannot move the
// currently-showing item, and you cannot move anything into position
// currentIndex+1 if something already sits there (that's the untouchable
// top of upcoming). We enforce: target index must be > currentIndex.
app.post('/api/:slug/items/:id/move', (req, res) => {
  const data = load(req.params.slug);
  if (!data) return res.status(404).json({ error: 'not found' });
  const { id } = req.params;
  const dir = req.body && req.body.direction;
  const idx = data.items.findIndex(it => it.id === id);
  if (idx === -1) return res.status(404).json({ error: 'item not found' });
  // Can't move already-shown items, can't move the currently-showing item.
  if (idx <= data.currentIndex) return res.status(400).json({ error: "Can't move an item that's already shown." });

  let target = idx;
  if (dir === 'up') target = idx - 1;
  else if (dir === 'down') target = idx + 1;
  else return res.status(400).json({ error: 'direction must be up or down' });

  if (target < 0 || target >= data.items.length) {
    return res.json({ state: publicState(data) });
  }
  // Target must still be beyond currentIndex.
  if (target <= data.currentIndex) {
    return res.status(400).json({ error: "Can't move past already-shown items." });
  }
  // Swap
  [data.items[idx], data.items[target]] = [data.items[target], data.items[idx]];
  save(req.params.slug, data);
  res.json({ state: publicState(data) });
});

app.delete('/api/:slug/items/:id', (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug) return res.status(400).json({ error: 'bad slug' });
  const data = load(slug);
  if (!data) return res.status(404).json({ error: 'not found' });
  const idx = data.items.findIndex(it => it.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'item not found' });

  const [removed] = data.items.splice(idx, 1);
  if (removed.type === 'image' && typeof removed.content === 'string' && removed.content.startsWith('/uploads/')) {
    const file = path.join(__dirname, removed.content);
    if (file.startsWith(UPLOADS_DIR) && fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
  }
  // Keep currentIndex pointing at the same logical item.
  if (idx <= data.currentIndex) data.currentIndex -= 1;

  save(slug, data);
  res.json({ state: publicState(data) });
});

// Show controls: advance / rewind the current pointer.
app.post('/api/:slug/show/next', (req, res) => {
  const data = load(req.params.slug);
  if (!data) return res.status(404).json({ error: 'not found' });
  if (data.currentIndex < data.items.length - 1) {
    data.currentIndex += 1;
    const it = data.items[data.currentIndex];
    if (it && !it.shown) {
      it.shown = true;
      it.shownAt = new Date().toISOString();
    }
    save(req.params.slug, data);
  }
  res.json(publicState(data));
});

app.post('/api/:slug/show/prev', (req, res) => {
  const data = load(req.params.slug);
  if (!data) return res.status(404).json({ error: 'not found' });
  if (data.currentIndex >= 0) {
    data.currentIndex -= 1;
    save(req.params.slug, data);
  }
  res.json(publicState(data));
});

// --- routes: HTML views ----------------------------------------------------

app.get('/', (req, res) => res.sendFile(path.join(VIEWS_DIR, 'index.html')));

app.get('/:slug', (req, res, next) => {
  const slug = safeSlug(req.params.slug);
  if (!slug) return next();
  if (!fs.existsSync(dataPath(slug))) return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  res.sendFile(path.join(VIEWS_DIR, 'upload.html'));
});

app.get('/:slug/manage', (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug || !fs.existsSync(dataPath(slug))) return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  res.sendFile(path.join(VIEWS_DIR, 'manage.html'));
});

app.get('/:slug/show', (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug || !fs.existsSync(dataPath(slug))) return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  res.sendFile(path.join(VIEWS_DIR, 'show.html'));
});

// --- error handler ---------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on ${BASE_URL}  (port ${PORT})`);
});
