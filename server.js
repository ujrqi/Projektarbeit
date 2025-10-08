// server.js
// OIDC Login-Flow mit PKCE, Discovery, ID-Token-Validierung & Session

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const fetch = require('node-fetch'); // v2 (CommonJS)

const app = express();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI = 'http://localhost:3001/callback',
  ISSUER_BASE_URL = 'https://oidc.scc.kit.edu/auth/realms/kit',
  SESSION_SECRET,
  SCOPES = 'openid profile email',
  NODE_ENV = 'development',
  PORT = 3001,
  FRONTEND_ORIGIN = 'http://localhost:3000'
} = process.env;

if (!CLIENT_ID || !ISSUER_BASE_URL || !SESSION_SECRET) {
  console.warn('[WARN] Bitte CLIENT_ID, ISSUER_BASE_URL, SESSION_SECRET in .env setzen.');
}

// --- Helpers ---
const isProd = NODE_ENV === 'production';
if (isProd) {
  // nur in Produktion hinter Proxy/Ingress (für secure-Cookies)
  app.set('trust proxy', 1);
}

// Base64URL-Encode Helper (kompatibel)
function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Discovery cachen
let oidcMeta = null;
async function getOidcMeta() {
  if (oidcMeta) return oidcMeta;
  const wellKnown = `${ISSUER_BASE_URL.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const r = await fetch(wellKnown);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OIDC Discovery fehlgeschlagen (${r.status}): ${t}`);
  }
  oidcMeta = await r.json();
  return oidcMeta;
}

//Device API Auth & Utilities

const DEVICE_KEYS = (process.env.DEVICE_API_KEYS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function requireDeviceAuth(req, res, next) {
  // Einfache Bearer-Auth
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const key = m ? m[1] : null;
  if (!key || !DEVICE_KEYS.includes(key)) {
    return res.status(401).json({ error: 'Unauthorized device' });
  }
  next();
}

// „Ziel-User“ für das Board bestimmen (solange es keine DB/Zuordnung gibt)
function getBoardStore() {
  const sub = process.env.BOARD_USER_SUB || 'anon';
  if (!userStores.has(sub)) {
    userStores.set(sub, {
      people: [
        { name: '', role: '' },
        { name: '', role: '' },
        { name: '', role: '' }
      ],
      eventsByDate: {}
    });
  }
  return userStores.get(sub);
}

// YYYY-MM-DD in Europe/Berlin
function todayYMD(tz = 'Europe/Berlin') {
  const d = new Date();
  // lokale Komponenten holen
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  // de-DE liefert TT.MM.JJJJ → wir brauchen YYYY-MM-DD
  return `${map.year}-${map.month}-${map.day}`;
}

// ETag berechnen (stabil, klein)
function etagFor(obj) {
  const json = JSON.stringify(obj);
  return crypto.createHash('sha1').update(json).digest('hex');
}

// --- Middleware ---
app.use(cors({
  origin: FRONTEND_ORIGIN, // wichtig: exakt der Origin, kein "*"
  credentials: true
}));

app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd // in Prod nur über HTTPS
  }
}));

console.log('[BOOT]', {
  NODE_ENV,
  FRONTEND_ORIGIN,
  cookie: { sameSite: 'lax', secure: isProd }
});

// --- In-Memory "DB" pro Benutzer (sub) ---
const userStores = new Map(); // key = sub, value = { people: [...], events: [...] }

function ensureStoreFor(req, res) {
  if (!req.session.user) {
    res.status(401).json({ error: 'Nicht eingeloggt' });
    return null;
  }
  const sub = req.session.user?.claims?.sub || 'anon';
  if (!userStores.has(sub)) {
    userStores.set(sub, {
      // People: genau 3 Slots
      people: [
        { name: '', role: '' },
        { name: '', role: '' },
        { name: '', role: '' }
      ],
      // Events sehr simpel
      eventsByDate: {}
    });
  }
  return userStores.get(sub);
}

