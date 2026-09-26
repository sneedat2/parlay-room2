// Parlay Room — a shared FanDuel prop board for a small betting group.
// Zero dependencies: needs Node 18+ (built-in fetch). Run with `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Phone/desktop notifications. Optional: if the package is missing, the app runs without them.
let webpush = null;
try { webpush = require('web-push'); } catch { console.warn('web-push is not installed, so notifications are off. Run `npm install`.'); }

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ODDS_API_KEY || '';
// Optional: if set, creating a new group requires this code (keeps strangers off your API credits).
const CREATE_CODE = process.env.GROUP_CREATE_CODE || '';
const FANDUEL_STATE = (process.env.FANDUEL_STATE || '').toLowerCase();
const CACHE_SECONDS = Number(process.env.ODDS_CACHE_SECONDS) || 120;
// Where accounts, groups and slips are saved. On Railway this must be on an attached volume,
// or every deploy starts from an empty file. Railway tells us the volume's path, so use it.
const VOLUME_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const DATA_FILE = (VOLUME_DIR && !(process.env.DATA_FILE || '').startsWith(VOLUME_DIR))
  ? path.join(VOLUME_DIR, 'data.json') // volume attached: always save there, even if DATA_FILE is missing or wrong
  : process.env.DATA_FILE || path.join(__dirname, 'data.json');
// Temporary = wiped whenever the app is updated or restarted.
const STORAGE_TEMPORARY = ON_RAILWAY && !VOLUME_DIR;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEMO = !API_KEY;

// Email for password reset codes. Sent over HTTPS APIs (Railway blocks SMTP on Hobby plans).
// Brevo works without owning a domain; Resend needs a verified domain to email anyone but you.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Parlay Room';
const EMAIL_ON = !!((BREVO_API_KEY || RESEND_API_KEY) && MAIL_FROM);

// ---------------------------------------------------------------- sports & markets

// Market keys are The Odds API's (https://the-odds-api.com/sports-odds-data/betting-markets.html).
// group: 'player' = player props row, 'game' = game lines row in Find props.
const player = (key, label) => ({ key, label, group: 'player' });
const game = (key, label) => ({ key, label, group: 'game' });

// Full-game lines every sport shares. `spread` is what the sport calls it (Spread / Run Line / Puck Line).
const gameLines = (spread) => [
  game('h2h', 'Moneyline'),
  game('spreads', spread),
  game('totals', 'Total'),
  game('alternate_spreads', `Alt ${spread}s`),
  game('alternate_totals', 'Alt Totals'),
  game('team_totals', 'Team Totals'),
  game('alternate_team_totals', 'Alt Team Totals'),
];
const halvesAndQuarters = [
  game('h2h_h1', '1H Moneyline'),
  game('spreads_h1', '1H Spread'),
  game('totals_h1', '1H Total'),
  game('spreads_q1', '1Q Spread'),
  game('totals_q1', '1Q Total'),
];

const FOOTBALL = [
  player('player_pass_yds', 'Pass Yds'),
  player('player_pass_tds', 'Pass TDs'),
  player('player_rush_yds', 'Rush Yds'),
  player('player_reception_yds', 'Rec Yds'),
  player('player_receptions', 'Receptions'),
  player('player_rush_reception_yds', 'Rush+Rec Yds'),
  player('player_anytime_td', 'Anytime TD'),
  player('player_1st_td', 'First TD'),
  player('player_last_td', 'Last TD'),
  player('player_tds_over', 'Total TDs'),
  ...gameLines('Spread'),
  ...halvesAndQuarters,
];
const BASKETBALL = [
  player('player_points', 'Points'),
  player('player_rebounds', 'Rebounds'),
  player('player_assists', 'Assists'),
  player('player_threes', 'Threes'),
  player('player_points_rebounds_assists', 'PRA'),
  player('player_points_rebounds', 'Pts+Reb'),
  player('player_points_assists', 'Pts+Ast'),
  player('player_double_double', 'Double-Double'),
  player('player_triple_double', 'Triple-Double'),
  player('player_first_basket', 'First Basket'),
  ...gameLines('Spread'),
  ...halvesAndQuarters,
];
const BASEBALL = [
  player('batter_hits', 'Hits'),
  player('batter_total_bases', 'Total Bases'),
  player('batter_home_runs', 'Home Runs'),
  player('batter_first_home_run', 'First Home Run'),
  player('batter_rbis', 'RBIs'),
  player('batter_runs_scored', 'Runs'),
  player('batter_hits_runs_rbis', 'H+R+RBI'),
  player('pitcher_strikeouts', 'Strikeouts'),
  player('pitcher_outs', 'Pitcher Outs'),
  player('pitcher_hits_allowed', 'Hits Allowed'),
  ...gameLines('Run Line'),
  game('h2h_1st_5_innings', 'F5 Moneyline'),
  game('spreads_1st_5_innings', 'F5 Run Line'),
  game('totals_1st_5_innings', 'F5 Total'),
  game('totals_1st_1_innings', '1st Inning (NRFI/YRFI)'),
];
const HOCKEY = [
  player('player_goal_scorer_anytime', 'Anytime Goal'),
  player('player_goal_scorer_first', 'First Goal'),
  player('player_points', 'Points'),
  player('player_shots_on_goal', 'Shots'),
  player('player_assists', 'Assists'),
  player('player_total_saves', 'Saves'),
  ...gameLines('Puck Line'),
  game('h2h_p1', '1P Moneyline'),
  game('totals_p1', '1P Total'),
];

const SPORTS = [
  { key: 'americanfootball_nfl', title: 'NFL', markets: FOOTBALL },
  { key: 'americanfootball_ncaaf', title: 'NCAAF', markets: FOOTBALL },
  { key: 'basketball_nba', title: 'NBA', markets: BASKETBALL },
  { key: 'basketball_wnba', title: 'WNBA', markets: BASKETBALL },
  { key: 'basketball_ncaab', title: 'NCAAB', markets: BASKETBALL },
  { key: 'baseball_mlb', title: 'MLB', markets: BASEBALL },
  { key: 'icehockey_nhl', title: 'NHL', markets: HOCKEY },
];
const sportByKey = (k) => SPORTS.find((s) => s.key === k);

// Sportsbooks a group can bet with. Odds and betslip links currently come from FanDuel only.
const SPORTSBOOKS = [
  { key: 'fanduel', title: 'FanDuel', home: 'https://sportsbook.fanduel.com/' },
];
const bookFor = (g) => SPORTSBOOKS.find((b) => b.key === g.sportsbook) || SPORTSBOOKS[0];
const marketLabel = (sport, m) => sportByKey(sport)?.markets.find((x) => x.key === m)?.label || m;

// ---------------------------------------------------------------- storage

