const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app         = express();
const PORT        = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, 'data', 'properties.json');
const BOOKINGS_FILE = path.join(__dirname, 'data', 'bookings.json');
const UPLOADS_DIR   = path.join(__dirname, 'uploads');

// ── middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(__dirname));           // serves support.js and other assets
app.use('/uploads', express.static(UPLOADS_DIR));

// ── homepage ──────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'Fynix Dashboard.dc.html'));
});

// ── multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file,  cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});
const fileFilter = (_req, file, cb) => {
  const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
  cb(ok ? null : new Error('Invalid file type'), ok);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }
});

// ── helpers ───────────────────────────────────────────────────────────────────
function readProps() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function writeProps(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function fullUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}
function deleteFile(filename) {
  try { fs.unlinkSync(path.join(UPLOADS_DIR, filename)); } catch {}
}

function readBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8')); }
  catch { return []; }
}
function writeBookings(data) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Convert stored features string ("one\ntwo") to a clean array for AI consumers
function featuresToArray(str) {
  if (!str) return [];
  return String(str).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

// Format a single property for the /api/ai/* endpoints:
//   - full absolute image URLs
//   - features as array
function aiFormat(p, req) {
  return {
    ...p,
    images:   (p.images || []).map(url =>
                url.startsWith('http') ? url : fullUrl(req, path.basename(url))),
    features: featuresToArray(p.features)
  };
}

// ── GET /api/properties ───────────────────────────────────────────────────────
app.get('/api/properties', (req, res) => {
  res.json(readProps());
});

// ── GET /api/properties/:id ───────────────────────────────────────────────────
app.get('/api/properties/:id', (req, res) => {
  const prop = readProps().find(p => p.id === req.params.id);
  if (!prop) return res.status(404).json({ error: 'Not found' });
  res.json(prop);
});

// ── POST /api/properties ──────────────────────────────────────────────────────
app.post('/api/properties', (req, res) => {
  const props = readProps();
  const now   = new Date().toISOString();
  const prop  = {
    id:          'p' + Date.now(),
    title:       req.body.title       || 'عقار بدون عنوان',
    offer:       req.body.offer       || 'بيع',
    type:        req.body.type        || 'شقة',
    ref:         req.body.ref         || '',
    status:      req.body.status      || 'متاح',
    city:        req.body.city        || '',
    district:    req.body.district    || '',
    address:     req.body.address     || '',
    lat:         req.body.lat         || '',
    lng:         req.body.lng         || '',
    price:       Number(req.body.price)   || 0,
    currency:    req.body.currency    || 'SAR',
    area:        req.body.area        || '',
    beds:        Number(req.body.beds)    || 0,
    baths:       Number(req.body.baths)   || 0,
    parking:     Number(req.body.parking) || 0,
    description: req.body.description || '',
    features:    req.body.features    || '',
    images:      Array.isArray(req.body.images) ? req.body.images : [],
    phone:       req.body.phone       || '',
    furnished:   !!req.body.furnished,
    published:   req.body.published !== undefined ? !!req.body.published : true,
    featured:    !!req.body.featured,
    createdAt:   now,
    updatedAt:   now
  };
  props.unshift(prop);
  writeProps(props);
  res.status(201).json(prop);
});

// ── PUT /api/properties/:id ───────────────────────────────────────────────────
app.put('/api/properties/:id', (req, res) => {
  const props = readProps();
  const idx   = props.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const now  = new Date().toISOString();
  const prev = props[idx];
  props[idx] = {
    id:          prev.id,
    title:       req.body.title       !== undefined ? req.body.title       : prev.title,
    offer:       req.body.offer       !== undefined ? req.body.offer       : prev.offer,
    type:        req.body.type        !== undefined ? req.body.type        : prev.type,
    ref:         req.body.ref         !== undefined ? req.body.ref         : prev.ref,
    status:      req.body.status      !== undefined ? req.body.status      : prev.status,
    city:        req.body.city        !== undefined ? req.body.city        : prev.city,
    district:    req.body.district    !== undefined ? req.body.district    : prev.district,
    address:     req.body.address     !== undefined ? req.body.address     : prev.address,
    lat:         req.body.lat         !== undefined ? req.body.lat         : prev.lat,
    lng:         req.body.lng         !== undefined ? req.body.lng         : prev.lng,
    price:       req.body.price       !== undefined ? Number(req.body.price)   : prev.price,
    currency:    req.body.currency    !== undefined ? req.body.currency    : prev.currency,
    area:        req.body.area        !== undefined ? req.body.area        : prev.area,
    beds:        req.body.beds        !== undefined ? Number(req.body.beds)    : prev.beds,
    baths:       req.body.baths       !== undefined ? Number(req.body.baths)   : prev.baths,
    parking:     req.body.parking     !== undefined ? Number(req.body.parking) : prev.parking,
    description: req.body.description !== undefined ? req.body.description : prev.description,
    features:    req.body.features    !== undefined ? req.body.features    : prev.features,
    images:      Array.isArray(req.body.images)     ? req.body.images      : prev.images,
    phone:       req.body.phone       !== undefined ? req.body.phone       : prev.phone,
    furnished:   req.body.furnished   !== undefined ? !!req.body.furnished : prev.furnished,
    published:   req.body.published   !== undefined ? !!req.body.published : prev.published,
    featured:    req.body.featured    !== undefined ? !!req.body.featured  : prev.featured,
    createdAt:   prev.createdAt,
    updatedAt:   now
  };
  writeProps(props);
  res.json(props[idx]);
});

// ── DELETE /api/properties/:id ────────────────────────────────────────────────
app.delete('/api/properties/:id', (req, res) => {
  const props = readProps();
  const prop  = props.find(p => p.id === req.params.id);
  if (!prop) return res.status(404).json({ error: 'Not found' });
  // delete associated image files
  (prop.images || []).forEach(url => {
    const filename = path.basename(url);
    deleteFile(filename);
  });
  writeProps(props.filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

// ── POST /api/upload ──────────────────────────────────────────────────────────
app.post('/api/upload', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'No files uploaded' });
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

// ── DELETE /api/upload/:filename ──────────────────────────────────────────────
app.delete('/api/upload/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // strip any path traversal
  deleteFile(filename);
  res.json({ ok: true });
});

// ── GET /api/search ───────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json(readProps());
  const results = readProps().filter(p =>
    [p.title, p.city, p.district, p.type, p.ref, p.address, p.description]
      .join(' ').toLowerCase().includes(q)
  );
  res.json(results);
});

