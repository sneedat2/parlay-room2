// Parlay Room — a shared FanDuel prop board for a small betting group.
// Zero dependencies: needs Node 18+ (built-in fetch). Run with `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ODDS_API_KEY || '';
// Optional: if set, creating a new group requires this code (keeps strangers off your API credits).
const CREATE_CODE = process.env.GROUP_CREATE_CODE || '';
const FANDUEL_STATE = (process.env.FANDUEL_STATE || '').toLowerCase();
const CACHE_SECONDS = Number(process.env.ODDS_CACHE_SECONDS) || 120;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEMO = !API_KEY;

// ---------------------------------------------------------------- sports & markets

const GAME_MARKETS = [
  { key: 'h2h', label: 'Moneyline' },
  { key: 'spreads', label: 'Spread' },
  { key: 'totals', label: 'Total' },
];
const FOOTBALL_PROPS = [
  { key: 'player_pass_yds', label: 'Pass Yds' },
  { key: 'player_pass_tds', label: 'Pass TDs' },
  { key: 'player_rush_yds', label: 'Rush Yds' },
  { key: 'player_reception_yds', label: 'Rec Yds' },
  { key: 'player_receptions', label: 'Receptions' },
  { key: 'player_anytime_td', label: 'Anytime TD' },
];
const BASKETBALL_PROPS = [
  { key: 'player_points', label: 'Points' },
  { key: 'player_rebounds', label: 'Rebounds' },
  { key: 'player_assists', label: 'Assists' },
  { key: 'player_threes', label: 'Threes' },
  { key: 'player_points_rebounds_assists', label: 'PRA' },
];
const SPORTS = [
  { key: 'americanfootball_nfl', title: 'NFL', markets: [...FOOTBALL_PROPS, ...GAME_MARKETS] },
  { key: 'americanfootball_ncaaf', title: 'NCAAF', markets: [...FOOTBALL_PROPS, ...GAME_MARKETS] },
  { key: 'basketball_nba', title: 'NBA', markets: [...BASKETBALL_PROPS, ...GAME_MARKETS] },
  { key: 'basketball_wnba', title: 'WNBA', markets: [...BASKETBALL_PROPS, ...GAME_MARKETS] },
  { key: 'basketball_ncaab', title: 'NCAAB', markets: [...BASKETBALL_PROPS, ...GAME_MARKETS] },
  {
    key: 'baseball_mlb', title: 'MLB', markets: [
      { key: 'batter_hits', label: 'Hits' },
      { key: 'batter_total_bases', label: 'Total Bases' },
      { key: 'batter_home_runs', label: 'Home Runs' },
      { key: 'batter_rbis', label: 'RBIs' },
      { key: 'batter_hits_runs_rbis', label: 'H+R+RBI' },
      { key: 'pitcher_strikeouts', label: 'Strikeouts' },
      ...GAME_MARKETS,
    ],
  },
  {
    key: 'icehockey_nhl', title: 'NHL', markets: [
      { key: 'player_goal_scorer_anytime', label: 'Anytime Goal' },
      { key: 'player_points', label: 'Points' },
      { key: 'player_shots_on_goal', label: 'Shots' },
      { key: 'player_assists', label: 'Assists' },
      ...GAME_MARKETS,
    ],
  },
];
const sportByKey = (k) => SPORTS.find((s) => s.key === k);

// Sportsbooks a group can bet with. Odds and betslip links currently come from FanDuel only.
const SPORTSBOOKS = [
  { key: 'fanduel', title: 'FanDuel', home: 'https://sportsbook.fanduel.com/' },
];
const bookFor = (g) => SPORTSBOOKS.find((b) => b.key === g.sportsbook) || SPORTSBOOKS[0];
const marketLabel = (sport, m) => sportByKey(sport)?.markets.find((x) => x.key === m)?.label || m;

// ---------------------------------------------------------------- storage

// members = accounts (name + PIN). Each group has its own leader, members and slip.
let db = { members: [], sessions: {}, groups: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch { /* first run */ }

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

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
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
  const members = g.memberIds
    .map((id) => db.members.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => ({ id: m.id, name: m.name, isLeader: m.id === g.leaderId }));
  const book = bookFor(g);
  return { id: g.id, name: g.name, code: g.code, leaderId: g.leaderId, members, sportsbook: { key: book.key, title: book.title } };
}

migrateSingleGroup();

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