// members = accounts (name + email + password). Each group has its own leader, members and named slips.
let db = { members: [], sessions: {}, groups: [] };
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let savedText = null;
try {
  savedText = fs.readFileSync(DATA_FILE, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err; // can't read it: stop rather than start empty and overwrite it
}
if (savedText == null && fs.existsSync(DATA_FILE + '.tmp')) {
  // A save was interrupted before the swap; the .tmp copy is complete (it's written in full first).
  savedText = fs.readFileSync(DATA_FILE + '.tmp', 'utf8');
  console.warn('Recovered data from an interrupted save.');
}
if (savedText != null) {
  try {
    db = { ...db, ...JSON.parse(savedText) };
  } catch (err) {
    // Never silently replace a damaged file with an empty one. Keep a copy and stop.
    const backup = `${DATA_FILE}.damaged-${Date.now()}`;
    fs.copyFileSync(DATA_FILE, backup);
    console.error(`${DATA_FILE} couldn't be read (${err.message}). A copy was saved to ${backup}. Not starting, so nothing gets overwritten.`);
    process.exit(1);
  }
}

// Older single-group data: fold it into one group.
function migrateSingleGroup() {
  if (!Array.isArray(db.legs)) return;
  if (db.members.length) {
    const leader = db.members.find((m) => m.isLeader) || db.members[0];
    db.groups.push({
      id: newId(), name: 'My group', code: newInviteCode(), leaderId: leader.id,
      memberIds: db.members.map((m) => m.id), legs: db.legs, createdAt: new Date().toISOString(),
    });
  }
  delete db.legs;
  db.members.forEach((m) => delete m.isLeader);
}

// Groups used to have one slip (group.legs). Now each group has named slips; old legs become "Main slip".
const newSlip = (name, createdBy, legs = []) => ({ id: newId(), name, createdBy, createdAt: new Date().toISOString(), legs });
function migrateSlips() {
  let changed = false;
  for (const g of db.groups) {
    if (Array.isArray(g.slips) && g.slips.length) continue;
    g.slips = [newSlip('Main slip', g.leaderId, g.legs || [])];
    delete g.legs;
    changed = true;
  }
  return changed;
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  // Write the full copy, flush it to disk, then swap it in, so a crash mid-save can't leave half a file.
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(db, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DATA_FILE);
}

function newId() { return crypto.randomBytes(9).toString('base64url'); }
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L mix-ups
function newInviteCode() {
  let code;
  do { code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join(''); }
  while ((db.groups || []).some((g) => g.code === code));
  return code;
}

function groupView(g) {
  const people = (ids) => (ids || [])
    .map((id) => db.members.find((m) => m.id === id))
    .filter(Boolean);
  const editors = g.editorIds || [];
  const members = people(g.memberIds).map((m) => ({
    id: m.id, name: m.name, isLeader: m.id === g.leaderId, isEditor: editors.includes(m.id),
  }));
  const removed = people(g.bannedIds).map((m) => ({ id: m.id, name: m.name }));
  const book = bookFor(g);
  return {
    id: g.id, name: g.name, code: g.code, leaderId: g.leaderId, members, removed,
    locked: !!g.locked,
    sportsbook: { key: book.key, title: book.title },
  };
}

// Locked groups: only the leader and chosen editors change slips; everyone else views and bets.
// Unlocked groups: anyone adds; you manage your own legs/slips; the leader manages everything.
const isGroupEditor = (g, memberId) => g.leaderId === memberId || (g.editorIds || []).includes(memberId);
const canEditGroup = (g, memberId) => !g.locked || isGroupEditor(g, memberId);
const LOCKED_MSG = 'This group is locked. Only the leader and editors can change slips and props.';

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const memberByEmail = (e) => db.members.find((m) => m.email && m.email === e);

async function sendEmail(to, subject, text) {
  if (!EMAIL_ON) return false;
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5">${text
    .split('\n').map((l) => l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))).join('<br>')}</div>`;
  const res = BREVO_API_KEY
    ? await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: MAIL_FROM_NAME, email: MAIL_FROM }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
    })
    : await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${MAIL_FROM_NAME} <${MAIL_FROM}>`, to: [to], subject, text, html }),
    });
  if (!res.ok) {
    console.error(`Email send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    throw Object.assign(new Error("Couldn't send the email right now. Try again in a minute."), { status: 502 });
  }
  return true;
}

// Per-account lockout on top of the per-IP limit.
const accountLocked = (m) => m.lockedUntil && m.lockedUntil > Date.now();
function noteBadPin(m) {
  m.failCount = (m.failCount || 0) + 1;
  if (m.failCount >= 8) { m.lockedUntil = Date.now() + 15 * 60 * 1000; m.failCount = 0; }
  save();
}

function newSession(member) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.sessions[token] = member.id;
  return token;
}

migrateSingleGroup();
if (migrateSlips()) save();

// ---------------------------------------------------------------- push notifications

// Keys that identify this server to Apple/Google push services. Made once and kept with the data,
// so nothing to configure. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars override them.
let PUSH_PUBLIC_KEY = null;
function setupPush() {
  if (!webpush) return;
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    if (!db.vapid) { db.vapid = webpush.generateVAPIDKeys(); save(); }
    ({ publicKey: pub, privateKey: priv } = db.vapid);
  }
  webpush.setVapidDetails(process.env.PUSH_CONTACT || `mailto:${MAIL_FROM || 'noreply@parlayroom.app'}`, pub, priv);
  PUSH_PUBLIC_KEY = pub;
}
setupPush();

const b64urlLength = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]+=*$/.test(s) ? Buffer.from(s, 'base64url').length : -1);
function validSubscription(s) {
  return s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && s.keys && b64urlLength(s.keys.p256dh) === 65 && b64urlLength(s.keys.auth) === 16;
}

// Send to every device of the given members. Dead subscriptions (uninstalled, permission revoked) get dropped.
async function pushTo(memberIds, payload) {
  if (!PUSH_PUBLIC_KEY) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(memberIds.flatMap((id) => {
    const m = db.members.find((x) => x.id === id);
    return (m?.pushSubs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: 6 * 3600, urgency: 'high' });
      } catch (err) {
        // 404/410: the device unsubscribed or uninstalled. 400/403 or no status: the subscription itself is
        // unusable (bad keys, key mismatch). All of these will never work again, so drop them.
        if ([400, 403, 404, 410].includes(err.statusCode) || !err.statusCode && !/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ECONNREFUSED/.test(err.code || err.message)) {
          m.pushSubs = m.pushSubs.filter((s) => s.endpoint !== sub.endpoint);
          dirty = true;
        } else {
          console.error(`Notification to ${m.name} failed: ${err.statusCode || ''} ${err.body || err.message}`.trim());
        }
      }
    });
  }));
  if (dirty) save();
}

const fmtOdds = (p) => (p > 0 ? `+${p}` : `${p}`);

// ---------------------------------------------------------------- The Odds API

const quota = { remaining: null, used: null };
const cache = new Map();

async function oddsApi(pathname, params = {}, ttlSeconds = CACHE_SECONDS) {
  const url = new URL('https://api.the-odds-api.com/v4' + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.data;

  url.searchParams.set('apiKey', API_KEY);
  const res = await fetch(url);
  if (res.headers.get('x-requests-remaining') != null) {
    quota.remaining = Number(res.headers.get('x-requests-remaining'));
    quota.used = Number(res.headers.get('x-requests-used'));
  }
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Odds API ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status === 401 ? 502 : res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json();
  cache.set(cacheKey, { data, expires: Date.now() + ttlSeconds * 1000 });
  return data;
}

async function listEvents(sport) {
  if (DEMO) return demoEvents(sport);
  const events = await oddsApi(`/sports/${sport}/events`, {}, 300);
  return events
    .map((e) => ({ id: e.id, home: e.home_team, away: e.away_team, commence: e.commence_time }))
    .sort((a, b) => a.commence.localeCompare(b.commence));
}

// FanDuel links sometimes carry a {state} placeholder.
function fixLink(link) {
  if (!link) return null;
  if (link.includes('{state}')) {
    if (!FANDUEL_STATE) return null;
    link = link.replaceAll('{state}', FANDUEL_STATE);
  }
  return link;
}

// Milestone lines ("1+ HR", "250+ yds") are an Over x.5 in the alternate market.
const milestone = (o) => o.name === 'Over' && o.point != null && o.point % 1 !== 0;

function describeOutcome(market, o, isAlt) {
  if (isAlt && o.description && milestone(o)) return `${o.description} ${Math.ceil(o.point)}+`;
  // Spreads of any kind (alt, 1H, run line...) show the sign: "Bills +3.5"
  const pt = o.point == null ? '' : ` ${market.includes('spreads') && o.point > 0 ? '+' : ''}${o.point}`;
  // Yes-only props (First TD, Double-Double...): just the player; the market name says the rest.
  if (o.description && o.name === 'Yes' && o.point == null) return o.description;
  if (o.description) return `${o.description} ${o.name}${pt}`; // player props & team totals: description = player/team
  if (market.startsWith('h2h')) return `${o.name} ML`;
  return `${o.name}${pt}`;
}

// The Odds API files many FanDuel props (e.g. "To Hit a Home Run", "2+ HRs", "250+ Pass Yds")
// under "<market>_alternate", so ask for both in one call. Only markets that come back cost credits.
const ALT_MARKETS = new Set([
  'player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_reception_yds', 'player_receptions',
  'player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists',
  'player_rush_reception_yds', 'player_points_rebounds', 'player_points_assists',
  'batter_hits', 'batter_total_bases', 'batter_home_runs', 'batter_rbis', 'batter_hits_runs_rbis', 'batter_runs_scored',
  'pitcher_strikeouts', 'pitcher_outs', 'pitcher_hits_allowed', 'player_shots_on_goal', 'player_total_saves',
]);
const altKey = (market) => (ALT_MARKETS.has(market) ? `${market}_alternate` : null);

async function getProps(sport, eventId, market) {
  const alt = altKey(market);
  const raw = DEMO
    ? demoOdds(sport, eventId, market)
    : await oddsApi(`/sports/${sport}/events/${eventId}/odds`, {
      regions: 'us',
      markets: alt ? `${market},${alt}` : market,
      bookmakers: 'fanduel',
      oddsFormat: 'american',
      includeLinks: 'true',
      includeSids: 'true',
    });
  const bk = (raw.bookmakers || []).find((b) => b.key === 'fanduel');
  const main = bk?.markets?.find((x) => x.key === market);
  const altM = alt && bk?.markets?.find((x) => x.key === alt);
  const event = {
    id: raw.id, home: raw.home_team, away: raw.away_team, commence: raw.commence_time,
    name: `${raw.away_team} @ ${raw.home_team}`,
  };

  const toOutcome = (m, o, isAlt) => ({
    key: `${isAlt ? 'alt:' : ''}${o.description || ''}|${o.name}|${o.point ?? ''}`,
    label: describeOutcome(market, o, isAlt),
    player: o.description || null,
    side: isAlt && o.description && milestone(o) ? `${Math.ceil(o.point)}+` : o.name,
    point: isAlt && o.description && milestone(o) ? null : o.point ?? null,
    price: o.price,
    alt: isAlt,
    link: fixLink(o.link) || fixLink(m.link) || null,
    sid: o.sid || null,
    marketSid: m.sid || null,
  });

  const seen = new Set();
  const outcomes = [];
  for (const [m, isAlt] of [[main, false], [altM, true]]) {
    for (const o of m?.outcomes || []) {
      const same = `${o.description || ''}|${o.name}|${o.point ?? ''}`;
      if (seen.has(same)) continue; // alternate repeats the main line
      seen.add(same);
      outcomes.push({ ...toOutcome(m, o, isAlt), _pt: o.point ?? 0 });
    }
  }
  // Keep each player's lines together: main line first, then milestones low to high.
  const order = new Map();
  outcomes.forEach((o) => { if (!order.has(o.player)) order.set(o.player, order.size); });
  outcomes.sort((a, b) => order.get(a.player) - order.get(b.player) || a.alt - b.alt || a._pt - b._pt);
  outcomes.forEach((o) => delete o._pt);

  const lastUpdate = [main?.last_update, altM?.last_update].filter(Boolean).sort().pop() || null;
  return { event, market, marketLabel: marketLabel(sport, market), lastUpdate, outcomes };
}

// One FanDuel URL that loads every leg into the betslip.
function parlayLink(legs) {
  const picks = [];
  let origin = 'https://sportsbook.fanduel.com';
  for (const leg of legs) {
    let marketId = null, selectionId = null;
    if (leg.link) {
      try {
        const u = new URL(leg.link);
        origin = u.origin;
        marketId = u.searchParams.get('marketId[0]') || u.searchParams.get('marketId');
        selectionId = u.searchParams.get('selectionId[0]') || u.searchParams.get('selectionId');
      } catch { /* ignore bad links */ }
    }
    marketId = marketId || leg.marketSid;
    selectionId = selectionId || leg.sid;
    if (marketId && selectionId) picks.push([marketId, selectionId]);
  }
  if (!picks.length || picks.length !== legs.length) return null;
  const qs = picks.map(([m, s], i) =>
    `marketId[${i}]=${encodeURIComponent(m)}&selectionId[${i}]=${encodeURIComponent(s)}`).join('&');
  return `${origin}/addToBetslip?${qs}`;
}

// ---------------------------------------------------------------- HTTP plumbing

const failedJoins = new Map(); // ip -> { count, until }

// ---------------------------------------------------------------- live updates (Server-Sent Events)
// Each open screen keeps one connection per group. When the slip or group changes, every screen
// in that group is told right away and reloads the slip. Polling stays on as a backup.

const liveStreams = new Map(); // groupId -> Set<res>
const liveTickets = new Map(); // one-time ticket -> { memberId, groupId, expires }

function notifyGroup(groupId, what) {
  const payload = `event: changed\ndata: ${JSON.stringify({ what, at: Date.now() })}\n\n`;
  for (const res of liveStreams.get(groupId) || []) res.write(payload);
}

function dropFromLive(groupId, memberId) {
  for (const res of liveStreams.get(groupId) || []) if (res.memberId === memberId) res.end();
}

// Proxies close quiet connections; a comment line every 25s keeps them open.
setInterval(() => {
  for (const set of liveStreams.values()) for (const res of set) res.write(': ping\n\n');
  for (const [t, v] of liveTickets) if (v.expires < Date.now()) liveTickets.delete(t);
}, 25000).unref();

function openLiveStream(req, res, ticket) {
  const t = liveTickets.get(ticket);
  liveTickets.delete(ticket);
  const group = t && t.expires > Date.now() && db.groups.find((g) => g.id === t.groupId);
  if (!group || !group.memberIds.includes(t.memberId)) return send(res, 403, { error: 'Live updates need a fresh ticket.' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  res.memberId = t.memberId;
  if (!liveStreams.has(group.id)) liveStreams.set(group.id, new Set());
  liveStreams.get(group.id).add(res);
  req.on('close', () => {
    const set = liveStreams.get(group.id);
    if (set) { set.delete(res); if (!set.size) liveStreams.delete(group.id); }
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20000) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
  });
}

function currentMember(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const id = token && db.sessions[token];
  return id ? db.members.find((m) => m.id === id) : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  // Invite links (/join/CODE) open the app, which reads the code from the address.
  const page = pathname === '/' || /^\/join\/[A-Za-z0-9]{4,12}\/?$/.test(pathname) ? 'index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, page));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Always check for a newer app version (home-screen apps otherwise hang on to old files).
      'Cache-Control': ext === '.png' ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- routes

async function handleApi(req, res, url) {
  const { pathname } = url;

  const ip = req.socket.remoteAddress;
  const tooManyTries = () => {
    const f = failedJoins.get(ip);
    return f && f.count >= 10 && f.until > Date.now();
  };
  const fail = (status, error) => {
    const cur = failedJoins.get(ip) || { count: 0 };
    failedJoins.set(ip, { count: cur.count + 1, until: Date.now() + 15 * 60 * 1000 });
    return send(res, status, { error });
  };

  // New passwords: 8+ characters. Old accounts may still hold a 4–8 digit PIN until they change it.
  const passwordProblem = (pw) => {
    const s = String(pw || '');
    if (s.length < 8) return 'Password must be at least 8 characters.';
    if (s.length > 128) return 'Password is too long (128 characters max).';
    if (/^\d+$/.test(s) && s.length < 10) return 'Use letters too, not just numbers, or make it at least 10 digits.';
    return null;
  };

  // Public: what an invite link points to, so the sign-in screen can say which group.
  const inviteMatch = pathname.match(/^\/api\/invite\/([A-Za-z0-9]{4,12})$/);
  if (inviteMatch && req.method === 'GET') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const g = db.groups.find((x) => x.code === inviteMatch[1].toUpperCase());
    if (!g) return fail(404, "This invite link doesn't work anymore. Ask the group leader for a new one.");
    return send(res, 200, { name: g.name, members: g.memberIds.length });
  }

  if (pathname === '/api/signup' && req.method === 'POST') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const { name, email, password } = await readBody(req);
    const cleanName = String(name || '').trim().slice(0, 24);
    const cleanEmail = normalizeEmail(email);
    if (!cleanName) return send(res, 400, { error: 'Enter your name.' });
    if (!validEmail(cleanEmail)) return send(res, 400, { error: 'Enter a valid email address.' });
    const problem = passwordProblem(password);
    if (problem) return send(res, 400, { error: problem });
    if (memberByEmail(cleanEmail)) return send(res, 409, { error: 'That email already has an account. Sign in, or use Forgot password.' });
    const salt = newId();
    // pinHash holds the password hash (name kept so older saved data still loads).
    const member = { id: newId(), name: cleanName, email: cleanEmail, salt, pinHash: hashPin(password, salt), joinedAt: new Date().toISOString() };
    db.members.push(member);
    const token = newSession(member);
    save();
    return send(res, 201, { token });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const { login, password } = await readBody(req);
    const id = String(login || '').trim();
    const pw = String(password || '');
    if (!id) return send(res, 400, { error: 'Enter your email.' });
    if (!pw || pw.length > 128) return send(res, 400, { error: 'Enter your password.' });
    // Email for everyone; accounts made before email existed can still use their name once.
    const member = id.includes('@')
      ? memberByEmail(normalizeEmail(id))
      : db.members.find((m) => !m.email && m.name.toLowerCase() === id.toLowerCase());
    const wrong = id.includes('@') ? 'Wrong email or password.' : 'Wrong name or password.';
    if (!member) return fail(403, wrong);
    if (accountLocked(member)) return send(res, 429, { error: 'Too many wrong passwords. Wait 15 minutes, or use Forgot password.' });
    if (hashPin(pw, member.salt) !== member.pinHash) { noteBadPin(member); return fail(403, wrong); }
    failedJoins.delete(ip);
    member.failCount = 0;
    // Still on an old PIN? Make them pick a real password next.
    if (passwordProblem(pw)) member.mustChangePassword = true;
    const token = newSession(member);
    save();
    return send(res, 200, { token });
  }

  if (pathname === '/api/forgot' && req.method === 'POST') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const { email } = await readBody(req);
    const cleanEmail = normalizeEmail(email);
    if (!validEmail(cleanEmail)) return send(res, 400, { error: 'Enter the email on your account.' });
    const sentMsg = { ok: true, message: 'If that email has an account, a 6-digit code is on its way. It works for 15 minutes.' };
    const member = memberByEmail(cleanEmail);
    if (!member) return send(res, 200, sentMsg); // don't reveal which emails have accounts
    if (member.reset && member.reset.sentAt > Date.now() - 60 * 1000) {
      return send(res, 429, { error: 'A code was just sent. Wait a minute before asking for another.' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = newId();
    member.reset = { salt, codeHash: hashPin(code, salt), expires: Date.now() + 15 * 60 * 1000, tries: 0, sentAt: Date.now() };
    save();
    if (!EMAIL_ON) {
      console.log(`[Password reset] Email isn't configured. Code for ${member.email}: ${code}`);
      return send(res, 503, { error: "Email isn't set up on this server yet, so a code can't be sent. Ask whoever runs the app." });
    }
    await sendEmail(member.email, `Your Parlay Room code: ${code}`,
      `Hi ${member.name},\n\nYour Parlay Room password reset code is: ${code}\n\nIt expires in 15 minutes. If you didn't ask for this, ignore this email; your password hasn't changed.`);
    return send(res, 200, sentMsg);
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const { email, code, password } = await readBody(req);
    const member = memberByEmail(normalizeEmail(email));
    const r = member && member.reset;
    if (!r || r.expires < Date.now() || r.tries >= 5) {
      return fail(400, 'That code has expired. Ask for a new one.');
    }
    if (hashPin(String(code || '').trim(), r.salt) !== r.codeHash) {
      r.tries += 1;
      save();
      return fail(400, r.tries >= 5 ? 'Too many wrong codes. Ask for a new one.' : "That code isn't right. Check the email and try again.");
    }
    const problem = passwordProblem(password);
    if (problem) return send(res, 400, { error: problem });
    member.salt = newId();
    member.pinHash = hashPin(password, member.salt);
    delete member.mustChangePassword;
    delete member.reset;
    member.failCount = 0;
    delete member.lockedUntil;
    // Sign out every other device.
    for (const [t, mid] of Object.entries(db.sessions)) if (mid === member.id) delete db.sessions[t];
    failedJoins.delete(ip);
    const token = newSession(member);
    save();
    return send(res, 200, { token });
  }

  // EventSource can't send the sign-in header, so it brings a one-time ticket instead.
  if (pathname === '/api/live' && req.method === 'GET') {
    return openLiveStream(req, res, url.searchParams.get('ticket') || '');
  }

  const me = currentMember(req);
  if (!me) return send(res, 401, { error: 'Sign in first.' });

  if (pathname === '/api/me') {
    const groups = db.groups.filter((g) => g.memberIds.includes(me.id)).map(groupView);
    return send(res, 200, {
      me: { id: me.id, name: me.name, email: me.email || null, needsPassword: !!me.mustChangePassword },
      groups, demo: DEMO, createNeedsCode: !!CREATE_CODE,
      // Only leaders need to know; they're the ones who can fix hosting.
      storageWarning: STORAGE_TEMPORARY && db.groups.some((g) => g.leaderId === me.id),
      sportsbooks: SPORTSBOOKS.map(({ key, title }) => ({ key, title })),
    });
  }

  if (pathname === '/api/me/password' && req.method === 'POST') {
    const { current, password } = await readBody(req);
    // Moving off an old PIN happens right after a correct sign-in, so no current password needed then.
    if (!me.mustChangePassword && hashPin(String(current || ''), me.salt) !== me.pinHash) {
      noteBadPin(me);
      return send(res, 403, { error: 'Your current password is wrong.' });
    }
    const problem = passwordProblem(password);
    if (problem) return send(res, 400, { error: problem });
    me.salt = newId();
    me.pinHash = hashPin(password, me.salt);
    delete me.mustChangePassword;
    // Sign out other devices, keep this one.
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    for (const [t, mid] of Object.entries(db.sessions)) if (mid === me.id && t !== token) delete db.sessions[t];
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/me/email' && req.method === 'POST') {
    const cleanEmail = normalizeEmail((await readBody(req)).email);
    if (!validEmail(cleanEmail)) return send(res, 400, { error: 'Enter a valid email address.' });
    const owner = memberByEmail(cleanEmail);
    if (owner && owner.id !== me.id) return send(res, 409, { error: 'That email is already on another account.' });
    me.email = cleanEmail;
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/push/key' && req.method === 'GET') {
    return send(res, 200, { publicKey: PUSH_PUBLIC_KEY });
  }

  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    if (!PUSH_PUBLIC_KEY) return send(res, 503, { error: "Notifications aren't available on this server yet." });
    const { subscription } = await readBody(req);
    if (!validSubscription(subscription)) return send(res, 400, { error: "Your browser sent a notification setup we can't use. Try again." });
    const sub = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, addedAt: new Date().toISOString() };
    // One device = one account: if someone else signed in here before, stop sending them this device's alerts.
    for (const m of db.members) if (m.pushSubs) m.pushSubs = m.pushSubs.filter((s) => s.endpoint !== sub.endpoint);
    me.pushSubs = [...(me.pushSubs || []), sub].slice(-10);
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    const { endpoint } = await readBody(req);
    me.pushSubs = (me.pushSubs || []).filter((s) => s.endpoint !== endpoint);
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/push/test' && req.method === 'POST') {
    if (!(me.pushSubs || []).length) return send(res, 400, { error: 'Turn on notifications first.' });
    await pushTo([me.id], { title: 'Parlay Room', body: "Notifications are working. You'll hear about new legs here.", url: '/', tag: 'test' });
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/groups' && req.method === 'POST') {
    const { name, createCode } = await readBody(req);
    const cleanName = String(name || '').trim().slice(0, 32);
    if (!cleanName) return send(res, 400, { error: 'Give the group a name.' });
    if (CREATE_CODE && createCode !== CREATE_CODE) return fail(403, 'That create code is wrong.');
    const g = {
      id: newId(), name: cleanName, code: newInviteCode(), leaderId: me.id,
      memberIds: [me.id], slips: [newSlip('Main slip', me.id)], sportsbook: SPORTSBOOKS[0].key, createdAt: new Date().toISOString(),
    };
    db.groups.push(g);
    save();
    return send(res, 201, { group: groupView(g) });
  }

  if (pathname === '/api/groups/join' && req.method === 'POST') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const { code } = await readBody(req);
    const g = db.groups.find((x) => x.code === String(code || '').trim().toUpperCase());
    if (!g) return fail(404, 'No group has that invite code. Check it with your group leader.');
    failedJoins.delete(ip);
    if ((g.bannedIds || []).includes(me.id)) {
      return send(res, 403, { error: 'The group leader removed you from this group. Ask them to let you back in.' });
    }
    if (!g.memberIds.includes(me.id)) g.memberIds.push(me.id);
    save();
    notifyGroup(g.id, 'members');
    return send(res, 200, { group: groupView(g) });
  }

  // Everything below is scoped to one group the viewer belongs to.
  const gm = pathname.match(/^\/api\/groups\/([\w-]+)(\/.*)?$/);
  const group = gm && db.groups.find((g) => g.id === gm[1]);
  if (gm && (!group || !group.memberIds.includes(me.id))) return send(res, 404, { error: "You're not in that group." });
  const sub = gm ? gm[2] || '' : null;
  const isLeader = group && group.leaderId === me.id;

  if (group && sub === '/live-ticket' && req.method === 'POST') {
    const ticket = crypto.randomBytes(18).toString('base64url');
    liveTickets.set(ticket, { memberId: me.id, groupId: group.id, expires: Date.now() + 60 * 1000 });
    return send(res, 200, { ticket });
  }

  if (group && sub === '/leave' && req.method === 'POST') {
    if (isLeader && group.memberIds.length > 1) {
      return send(res, 409, { error: 'Make someone else leader before you leave.' });
    }
    group.memberIds = group.memberIds.filter((id) => id !== me.id);
    group.editorIds = (group.editorIds || []).filter((id) => id !== me.id);
    if (!group.memberIds.length) db.groups = db.groups.filter((g) => g.id !== group.id);
    save();
    dropFromLive(group.id, me.id);
    notifyGroup(group.id, 'members');
    return send(res, 200, { ok: true });
  }

  if (group && sub === '/leader' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can hand off leadership.' });
    const { memberId } = await readBody(req);
    if (!group.memberIds.includes(memberId)) return send(res, 400, { error: "That person isn't in this group." });
    // The old leader keeps editing rights; the new leader doesn't need an editor spot.
    group.editorIds = [...new Set([...(group.editorIds || []).filter((id) => id !== memberId), me.id])];
    group.leaderId = memberId;
    save();
    notifyGroup(group.id, 'members');
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/sportsbook' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can change the sportsbook.' });
    const { sportsbook } = await readBody(req);
    if (!SPORTSBOOKS.some((b) => b.key === sportsbook)) return send(res, 400, { error: 'That sportsbook isn’t supported yet.' });
    group.sportsbook = sportsbook;
    save();
    notifyGroup(group.id, 'settings');
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/code' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can change the invite code.' });
    const { code } = await readBody(req);
    if (code == null || code === '') {
      group.code = newInviteCode();
    } else {
      const clean = String(code).trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(clean)) return send(res, 400, { error: 'Codes are 4–12 letters or numbers, no spaces.' });
      if (db.groups.some((g) => g.id !== group.id && g.code === clean)) {
        return send(res, 409, { error: 'Another group already uses that code. Try a different one.' });
      }
      group.code = clean;
    }
    save();
    notifyGroup(group.id, 'settings');
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/lock' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can lock or unlock the group.' });
    group.locked = !!(await readBody(req)).locked;
    save();
    notifyGroup(group.id, 'settings');
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/editors' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can choose editors.' });
    const { memberId, editor } = await readBody(req);
    if (!group.memberIds.includes(memberId)) return send(res, 404, { error: "That person isn't in this group." });
    if (memberId === group.leaderId) return send(res, 400, { error: 'The leader can always edit.' });
    const set = new Set(group.editorIds || []);
    if (editor) set.add(memberId); else set.delete(memberId);
    group.editorIds = [...set];
    save();
    notifyGroup(group.id, 'settings');
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/kick' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can remove people.' });
    const { memberId } = await readBody(req);
    if (memberId === me.id) return send(res, 400, { error: "You can't remove yourself. Use Leave group instead." });
    if (!group.memberIds.includes(memberId)) return send(res, 404, { error: "That person isn't in this group." });
    group.memberIds = group.memberIds.filter((id) => id !== memberId);
    group.editorIds = (group.editorIds || []).filter((id) => id !== memberId);
    group.bannedIds = [...new Set([...(group.bannedIds || []), memberId])];
    save();
    notifyGroup(group.id, 'members'); // the removed person's screen hears this too, then gets sent back to their groups
    dropFromLive(group.id, memberId);
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/unban' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can let people back in.' });
    const { memberId } = await readBody(req);
    group.bannedIds = (group.bannedIds || []).filter((id) => id !== memberId);
    save();
    notifyGroup(group.id, 'members');
    return send(res, 200, { group: groupView(group) });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    delete db.sessions[token];
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/sports') {
    let active = null;
    if (!DEMO) {
      try { active = new Set((await oddsApi('/sports', {}, 3600)).map((s) => s.key)); } catch { active = null; }
    }
    const sports = SPORTS.filter((s) => (DEMO ? demoSports.has(s.key) : !active || active.has(s.key)));
    return send(res, 200, { sports, demo: DEMO });
  }

  if (pathname === '/api/events') {
    const sport = url.searchParams.get('sport');
    if (!sportByKey(sport)) return send(res, 400, { error: 'Unknown sport.' });
    return send(res, 200, { events: await listEvents(sport) });
  }

  if (pathname === '/api/props') {
    const sport = url.searchParams.get('sport');
    const event = url.searchParams.get('event');
    const market = url.searchParams.get('market');
    if (!sportByKey(sport) || !event || !market) return send(res, 400, { error: 'Pick a sport, game and market.' });
    return send(res, 200, { ...(await getProps(sport, event, market)), quota });
  }

  // ---- Slips: every group has one or more named slips, each with its own legs and Place bet.

  // Everything the slip screen needs, in one call.
  if (group && sub === '/slips' && req.method === 'GET') {
    if (url.searchParams.get('fresh') === '1') await refreshLegOdds(group);
    return send(res, 200, {
      group: groupView(group),
      slips: group.slips.map((s) => {
        const slipLink = parlayLink(s.legs.filter((l) => !l.unavailable));
        return {
          ...s,
          // Place bet: load the whole slip when every leg has a betslip link, else open the book.
          placeBet: { url: slipLink || bookFor(group).home, loadsSlip: !!slipLink },
        };
      }),
      quota,
      demo: DEMO,
      at: new Date().toISOString(),
    });
  }

  const slipNameProblem = (name, exceptId) => {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return { error: 'Give the slip a name.' };
    if (clean.length > 32) return { error: 'Slip names can be up to 32 characters.' };
    if (group.slips.some((s) => s.id !== exceptId && s.name.toLowerCase() === clean.toLowerCase())) {
      return { error: 'This group already has a slip with that name.' };
    }
    return { clean };
  };

  if (group && sub === '/slips' && req.method === 'POST') {
    if (!canEditGroup(group, me.id)) return send(res, 403, { error: LOCKED_MSG });
    if (group.slips.length >= 20) return send(res, 400, { error: 'A group can have up to 20 slips. Delete one first.' });
    const { error, clean } = slipNameProblem((await readBody(req)).name);
    if (error) return send(res, 400, { error });
    const slip = newSlip(clean, me.id);
    group.slips.push(slip);
    save();
    notifyGroup(group.id, 'slips');
    return send(res, 201, { slip });
  }

  const slipMatch = group && sub.match(/^\/slips\/([\w-]+)(\/.*)?$/);
  const slip = slipMatch && group.slips.find((s) => s.id === slipMatch[1]);
  if (slipMatch && !slip) return send(res, 404, { error: 'That slip was deleted. Pick another one.' });
  const slipSub = slipMatch ? slipMatch[2] || '' : null;
  const canManageSlip = slip && (group.locked
    ? isGroupEditor(group, me.id)
    : slip.createdBy === me.id || isLeader);
  const slipDenied = (verb) => (group.locked ? LOCKED_MSG : `Only the person who made this slip or the group leader can ${verb} it.`);

  // Rename
  if (slip && slipSub === '' && req.method === 'PATCH') {
    if (!canManageSlip) return send(res, 403, { error: slipDenied('rename') });
    const { error, clean } = slipNameProblem((await readBody(req)).name, slip.id);
    if (error) return send(res, 400, { error });
    slip.name = clean;
    save();
    notifyGroup(group.id, 'slips');
    return send(res, 200, { slip });
  }

  // Delete the whole slip
  if (slip && slipSub === '' && req.method === 'DELETE') {
    if (!canManageSlip) return send(res, 403, { error: slipDenied('delete') });
    if (group.slips.length === 1) return send(res, 400, { error: "This is the group's only slip. Clear it instead." });
    group.slips = group.slips.filter((s) => s.id !== slip.id);
    save();
    notifyGroup(group.id, 'slips');
    return send(res, 200, { ok: true });
  }

  // Add a leg to this slip
  if (slip && slipSub === '/legs' && req.method === 'POST') {
    if (!canEditGroup(group, me.id)) return send(res, 403, { error: LOCKED_MSG });
    const { sport, eventId, market, key, note } = await readBody(req);
    if (!sportByKey(sport)) return send(res, 400, { error: 'Unknown sport.' });
    const props = await getProps(sport, eventId, market);
    const o = props.outcomes.find((x) => x.key === key);
    if (!o) return send(res, 404, { error: 'FanDuel no longer offers that line. Refresh and try again.' });
    if (slip.legs.some((l) => l.eventId === eventId && l.market === market && l.key === key)) {
      return send(res, 409, { error: `That leg is already on ${slip.name}.` });
    }
    const leg = {
      id: newId(),
      sport, sportTitle: sportByKey(sport).title,
      eventId, eventName: props.event.name, commence: props.event.commence,
      market, marketLabel: props.marketLabel,
      key, label: o.label, player: o.player, side: o.side, point: o.point,
      price: o.price, priceAtAdd: o.price,
      link: o.link, sid: o.sid, marketSid: o.marketSid,
      note: String(note || '').trim().slice(0, 140),
      addedBy: me.id, addedAt: new Date().toISOString(),
      oddsAt: new Date().toISOString(), unavailable: false,
    };
    slip.legs.push(leg);
    save();
    notifyGroup(group.id, 'legs');
    // Ping everyone else's phone. Don't make the adder wait for it.
    // Name the market unless the line already says it ("Bills ML", "Bills -3.5", "Over 46.5").
    const plain = ['h2h', 'spreads', 'totals'].includes(leg.market);
    const what = plain ? leg.label : `${leg.label} ${leg.marketLabel}`;
    pushTo(group.memberIds.filter((id) => id !== me.id), {
      title: group.name,
      body: `${me.name} added ${what} to ${slip.name} (${fmtOdds(leg.price)})`,
      url: `/?g=${group.id}&s=${slip.id}`,
      tag: `leg-${leg.id}`,
    }).catch((err) => console.error('Notification send failed:', err.message));
    return send(res, 201, { leg });
  }

  // Clear every leg off this slip
  if (slip && slipSub === '/legs' && req.method === 'DELETE') {
    if (!canManageSlip) return send(res, 403, { error: slipDenied('clear') });
    slip.legs = [];
    save();
    notifyGroup(group.id, 'legs');
    return send(res, 200, { ok: true });
  }

  const legMatch = slip && slipSub.match(/^\/legs\/([\w-]+)(\/move)?$/);
  const leg = legMatch && slip.legs.find((l) => l.id === legMatch[1]);
  if (legMatch && !leg) return send(res, 404, { error: 'That leg was already removed or moved.' });
  const canManageLeg = leg && (group.locked
    ? isGroupEditor(group, me.id)
    : leg.addedBy === me.id || isLeader);
  const legDenied = (verb) => (group.locked ? LOCKED_MSG : `Only the person who added this leg or the group leader can ${verb} it.`);

  // Remove one leg
  if (leg && !legMatch[2] && req.method === 'DELETE') {
    if (!canManageLeg) return send(res, 403, { error: legDenied('remove') });
    slip.legs = slip.legs.filter((l) => l.id !== leg.id);
    save();
    notifyGroup(group.id, 'legs');
    return send(res, 200, { ok: true });
  }

  // Move one leg to another slip
  if (leg && legMatch[2] && req.method === 'POST') {
    if (!canManageLeg) return send(res, 403, { error: legDenied('move') });
    const { toSlipId } = await readBody(req);
    const target = group.slips.find((s) => s.id === toSlipId);
    if (!target) return send(res, 404, { error: "That slip doesn't exist anymore." });
    if (target.id === slip.id) return send(res, 400, { error: `It's already on ${slip.name}.` });
    if (target.legs.some((l) => l.eventId === leg.eventId && l.market === leg.market && l.key === leg.key)) {
      return send(res, 409, { error: `${target.name} already has that leg.` });
    }
    slip.legs = slip.legs.filter((l) => l.id !== leg.id);
    target.legs.push(leg);
    save();
    notifyGroup(group.id, 'legs');
    return send(res, 200, { ok: true, to: target.name });
  }

  return send(res, 404, { error: 'Not found' });
}