// --- Routen ---

app.get('/health', (req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

// Login: baue Authorize-URL mit PKCE & leite dorthin
app.get('/login', async (req, res) => {
  try {
    const { authorization_endpoint } = await getOidcMeta();

    // PKCE
    const codeVerifier = toBase64Url(crypto.randomBytes(32));
    const codeChallenge = toBase64Url(
      crypto.createHash('sha256').update(codeVerifier).digest()
    );

    // CSRF & Replay Schutz
    const state = toBase64Url(crypto.randomBytes(16));
    const nonce = toBase64Url(crypto.randomBytes(16));

    // in Session parken
    req.session.oidc_state = state;
    req.session.oidc_nonce = nonce;
    req.session.code_verifier = codeVerifier;

    const url = new URL(authorization_endpoint);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    url.searchParams.set('prompt', 'login');
    url.searchParams.set('max_age', '0');

    res.redirect(url.toString());
  } catch (e) {
    console.error('Login-Fehler:', e);
    res.status(500).send('Login konnte nicht gestartet werden.');
  }
});

// Callback: tausche Code gegen Token, prüfe ID Token, lege User in Session
app.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Kein Code in Callback.');
    if (!state || state !== req.session.oidc_state) {
      return res.status(400).send('Ungültiger State.');
    }

    const codeVerifier = req.session.code_verifier;
    const nonce = req.session.oidc_nonce;
    // aufräumen
    delete req.session.oidc_state;
    delete req.session.code_verifier;
    delete req.session.oidc_nonce;

    const { token_endpoint, issuer, jwks_uri } = await getOidcMeta();

    // Token-Tausch
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier
    });

    if (CLIENT_SECRET) {
      body.set('client_secret', CLIENT_SECRET);
    }

    const tokenRes = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('Token Endpoint Fehler:', tokenRes.status, t);
      return res.status(502).send('Token-Austausch fehlgeschlagen.');
    }

    const tokens = await tokenRes.json();
    const idToken = tokens.id_token;
    if (!idToken) return res.status(500).send('Kein ID Token erhalten.');

    // ID Token validieren (Signatur, Issuer, Audience, Nonce)
    const client = jwksClient({ jwksUri: jwks_uri });

    function getKey(header, callback) {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
      });
    }

    jwt.verify(
      idToken,
      getKey,
      {
        audience: CLIENT_ID,
        issuer, // exakter String aus Discovery
        algorithms: ['RS256', 'PS256', 'ES256'] // gängig – echte Alg wird per Header geprüft
      },
      (err, payload) => {
        if (err) {
          console.error('ID Token verify Fehler:', err);
          return res.status(401).send('Ungültiges ID Token.');
        }

        if (payload.nonce !== nonce) {
          return res.status(401).send('Nonce stimmt nicht überein.');
        }

        // User in Session ablegen (Tokens ohne id_token speichern, wenn gewünscht)
        const { id_token, ...restTokens } = tokens;
        req.session.user = {
          claims: payload,
          tokens: restTokens, // access_token, refresh_token (falls ausgegeben), expires_in usw.
          id_token
        };

        console.log('Login OK. Subject:', payload.sub, 'SessionID:', req.session.id);
        // zurück ins Frontend
        res.redirect(FRONTEND_ORIGIN + '/');
      }
    );
  } catch (e) {
    console.error('Callback-Fehler:', e);
    res.status(500).send('Callback fehlgeschlagen.');
  }
});

// User-Status für das Frontend (App.js ruft /userinfo)
app.get('/userinfo', (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, claims: req.session.user.claims });
});

// Simple geschützte Ressource zum Testen
app.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.json({ user: req.session.user.claims });
});