// ── GET /api/ai/properties ────────────────────────────────────────────────────
// Supports query filters: offer, type, status, city, minPrice, maxPrice, beds, baths
app.get('/api/ai/properties', (req, res) => {
  const { offer, type, status, city, minPrice, maxPrice, beds, baths } = req.query;
  let props = readProps();

  if (offer)    props = props.filter(p => p.offer  === offer);
  if (type)     props = props.filter(p => p.type   === type);
  if (status)   props = props.filter(p => p.status === status);
  if (city)     props = props.filter(p => (p.city  || '').toLowerCase().includes(city.toLowerCase()));
  if (minPrice) props = props.filter(p => p.price >= Number(minPrice));
  if (maxPrice) props = props.filter(p => p.price <= Number(maxPrice));
  if (beds)     props = props.filter(p => p.beds  >= Number(beds));
  if (baths)    props = props.filter(p => p.baths >= Number(baths));

  res.json(props.map(p => aiFormat(p, req)));
});

// ── GET /api/ai/properties/:id ────────────────────────────────────────────────
app.get('/api/ai/properties/:id', (req, res) => {
  const prop = readProps().find(p => p.id === req.params.id);
  if (!prop) return res.status(404).json({ error: 'Not found' });
  res.json(aiFormat(prop, req));
});

// ── GET /api/bookings ─────────────────────────────────────────────────────────
app.get('/api/bookings', (_req, res) => res.json(readBookings()));