// Re-price every leg on every slip from FanDuel. One API call per unique game+market (cached),
// so the same prop on three slips still costs one call.
async function refreshLegOdds(group) {
  const groups = new Map();
  for (const leg of group.slips.flatMap((s) => s.legs)) {
    const k = `${leg.sport}|${leg.eventId}|${leg.market}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(leg);
  }
  let changed = false;
  await Promise.all([...groups.values()].map(async (legs) => {
    const { sport, eventId, market } = legs[0];
    let props;
    try { props = await getProps(sport, eventId, market); } catch { return; }
    for (const leg of legs) {
      const o = props.outcomes.find((x) => x.key === leg.key);
      if (!o) { if (!leg.unavailable) { leg.unavailable = true; changed = true; } continue; }
      if (o.price !== leg.price || leg.unavailable || o.link !== leg.link) changed = true;
      Object.assign(leg, { price: o.price, link: o.link, sid: o.sid, marketSid: o.marketSid, unavailable: false, oddsAt: new Date().toISOString() });
    }
  }));
  if (changed) {
    save();
    notifyGroup(group.id, 'odds');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return send(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
  }
}).listen(PORT, () => {
  console.log(`Parlay Room running at http://localhost:${PORT}`);
  if (DEMO) console.log('No ODDS_API_KEY set — using demo odds.');
  console.log(`Saving data to ${DATA_FILE} (${db.members.length} accounts, ${db.groups.length} groups loaded).`);
  if (STORAGE_TEMPORARY) {
    console.warn('WARNING: No Railway volume is attached. Accounts, passwords and groups will be ERASED on every update or restart. Attach a volume to this service (any mount path, e.g. /data).');
  }
});