function describeOutcome(market, o) {
  const pt = o.point == null ? '' : ` ${market === 'spreads' && o.point > 0 ? '+' : ''}${o.point}`;
  if (o.description) return `${o.description} ${o.name}${pt}`; // player props: description = player
  if (market === 'h2h') return `${o.name} ML`;
  return `${o.name}${pt}`;
}

async function getProps(sport, eventId, market) {
  const raw = DEMO
    ? demoOdds(sport, eventId, market)
    : await oddsApi(`/sports/${sport}/events/${eventId}/odds`, {
      regions: 'us',
      markets: market,
      bookmakers: 'fanduel',
      oddsFormat: 'american',
      includeLinks: 'true',
      includeSids: 'true',
    });
  const bk = (raw.bookmakers || []).find((b) => b.key === 'fanduel');
  const m = bk?.markets?.find((x) => x.key === market);
  const event = {
    id: raw.id, home: raw.home_team, away: raw.away_team, commence: raw.commence_time,
    name: `${raw.away_team} @ ${raw.home_team}`,
  };
  const outcomes = (m?.outcomes || []).map((o) => ({
    key: `${o.description || ''}|${o.name}|${o.point ?? ''}`,
    label: describeOutcome(market, o),
    player: o.description || null,
    side: o.name,
    point: o.point ?? null,
    price: o.price,
    link: fixLink(o.link) || fixLink(m.link) || null,
    sid: o.sid || null,
    marketSid: m.sid || null,
  }));
  return { event, market, marketLabel: marketLabel(sport, market), lastUpdate: m?.last_update || null, outcomes };
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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

  if (pathname === '/api/login' && req.method === 'POST') {
    if (tooManyTries()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
    const { name, pin } = await readBody(req);
    const cleanName = String(name || '').trim().slice(0, 24);
    if (!cleanName) return send(res, 400, { error: 'Enter a name.' });
    if (!/^\d{4,8}$/.test(String(pin || ''))) return send(res, 400, { error: 'PIN must be 4–8 digits.' });

    let member = db.members.find((m) => m.name.toLowerCase() === cleanName.toLowerCase());
    if (member) {
      if (hashPin(pin, member.salt) !== member.pinHash) return fail(403, `That PIN doesn't match ${member.name}. If that isn't you, pick another name.`);
    } else {
      const salt = newId();
      member = { id: newId(), name: cleanName, salt, pinHash: hashPin(pin, salt), joinedAt: new Date().toISOString() };
      db.members.push(member);
    }
    failedJoins.delete(ip);
    const token = crypto.randomBytes(24).toString('base64url');
    db.sessions[token] = member.id;
    save();
    return send(res, 200, { token });
  }

  const me = currentMember(req);
  if (!me) return send(res, 401, { error: 'Sign in first.' });

  if (pathname === '/api/me') {
    const groups = db.groups.filter((g) => g.memberIds.includes(me.id)).map(groupView);
    return send(res, 200, {
      me: { id: me.id, name: me.name }, groups, demo: DEMO, createNeedsCode: !!CREATE_CODE,
      sportsbooks: SPORTSBOOKS.map(({ key, title }) => ({ key, title })),
    });
  }

  if (pathname === '/api/groups' && req.method === 'POST') {
    const { name, createCode } = await readBody(req);
    const cleanName = String(name || '').trim().slice(0, 32);
    if (!cleanName) return send(res, 400, { error: 'Give the group a name.' });
    if (CREATE_CODE && createCode !== CREATE_CODE) return fail(403, 'That create code is wrong.');
    const g = {
      id: newId(), name: cleanName, code: newInviteCode(), leaderId: me.id,
      memberIds: [me.id], legs: [], sportsbook: SPORTSBOOKS[0].key, createdAt: new Date().toISOString(),
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
    if (!g.memberIds.includes(me.id)) g.memberIds.push(me.id);
    save();
    return send(res, 200, { group: groupView(g) });
  }

  // Everything below is scoped to one group the viewer belongs to.
  const gm = pathname.match(/^\/api\/groups\/([\w-]+)(\/.*)?$/);
  const group = gm && db.groups.find((g) => g.id === gm[1]);
  if (gm && (!group || !group.memberIds.includes(me.id))) return send(res, 404, { error: "You're not in that group." });
  const sub = gm ? gm[2] || '' : null;
  const isLeader = group && group.leaderId === me.id;

  if (group && sub === '/leave' && req.method === 'POST') {
    if (isLeader && group.memberIds.length > 1) {
      return send(res, 409, { error: 'Make someone else leader before you leave.' });
    }
    group.memberIds = group.memberIds.filter((id) => id !== me.id);
    if (!group.memberIds.length) db.groups = db.groups.filter((g) => g.id !== group.id);
    save();
    return send(res, 200, { ok: true });
  }

  if (group && sub === '/leader' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can hand off leadership.' });
    const { memberId } = await readBody(req);
    if (!group.memberIds.includes(memberId)) return send(res, 400, { error: "That person isn't in this group." });
    group.leaderId = memberId;
    save();
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/sportsbook' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can change the sportsbook.' });
    const { sportsbook } = await readBody(req);
    if (!SPORTSBOOKS.some((b) => b.key === sportsbook)) return send(res, 400, { error: 'That sportsbook isn’t supported yet.' });
    group.sportsbook = sportsbook;
    save();
    return send(res, 200, { group: groupView(group) });
  }

  if (group && sub === '/code' && req.method === 'POST') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can change the invite code.' });
    group.code = newInviteCode();
    save();
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

  if (group && sub === '/legs' && req.method === 'GET') {
    if (url.searchParams.get('fresh') === '1') await refreshLegOdds(group);
    const slipLink = parlayLink(group.legs.filter((l) => !l.unavailable));
    return send(res, 200, {
      group: groupView(group),
      legs: group.legs,
      // Place bet: load the whole slip when every leg has a betslip link, else open the book.
      placeBet: { url: slipLink || bookFor(group).home, loadsSlip: !!slipLink },
      quota,
      demo: DEMO,
      at: new Date().toISOString(),
    });
  }

  if (group && sub === '/legs' && req.method === 'POST') {
    const { sport, eventId, market, key, note } = await readBody(req);
    if (!sportByKey(sport)) return send(res, 400, { error: 'Unknown sport.' });
    const props = await getProps(sport, eventId, market);
    const o = props.outcomes.find((x) => x.key === key);
    if (!o) return send(res, 404, { error: 'FanDuel no longer offers that line. Refresh and try again.' });
    if (group.legs.some((l) => l.eventId === eventId && l.market === market && l.key === key)) {
      return send(res, 409, { error: 'That leg is already on the slip.' });
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
    group.legs.push(leg);
    save();
    return send(res, 201, { leg });
  }

  const legMatch = group && sub.match(/^\/legs\/([\w-]+)$/);
  if (legMatch && req.method === 'DELETE') {
    const leg = group.legs.find((l) => l.id === legMatch[1]);
    if (!leg) return send(res, 404, { error: 'That leg was already removed.' });
    if (leg.addedBy !== me.id && !isLeader) {
      return send(res, 403, { error: 'Only the person who added this leg or the group leader can remove it.' });
    }
    group.legs = group.legs.filter((l) => l.id !== leg.id);
    save();
    return send(res, 200, { ok: true });
  }

  if (group && sub === '/legs' && req.method === 'DELETE') {
    if (!isLeader) return send(res, 403, { error: 'Only the group leader can clear the slip.' });
    group.legs = [];
    save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}

// Re-price every leg from FanDuel. One API call per unique game+market (cached).
async function refreshLegOdds(group) {
  const groups = new Map();
  for (const leg of group.legs) {
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
  if (changed) save();
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
    case 'batter_home_runs': outcomes = P.B.map((p) => ({ name: 'Over', description: p, point: 0.5, price: 250 + Math.round(seeded(p) * 250 / 10) * 10 })); break;
    case 'batter_rbis': outcomes = P.B.flatMap((p) => ou(p, 0.5)); break;
    case 'batter_hits_runs_rbis': outcomes = P.B.flatMap((p) => ou(p, 1.5)); break;
    case 'pitcher_strikeouts': outcomes = P.P.flatMap((p) => ou(p, line(p, 6, 3, 1))); break;
    case 'h2h': outcomes = [{ name: g.away, price: 125 }, { name: g.home, price: -148 }]; break;
    case 'spreads': outcomes = [{ name: g.away, point: 2.5, price: -110 }, { name: g.home, point: -2.5, price: -110 }]; break;
    case 'totals': outcomes = [{ name: 'Over', point: 46.5, price: -108 }, { name: 'Under', point: 46.5, price: -112 }]; break;
  }
  return {
    id: g.id, home_team: g.home, away_team: g.away, commence_time: ev.commence,
    bookmakers: [{ key: 'fanduel', markets: [{ key: market, last_update: new Date().toISOString(), outcomes }] }],
  };
}