// ── POST /api/bookings ────────────────────────────────────────────────────────
app.post('/api/bookings', (req, res) => {
  const list = readBookings();
  const now  = new Date().toISOString();
  const b = {
    id:            'b' + Date.now(),
    propertyId:    req.body.propertyId    || '',
    propertyTitle: req.body.propertyTitle || '',
    clientName:    req.body.clientName    || '',
    clientPhone:   req.body.clientPhone   || '',
    assignedTo:    req.body.assignedTo    || '',
    startTime:     req.body.startTime     || now,
    endTime:       req.body.endTime       || '',
    status:        req.body.status        || 'مجدولة',
    location:      req.body.location      || '',
    notes:         req.body.notes         || '',
    createdAt: now, updatedAt: now
  };
  list.unshift(b);
  writeBookings(list);
  res.status(201).json(b);
});

// ── PUT /api/bookings/:id ─────────────────────────────────────────────────────
app.put('/api/bookings/:id', (req, res) => {
  const list = readBookings();
  const idx  = list.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const now = new Date().toISOString(), p = list[idx];
  list[idx] = {
    id:            p.id,
    propertyId:    req.body.propertyId    !== undefined ? req.body.propertyId    : p.propertyId,
    propertyTitle: req.body.propertyTitle !== undefined ? req.body.propertyTitle : p.propertyTitle,
    clientName:    req.body.clientName    !== undefined ? req.body.clientName    : p.clientName,
    clientPhone:   req.body.clientPhone   !== undefined ? req.body.clientPhone   : p.clientPhone,
    assignedTo:    req.body.assignedTo    !== undefined ? req.body.assignedTo    : p.assignedTo,
    startTime:     req.body.startTime     !== undefined ? req.body.startTime     : p.startTime,
    endTime:       req.body.endTime       !== undefined ? req.body.endTime       : p.endTime,
    status:        req.body.status        !== undefined ? req.body.status        : p.status,
    location:      req.body.location      !== undefined ? req.body.location      : p.location,
    notes:         req.body.notes         !== undefined ? req.body.notes         : p.notes,
    createdAt: p.createdAt, updatedAt: now
  };
  writeBookings(list);
  res.json(list[idx]);
});

// ── DELETE /api/bookings/:id ──────────────────────────────────────────────────
app.delete('/api/bookings/:id', (req, res) => {
  const list = readBookings();
  if (!list.find(b => b.id === req.params.id))
    return res.status(404).json({ error: 'Not found' });
  writeBookings(list.filter(b => b.id !== req.params.id));
  res.json({ ok: true });
});

// ── GET /api/ai/bookings ──────────────────────────────────────────────────────
app.get('/api/ai/bookings', (_req, res) => res.json(readBookings()));

// ── GET /api/ai/summary ───────────────────────────────────────────────────────
app.get('/api/ai/summary', (req, res) => {
  const props = readProps();

  const byStatus = {};
  const byOffer  = {};
  const byCity   = {};
  const byType   = {};

  props.forEach(p => {
    byStatus[p.status || 'غير محدد'] = (byStatus[p.status || 'غير محدد'] || 0) + 1;
    byOffer [p.offer  || 'غير محدد'] = (byOffer [p.offer  || 'غير محدد'] || 0) + 1;
    byCity  [p.city   || 'غير محدد'] = (byCity  [p.city   || 'غير محدد'] || 0) + 1;
    byType  [p.type   || 'غير محدد'] = (byType  [p.type   || 'غير محدد'] || 0) + 1;
  });

  const totalValue = props.reduce((sum, p) => sum + (p.price || 0), 0);

  res.json({
    total:      props.length,
    totalValue,
    byStatus,
    byOffer,
    byCity,
    byType,
    published:  props.filter(p => p.published).length,
    featured:   props.filter(p => p.featured).length,
    furnished:  props.filter(p => p.furnished).length,
    withImages: props.filter(p => p.images && p.images.length > 0).length
  });
});

// ── start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Fynix server running → http://localhost:${PORT}`);
});