// ---------------------------------------------------------------- helpers

function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------------------------------------------------------------- demo data (used when no API key)

const demoSports = new Set(['americanfootball_nfl', 'basketball_wnba', 'baseball_mlb']);
const DEMO_GAMES = {
  americanfootball_nfl: [
    { id: 'demo-nfl-1', away: 'Buffalo Bills', home: 'Miami Dolphins', hours: 50,
      players: { QB: ['Josh Allen', 'Tua Tagovailoa'], RB: ['James Cook', "De'Von Achane"], WR: ['Khalil Shakir', 'Tyreek Hill', 'Jaylen Waddle'] } },
    { id: 'demo-nfl-2', away: 'Kansas City Chiefs', home: 'Baltimore Ravens', hours: 74,
      players: { QB: ['Patrick Mahomes', 'Lamar Jackson'], RB: ['Isiah Pacheco', 'Derrick Henry'], WR: ['Travis Kelce', 'Zay Flowers', 'Mark Andrews'] } },
  ],
  basketball_wnba: [
    { id: 'demo-wnba-1', away: 'New York Liberty', home: 'Las Vegas Aces', hours: 28,
      players: { G: ['Sabrina Ionescu', "Jackie Young", 'Chelsea Gray'], F: ["Breanna Stewart", "A'ja Wilson", 'Jonquel Jones'] } },
  ],
  baseball_mlb: [
    { id: 'demo-mlb-1', away: 'New York Yankees', home: 'Boston Red Sox', hours: 6,
      players: { B: ['Aaron Judge', 'Juan Soto', 'Rafael Devers', 'Jarren Duran'], P: ['Gerrit Cole', 'Brayan Bello'] } },
  ],
};