// Logout (Session killen) + optional Provider-Logout
app.post('/logout', async (req, res) => {
  try {
    const { end_session_endpoint } = await getOidcMeta().catch(() => ({}));
    const idTokenHint = req.session?.user?.id_token;

    req.session.destroy(async (err) => {
      if (err) return res.status(500).json({ ok: false });

      if (end_session_endpoint) {
        const url = new URL(end_session_endpoint);
        if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
        // post_logout_redirect_uri wird vom IdP ignoriert → egal, wir öffnen nur in neuem Tab
        url.searchParams.set('post_logout_redirect_uri', FRONTEND_ORIGIN + '/');
        return res.json({
          ok: true,
          providerLogout: url.toString(),  // <— nur zurückgeben
          appRedirect: FRONTEND_ORIGIN + '/'
        });
      }
      return res.json({ ok: true, appRedirect: FRONTEND_ORIGIN + '/' });
    });
  } catch (e) {
    console.error('Logout-Fehler:', e);
    res.status(500).json({ ok: false });
  }
});

// People-API (für Config)

// Aktuelle Konfiguration lesen (3 Slots)
app.get('/people', (req, res) => {
  const store = ensureStoreFor(req, res);
  if (!store) return;
  res.json({ people: store.people });
});

// Slot (1..3) speichern/überschreiben
app.put('/people/:slot', (req, res) => {
  const store = ensureStoreFor(req, res);
  if (!store) return;

  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) {
    return res.status(400).json({ error: 'slot muss 1, 2 oder 3 sein' });
  }

  const incoming = req.body || {};
  const name = (incoming.name ?? incoming.firstname ?? '').toString().trim();
  const role = (incoming.role ?? '').toString().trim();

  store.people[slot - 1] = { name, role };
  res.json({ ok: true, people: store.people });
});

// Slot (1..3) leeren
app.delete('/people/:slot', (req, res) => {
  const store = ensureStoreFor(req, res);
  if (!store) return;

  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) {
    return res.status(400).json({ error: 'slot muss 1, 2 oder 3 sein' });
  }

  store.people[slot - 1] = { name: '', role: '' };
  res.json({ ok: true, people: store.people });
});

// Event-API


// Alle Events als Objekt zurückgeben
app.get('/events', (req, res) => {
  const store = ensureStoreFor(req, res);
  if (!store) return;
  res.json(store.eventsByDate); // z.B. { "2025-09-11": ["On Vacation"] }
});

// Event hinzufügen: { date: "YYYY-MM-DD", status: "Out of Office" }
app.post('/events', (req, res) => {
  const store = ensureStoreFor(req, res);
  if (!store) return;

  const { date, status } = req.body || {};
  if (!date || !status) {
    return res.status(400).json({ error: 'date und status sind Pflichtfelder.' });
  }

  const day = String(date);
  const val = String(status);

  if (!store.eventsByDate[day]) store.eventsByDate[day] = [];
  // Doppelte vermeiden (optional): nur hinzufügen, wenn nicht vorhanden
  if (!store.eventsByDate[day].includes(val)) {
    store.eventsByDate[day].push(val);
  }

  res.json(store.eventsByDate);
});

// Event löschen: { date: "YYYY-MM-DD", status: "Out of Office" }
app.delete('/events', (req, res) => {
  const store = ensureStoreFor(req, res);
  if (!store) return;

  const { date, status } = req.body || {};
  if (!date || !status) {
    return res.status(400).json({ error: 'date und status sind Pflichtfelder.' });
  }

  const day = String(date);
  const val = String(status);

  const arr = store.eventsByDate[day] || [];
  const idx = arr.indexOf(val);
  if (idx >= 0) {
    arr.splice(idx, 1); // genau einen Eintrag entfernen
  }
  if (arr.length === 0) {
    delete store.eventsByDate[day];
  } else {
    store.eventsByDate[day] = arr;
  }

  res.json(store.eventsByDate);
});

// =======================
// Device Snapshot API (für ESP32)
// =======================
//
// GET /device/snapshot
// Header: Authorization: Bearer <DEVICE_KEY>
// Optional: If-None-Match: <etag>
//
// Antwort 200 JSON:
// {
//   "date": "YYYY-MM-DD",
//   "people": [ {name, role}, {name, role}, {name, role} ],
//   "statuses": ["Out of Office", "Available", ...],
//   "ts": 1699999999999
// }
//
// Antwort 304, wenn nichts neu (per ETag)