function demoEvents(sport) {
  return (DEMO_GAMES[sport] || []).map((g) => ({
    id: g.id, away: g.away, home: g.home,
    commence: new Date(Math.ceil(Date.now() / 3.6e6) * 3.6e6 + g.hours * 3.6e6).toISOString(),
  }));
}

function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// Demo lines for the extra markets (First TD, alt spreads, team totals, 1H, F5, NRFI...), shaped like real data.
function demoExtraMarket(g, market, players) {
  const long = (who, lo, hi) => am(Math.round((lo + seeded(who + market) * (hi - lo)) / 10) * 10);
  // Turn a smooth "edge" number into valid American odds (nothing between -100 and +100).
  const am = (v) => Math.round(v >= 0 ? 100 + v : -100 + v);
  const juice = (x) => Math.round(-125 + seeded(x + market) * 20); // -125 to -105
  const fullGame = g.id.includes('mlb') ? 8 : g.id.includes('wnba') ? 160 : 46; // runs / points
  const scale = market.includes('_q1') || market.endsWith('_p1') ? 0.25
    : market.includes('_h1') || market.includes('_1st_5_') ? 0.5 : 1;
  const total = market.includes('_1st_1_innings') ? 0.5 : Math.round(fullGame * scale) + 0.5;
  if (/_1st_td|_last_td|first_basket|goal_scorer_first|first_home_run/.test(market)) {
    return players.map((p) => ({ name: 'Yes', description: p, price: long(p, 550, 1800) }));
  }
  if (/double_double|triple_double/.test(market)) {
    return players.map((p) => ({ name: 'Yes', description: p, price: market.includes('triple') ? long(p, 800, 3000) : long(p, -150, 400) }));
  }
  if (market === 'player_tds_over') {
    return players.map((p) => ({ name: 'Over', description: p, point: 1.5, price: long(p, 400, 1200) }));
  }
  if (market.startsWith('player_') || market.startsWith('batter_') || market.startsWith('pitcher_')) {
    return players.flatMap((p) => {
      const line = Math.round(5 + seeded(p + market) * 60) + 0.5;
      return [{ name: 'Over', description: p, point: line, price: juice(p) }, { name: 'Under', description: p, point: line, price: juice(p + 'u') }];
    });
  }
  if (market.startsWith('alternate_team_totals') || market.startsWith('team_totals')) {
    const alt = market.startsWith('alternate');
    return [g.away, g.home].flatMap((team, i) => {
      const base = Math.round((total / 2) + (i ? 1 : -1) * total * 0.03) + 0.5;
      const spreadOut = Math.max(1, Math.round(total * 0.08));
      const lines = alt ? [base - 2 * spreadOut, base - spreadOut, base + spreadOut, base + 2 * spreadOut] : [base];
      return lines.flatMap((pt) => [
        { name: 'Over', description: team, point: pt, price: alt ? am((pt - base) / spreadOut * 90 - 10) : juice(team) },
        { name: 'Under', description: team, point: pt, price: alt ? am((base - pt) / spreadOut * 90 - 10) : juice(team + 'u') },
      ]);
    });
  }
  if (market.startsWith('alternate_spreads')) {
    // Laying more points pays more: -13.5 is plus money, +13.5 is a heavy favorite.
    const step = g.id.includes('mlb') ? 0.25 : 1;
    return [-13.5, -9.5, -6.5, -2.5, 2.5, 6.5, 9.5, 13.5].flatMap((pt) => [
      { name: g.home, point: Math.round(pt * step * 2) / 2 || 0.5, price: am(-pt * 25 - 10) },
      { name: g.away, point: -(Math.round(pt * step * 2) / 2 || 0.5), price: am(pt * 25 - 10) },
    ]);
  }
  if (market.startsWith('alternate_totals')) {
    const step = g.id.includes('mlb') ? 0.2 : scale;
    return [-10, -6, -3, 3, 6, 10].map((d) => Math.round(total + d * step) + 0.5).flatMap((pt) => [
      { name: 'Over', point: pt, price: am((pt - total) / step * 22 - 10) },
      { name: 'Under', point: pt, price: am((total - pt) / step * 22 - 10) },
    ]);
  }
  if (market.startsWith('h2h')) return [{ name: g.away, price: 130 }, { name: g.home, price: -155 }];
  if (market.startsWith('spreads')) {
    const pt = Math.max(0.5, Math.round(3 * scale) + 0.5);
    return [{ name: g.away, point: pt, price: -110 }, { name: g.home, point: -pt, price: -110 }];
  }
  if (market.startsWith('totals')) {
    return [{ name: 'Over', point: total, price: juice('o') }, { name: 'Under', point: total, price: juice('u') }];
  }
  return [];
}

function demoOdds(sport, eventId, market) {
  const g = (DEMO_GAMES[sport] || []).find((x) => x.id === eventId);
  if (!g) throw Object.assign(new Error('Game not found.'), { status: 404 });
  const ev = demoEvents(sport).find((e) => e.id === eventId);
  const price = (seed) => { const p = Math.round((-135 + seed * 45) / 5) * 5; return p > -100 ? 100 + (p + 100) : p; };
  const ou = (who, line) => {
    const s = seeded(who + market);
    return [
      { name: 'Over', description: who, point: line, price: price(s) },
      { name: 'Under', description: who, point: line, price: price(1 - s) },
    ];
  };
  const line = (who, base, spread, step = 0.5) =>
    Math.round((base + (seeded(who + market + 'l') - 0.5) * spread) / step) * step + (step === 1 ? 0.5 : 0);
  const P = g.players;
  let outcomes = [];
  switch (market) {
    case 'player_pass_yds': outcomes = P.QB.flatMap((p) => ou(p, line(p, 235, 50, 1))); break;
    case 'player_pass_tds': outcomes = P.QB.flatMap((p) => ou(p, 1.5)); break;
    case 'player_rush_yds': outcomes = [...P.RB, P.QB[1]].flatMap((p) => ou(p, line(p, 58, 40, 1))); break;
    case 'player_reception_yds': outcomes = P.WR.flatMap((p) => ou(p, line(p, 55, 30, 1))); break;
    case 'player_receptions': outcomes = P.WR.flatMap((p) => ou(p, line(p, 4.5, 3, 1))); break;
    case 'player_anytime_td': outcomes = [...P.RB, ...P.WR].map((p) => ({ name: 'Yes', description: p, price: 100 + Math.round(seeded(p) * 180 / 10) * 10 })); break;
    case 'player_points': outcomes = [...P.G, ...P.F].flatMap((p) => ou(p, line(p, 18, 10, 1))); break;
    case 'player_rebounds': outcomes = [...P.G, ...P.F].flatMap((p) => ou(p, line(p, 6, 5, 1))); break;
    case 'player_assists': outcomes = [...P.G, ...P.F].flatMap((p) => ou(p, line(p, 4, 4, 1))); break;
    case 'player_threes': outcomes = [...P.G, ...P.F].flatMap((p) => ou(p, 1.5)); break;
    case 'player_points_rebounds_assists': outcomes = [...P.G, ...P.F].flatMap((p) => ou(p, line(p, 28, 12, 1))); break;
    case 'batter_hits': outcomes = P.B.flatMap((p) => ou(p, 0.5)); break;
    case 'batter_total_bases': outcomes = P.B.flatMap((p) => ou(p, 1.5)); break;
    case 'batter_home_runs': {
      // Like real FanDuel data: home runs only arrive as milestone lines in the alternate market.
      const hr = P.B.flatMap((p) => {
        const one = 250 + Math.round(seeded(p) * 250 / 10) * 10;
        return [
          { name: 'Over', description: p, point: 0.5, price: one },
          { name: 'Over', description: p, point: 1.5, price: one * 4 + 500 },
        ];
      });
      return {
        id: g.id, home_team: g.home, away_team: g.away, commence_time: ev.commence,
        bookmakers: [{ key: 'fanduel', markets: [{ key: 'batter_home_runs_alternate', last_update: new Date().toISOString(), outcomes: hr }] }],
      };
    }
    case 'batter_rbis': outcomes = P.B.flatMap((p) => ou(p, 0.5)); break;
    case 'batter_hits_runs_rbis': outcomes = P.B.flatMap((p) => ou(p, 1.5)); break;
    case 'pitcher_strikeouts': outcomes = P.P.flatMap((p) => ou(p, line(p, 6, 3, 1))); break;
    case 'h2h': outcomes = [{ name: g.away, price: 125 }, { name: g.home, price: -148 }]; break;
    case 'spreads': outcomes = [{ name: g.away, point: 2.5, price: -110 }, { name: g.home, point: -2.5, price: -110 }]; break;
    case 'totals': outcomes = [{ name: 'Over', point: 46.5, price: -108 }, { name: 'Under', point: 46.5, price: -112 }]; break;
  }
  if (!outcomes.length) outcomes = demoExtraMarket(g, market, Object.values(P).flat());
  return {
    id: g.id, home_team: g.home, away_team: g.away, commence_time: ev.commence,
    bookmakers: [{ key: 'fanduel', markets: [{ key: market, last_update: new Date().toISOString(), outcomes }] }],
  };
}