app.get('/device/snapshot', requireDeviceAuth, (req, res) => {
  const store = getBoardStore();

  const date = todayYMD('Europe/Berlin');
  const statuses = store.eventsByDate[date] || [];
  const payload = {
    date,
    people: store.people,
    statuses,
    ts: Date.now()
  };

  const tag = etagFor(payload);
  // Conditional GET
  const inm = req.headers['if-none-match'];
  if (inm && inm === tag) {
    res.status(304).end();
    return;
  }

  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', 'no-cache'); // kein aggressives Caching
  res.json(payload);
});






// //  Cloud “Device Shadow” API  
// // Keine Interference mit SCC Login (ensureStoreFor),
// // Bearer (requireDeviceAuth).

// const desiredById = new Map();   // deviceId -> { version, state:{ room, people[] } }
// const reportedById = new Map();  // deviceId -> { ts, version, state:{...}, meta:{} }

// function nextVersion(deviceId) {
//   const cur = desiredById.get(deviceId);
//   return (cur?.version || 0) + 1;
// }

// // WEB -> Set desired config for a device
// app.post('/cloud/:deviceId/desired', (req, res) => {
//   const store = ensureStoreFor(req, res); // requires login OIDC (session)
//   if (!store) return;

//   const { deviceId } = req.params;
//   const incoming = req.body || {};

//   const people = Array.isArray(incoming.people)
//     ? incoming.people.slice(0, 3).map(p => ({
//         name:   (p?.name   || '').toString(),
//         role:   (p?.role   || '').toString(),
//         uid:    (p?.uid    || '').toString(),
//         status: (p?.status || '').toString()
//       }))
//     : [];

//   const desired = {
//     version: nextVersion(deviceId),
//     state: {
//       room: (incoming.room || '').toString(),
//       people
//     }
//   };

//   desiredById.set(deviceId, desired);
//   res.json({ ok: true, version: desired.version });
// });

// // WEB -> reads actual status (last one reported, otherwise desired one)
// app.get('/cloud/:deviceId/state', (req, res) => {
//   const store = ensureStoreFor(req, res); // login OIDC
//   if (!store) return;

//   const { deviceId } = req.params;
//   const rep = reportedById.get(deviceId);
//   if (rep) return res.json(rep);

//   const des = desiredById.get(deviceId) || { version: 0, state: { room:'', people:[] } };
//   return res.json({ ts: Date.now(), version: des.version, state: des.state, meta: { source: 'desired' } });
// });

// // DEVICE -> “pull” of desired if there is a new version
// app.get('/cloud/:deviceId/desired', requireDeviceAuth, (req, res) => {
//   const { deviceId } = req.params;
//   const since = parseInt(req.query.since || '0', 10);
//   const des = desiredById.get(deviceId);
//   if (!des || des.version <= since) return res.status(204).end();
//   res.json(des); // { version, state:{ room, people } }
// });

// // DEVICE -> reports actual status
// app.post('/cloud/:deviceId/report', requireDeviceAuth, (req, res) => {
//   const { deviceId } = req.params;
//   const body = req.body || {};
//   const payload = {
//     ts: Date.now(),
//     version: Number.isInteger(body.version) ? body.version : 0,
//     state: body.state || {},
//     meta: body.meta || {}
//   };
//   reportedById.set(deviceId, payload);
//   res.json({ ok: true });
// });





// Globaler Error-Handler (falls etwas durchrutscht)
app.use((err, req, res, next) => {
  console.error('Unerwarteter Fehler:', err);
  res.status(500).send('Interner Serverfehler.');
});

// Serverstart
app.listen(PORT, () => {
  console.log(`Auth-Server läuft auf http://localhost:${PORT}`);
});








