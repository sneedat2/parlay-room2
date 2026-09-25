const $ = (s) => document.querySelector(s);
const state = {
  token: store('pr_token'),
  me: null,
  groups: [],
  groupId: store('pr_group'),
  group: null,
  legs: [],
  seenLegIds: new Set(),
  sports: [],
  sport: store('pr_sport'),
  events: [],
  event: null,
  market: null,
  props: null,
  createNeedsCode: false,
  sportsbooks: [],
};

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { return null; }
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token || ''}`, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the Parlay Room server. Make sure it's running (npm start), then reload.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { signOutLocal(); throw new Error(data.error || 'Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const groupApi = (sub, opts) => api(`/api/groups/${state.groupId}${sub}`, opts);

// ---------------------------------------------------------------- odds math & helpers

const fmtOdds = (p) => (p > 0 ? `+${p}` : `${p}`);
const toDecimal = (p) => (p > 0 ? 1 + p / 100 : 1 + 100 / -p);
function toAmerican(dec) {
  if (dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}

function showError(id, msg) {
  const e = $(id);
  e.textContent = msg || '';
  e.hidden = !msg;
}

function showScreen(name) {
  $('#login').hidden = name !== 'login';
  $('#groups').hidden = name !== 'groups';
  $('#app').hidden = name !== 'app';
}

// ---------------------------------------------------------------- sign in

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#login-error');
  try {
    const { token } = await api('/api/login', {
      method: 'POST',
      body: { name: $('#login-name').value, pin: $('#login-pin').value },
    });
    state.token = token;
    store('pr_token', token);
    boot();
  } catch (ex) { showError('#login-error', ex.message); }
});

$('#groups-logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  signOutLocal();
});

function signOutLocal() {
  Object.assign(state, { token: null, me: null, groups: [], group: null, groupId: null });
  store('pr_token', null);
  store('pr_group', null);
  clearInterval(poll);
  showScreen('login');
}

// ---------------------------------------------------------------- groups

async function loadMe() {
  const data = await api('/api/me');
  state.me = data.me;
  state.groups = data.groups;
  state.createNeedsCode = data.createNeedsCode;
  state.sportsbooks = data.sportsbooks;
  $('#demo-badge').hidden = !data.demo;
}

function showGroups() {
  clearInterval(poll);
  $('#groups-me').textContent = state.me.name;
  $('#create-code-wrap').hidden = !state.createNeedsCode;
  const list = $('#group-list');
  list.replaceChildren(...state.groups.map((g) => el('li', {},
    el('button', { class: 'group-item', type: 'button', onclick: () => openGroup(g.id) },
      el('span', { class: 'group-item-name' }, g.name),
      el('span', { class: 'muted small' },
        `${g.members.length} member${g.members.length === 1 ? '' : 's'}${g.leaderId === state.me.id ? ' · you lead' : ''}`)))));
  list.hidden = !state.groups.length;
  showScreen('groups');
}

$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#create-error');
  try {
    const { group } = await api('/api/groups', {
      method: 'POST', body: { name: $('#create-name').value, createCode: $('#create-code').value },
    });
    $('#create-name').value = '';
    await loadMe();
    openGroup(group.id, true);
    toast(`Created ${group.name}. Share invite code ${group.code}`);
  } catch (ex) { showError('#create-error', ex.message); }
});

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#join-error');
  try {
    const { group } = await api('/api/groups/join', { method: 'POST', body: { code: $('#join-code').value } });
    $('#join-code').value = '';
    await loadMe();
    openGroup(group.id);
    toast(`You're in ${group.name}`);
  } catch (ex) { showError('#join-error', ex.message); }
});

$('#switch-group').addEventListener('click', async () => {
  try { await loadMe(); } catch { /* keep what we have */ }
  showGroups();
});

function openGroup(id, showInvite = false) {
  const g = state.groups.find((x) => x.id === id);
  if (!g) return showGroups();
  state.groupId = id;
  state.group = g;
  state.legs = [];
  state.seenLegIds = new Set();
  store('pr_group', id);
  $('#group-info').open = showInvite;
  renderGroupHeader();
  showScreen('app');
  showTab(store('pr_tab') || 'slip');
  loadLegs(true);
  if (!state.sports.length) loadSports().catch((ex) => { $('#find-status').textContent = ex.message; });
  else if (state.props) renderOutcomes();
  clearInterval(poll);
  poll = setInterval(() => { if (!document.hidden) loadLegs(false); }, 20000);
}

const amLeader = () => !!(state.group && state.me && state.group.leaderId === state.me.id);

function renderGroupHeader() {
  const g = state.group;
  $('#group-name').textContent = g.name;
  $('#me-name').textContent = amLeader() ? `${state.me.name} (leader)` : state.me.name;
  $('#invite-code').textContent = g.code;
  $('#new-code').hidden = !amLeader();
  const bookSel = $('#book-select');
  bookSel.replaceChildren(...state.sportsbooks.map((b) => el('option', { value: b.key }, b.title)));
  bookSel.value = g.sportsbook.key;
  bookSel.disabled = !amLeader();
  bookSel.title = amLeader() ? '' : 'Only the group leader can change this';
  $('#member-count').textContent = `${g.members.length} member${g.members.length === 1 ? '' : 's'}`;
  $('#members').replaceChildren(...g.members.map((m) => el('li', { class: 'member' },
    el('span', {}, m.name, m.id === state.me.id ? el('span', { class: 'muted' }, ' (you)') : null),
    m.isLeader
      ? el('span', { class: 'pill leader' }, 'Leader')
      : amLeader()
        ? el('button', { class: 'link-btn', type: 'button', onclick: () => makeLeader(m) }, 'Make leader')
        : null)));
}

$('#book-select').addEventListener('change', async (e) => {
  try {
    const { group } = await groupApi('/sportsbook', { method: 'POST', body: { sportsbook: e.target.value } });
    state.group = group;
    loadLegs(false);
    toast(`Bets now go to ${group.sportsbook.title}`);
  } catch (ex) { toast(ex.message); renderGroupHeader(); }
});

$('#copy-code').addEventListener('click', async () => {
  const code = state.group?.code;
  try { await navigator.clipboard.writeText(code); toast('Invite code copied'); }
  catch { toast(`Invite code: ${code}`); }
});

$('#new-code').addEventListener('click', async () => {
  try {
    const { group } = await groupApi('/code', { method: 'POST' });
    state.group = group;
    renderGroupHeader();
    toast('New invite code made. The old one no longer works.');
  } catch (ex) { toast(ex.message); }
});

async function makeLeader(m) {
  try {
    const { group } = await groupApi('/leader', { method: 'POST', body: { memberId: m.id } });
    state.group = group;
    renderGroupHeader();
    loadLegs(false);
    toast(`${m.name} is now the leader`);
  } catch (ex) { toast(ex.message); }
}

$('#leave').addEventListener('click', () => { $('#leave').hidden = true; $('#leave-confirm').hidden = false; });
$('#leave-no').addEventListener('click', resetLeave);
$('#leave-yes').addEventListener('click', async () => {
  resetLeave();
  try {
    await groupApi('/leave', { method: 'POST' });
    store('pr_group', null);
    state.groupId = null;
    await loadMe();
    showGroups();
    toast('You left the group');
  } catch (ex) { toast(ex.message); }
});
function resetLeave() { $('#leave').hidden = false; $('#leave-confirm').hidden = true; }

// ---------------------------------------------------------------- tabs

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  store('pr_tab', name);
}

// ---------------------------------------------------------------- slip

async function loadLegs(fresh) {
  if (!state.groupId) return;
  const gid = state.groupId;
  const btn = $('#refresh');
  if (fresh) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  try {
    const data = await groupApi(`/legs${fresh ? '?fresh=1' : ''}`);
    if (gid !== state.groupId) return; // switched groups meanwhile
    state.legs = data.legs;
    state.group = data.group;
    renderGroupHeader();
    renderSlip(data);
    if (state.props) renderOutcomes();
  } catch (ex) {
    toast(ex.message);
    if (/not in that group/.test(ex.message)) { await loadMe().catch(() => {}); showGroups(); }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh odds';
  }
}

function renderSlip(data) {
  const legs = state.legs;
  const live = legs.filter((l) => !l.unavailable);
  const byId = Object.fromEntries(state.group.members.map((m) => [m.id, m]));
  $('#demo-badge').hidden = !data.demo;
  $('#tab-count').textContent = legs.length;

  if (live.length) {
    const dec = live.reduce((acc, l) => acc * toDecimal(l.price), 1);
    $('#parlay-odds').textContent = live.length === 1 ? fmtOdds(live[0].price) : fmtOdds(toAmerican(dec));
    const games = new Set(live.map((l) => l.eventId)).size;
    const sgp = live.length > games ? ' · same-game legs: FanDuel will reprice' : '';
    $('#parlay-sub').textContent = `${live.length}-leg${live.length > 1 ? ' parlay' : ''} · $10 pays $${(10 * dec).toFixed(2)}${sgp}`;
  } else {
    $('#parlay-odds').textContent = '—';
    $('#parlay-sub').textContent = 'No legs yet';
  }

  renderPlaceBet(data, live);

  const list = $('#legs');
  list.replaceChildren();
  if (!legs.length) {
    list.append(el('li', { class: 'empty' }, 'The slip is empty. Head to Find props and add the first leg.'));
  }
  const firstRender = state.seenLegIds.size === 0;
  for (const leg of legs) {
    const who = byId[leg.addedBy];
    const canRemove = leg.addedBy === state.me.id || amLeader();
    const moved = leg.price === leg.priceAtAdd ? null
      : el('span', { class: `move ${toDecimal(leg.price) > toDecimal(leg.priceAtAdd) ? 'up' : 'down'}` }, `was ${fmtOdds(leg.priceAtAdd)}`);
    const isNew = !firstRender && !state.seenLegIds.has(leg.id);
    state.seenLegIds.add(leg.id);

    list.append(el('li', { class: `leg${leg.unavailable ? ' gone' : ''}${isNew ? ' new' : ''}` },
      el('div', {},
        el('div', { class: 'leg-title' }, leg.label),
        el('div', { class: 'leg-meta' }, `${leg.marketLabel} · ${leg.sportTitle} · ${leg.eventName} · ${fmtTime(leg.commence)}`),
        leg.unavailable ? el('div', { class: 'leg-meta gone-note' }, 'FanDuel pulled this line') : null),
      el('div', {}, el('div', { class: 'leg-odds' }, fmtOdds(leg.price)), moved),
      leg.note ? el('p', { class: 'leg-note' }, `“${leg.note}”`) : null,
      el('div', { class: 'leg-foot' },
        el('span', { class: 'by' }, `${who ? who.name : 'Former member'} · ${ago(leg.addedAt)}`),
        el('span', { class: 'actions' },
          leg.link && !leg.unavailable
            ? el('a', { class: 'btn primary sm', href: leg.link, target: '_blank', rel: 'noopener' }, 'Bet in FanDuel')
            : null,
          canRemove ? el('button', { class: 'btn ghost sm', type: 'button', onclick: () => removeLeg(leg) }, 'Remove') : null))));
  }

  $('#updated').textContent = `Updated ${new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  $('#quota').textContent = data.quota && data.quota.remaining != null ? `${data.quota.remaining} API credits left` : '';
  if ($('#clear-confirm').hidden) $('#clear').hidden = !(amLeader() && legs.length);
}

function renderPlaceBet(data, live) {
  const book = state.group.sportsbook.title;
  const btn = $('#place-bet');
  const note = $('#place-bet-note');
  btn.textContent = `Place bet on ${book}`;
  if (!live.length) {
    btn.removeAttribute('href');
    btn.setAttribute('aria-disabled', 'true');
    note.hidden = true;
    return;
  }
  btn.href = data.placeBet.url;
  btn.removeAttribute('aria-disabled');
  note.hidden = false;
  if (data.placeBet.loadsSlip) {
    note.textContent = `Opens ${book} with ${live.length === 1 ? 'this leg' : `all ${live.length} legs`} in your betslip.`;
  } else if (data.demo) {
    note.textContent = `Demo odds have no betslip links, so this opens ${book} and you add the legs yourself. Add an Odds API key to load them automatically.`;
  } else {
    note.textContent = `Some legs have no betslip link, so this opens ${book} and you add those yourself.`;
  }
}

$('#place-bet').addEventListener('click', (e) => {
  if (!$('#place-bet').getAttribute('href')) { e.preventDefault(); toast('Add a leg to the slip first'); }
});

async function removeLeg(leg) {
  try {
    await groupApi(`/legs/${leg.id}`, { method: 'DELETE' });
    toast('Leg removed');
  } catch (ex) { toast(ex.message); }
  loadLegs(false);
}

$('#refresh').addEventListener('click', () => loadLegs(true));
$('#clear').addEventListener('click', () => { $('#clear').hidden = true; $('#clear-confirm').hidden = false; });
$('#clear-no').addEventListener('click', resetClear);
$('#clear-yes').addEventListener('click', async () => {
  try { await groupApi('/legs', { method: 'DELETE' }); toast('Slip cleared'); } catch (ex) { toast(ex.message); }
  resetClear();
  loadLegs(false);
});
function resetClear() { $('#clear').hidden = false; $('#clear-confirm').hidden = true; }

// ---------------------------------------------------------------- finder

async function loadSports() {
  const { sports } = await api('/api/sports');
  state.sports = sports;
  if (!sports.some((s) => s.key === state.sport)) state.sport = sports[0]?.key || null;
  renderSports();
  if (state.sport) selectSport(state.sport);
  else $('#find-status').textContent = 'No supported sports are in season right now.';
}

function renderSports() {
  $('#sports').replaceChildren(...state.sports.map((s) => el('button', {
    class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(s.key === state.sport),
    onclick: () => selectSport(s.key),
  }, s.title)));
}

async function selectSport(key) {
  state.sport = key;
  store('pr_sport', key);
  state.market = sportMarkets()[0]?.key;
  renderSports();
  renderMarkets();
  $('#find-status').textContent = 'Loading games…';
  $('#outcomes').replaceChildren();
  try {
    const { events } = await api(`/api/events?sport=${key}`);
    state.events = events;
    const sel = $('#event-select');
    sel.replaceChildren(...events.map((e) => el('option', { value: e.id }, `${e.away} @ ${e.home} — ${fmtTime(e.commence)}`)));
    if (!events.length) {
      state.event = null;
      state.props = null;
      $('#find-status').textContent = 'No upcoming games on FanDuel for this sport.';
      return;
    }
    state.event = events[0].id;
    loadProps();
  } catch (ex) {
    $('#find-status').textContent = ex.message;
  }
}

const sportMarkets = () => state.sports.find((s) => s.key === state.sport)?.markets || [];

function renderMarkets() {
  $('#markets').replaceChildren(...sportMarkets().map((m) => el('button', {
    class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(m.key === state.market),
    onclick: () => { state.market = m.key; renderMarkets(); loadProps(); },
  }, m.label)));
}

$('#event-select').addEventListener('change', (e) => { state.event = e.target.value; loadProps(); });
$('#search').addEventListener('input', () => renderOutcomes());

async function loadProps() {
  if (!state.event || !state.market) return;
  const want = `${state.event}|${state.market}`;
  $('#find-status').textContent = 'Loading FanDuel odds…';
  try {
    const props = await api(`/api/props?sport=${state.sport}&event=${encodeURIComponent(state.event)}&market=${state.market}`);
    if (want !== `${state.event}|${state.market}`) return; // user moved on
    state.props = { ...props, sport: state.sport };
    renderOutcomes();
  } catch (ex) {
    $('#find-status').textContent = ex.message;
    $('#outcomes').replaceChildren();
  }
}

function renderOutcomes() {
  const p = state.props;
  if (!p) return;
  const q = $('#search').value.trim().toLowerCase();
  const onSlip = new Set(state.legs.filter((l) => l.eventId === p.event.id && l.market === p.market).map((l) => l.key));
  const rows = p.outcomes.filter((o) => !q || o.label.toLowerCase().includes(q));

  const groups = new Map();
  for (const o of rows) {
    const g = o.player || p.marketLabel;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(o);
  }

  $('#find-status').textContent = !p.outcomes.length
    ? `FanDuel isn't offering ${p.marketLabel} for this game yet.`
    : `${rows.length} line${rows.length === 1 ? '' : 's'} · ${p.marketLabel}${p.lastUpdate ? ` · odds as of ${new Date(p.lastUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`;

  $('#outcomes').replaceChildren(...[...groups].map(([name, outs]) => el('li', { class: 'player-group' },
    el('div', { class: 'player-name' }, name),
    el('div', { class: 'options' }, outs.map((o) => {
      const added = onSlip.has(o.key);
      const sideText = o.player ? `${o.side}${o.point != null ? ` ${o.point}` : ''}` : o.label;
      return el('button', {
        class: `option${added ? ' added' : ''}`, type: 'button', disabled: added,
        'aria-label': `${added ? 'On slip: ' : 'Add '}${o.label} ${fmtOdds(o.price)}`,
        onclick: () => addLeg(o),
      }, el('span', { class: 'side' }, sideText), el('span', { class: 'price' }, fmtOdds(o.price)));
    })))));
}

async function addLeg(o) {
  const p = state.props;
  try {
    await groupApi('/legs', { method: 'POST', body: { sport: p.sport, eventId: p.event.id, market: p.market, key: o.key } });
    toast(`Added ${o.label}`);
  } catch (ex) { toast(ex.message); }
  loadLegs(false);
}

// ---------------------------------------------------------------- boot

let poll;
async function boot() {
  try {
    await loadMe();
  } catch (ex) {
    if (state.token) { showScreen('login'); showError('#login-error', ex.message); }
    return;
  }
  if (state.groupId && state.groups.some((g) => g.id === state.groupId)) openGroup(state.groupId);
  else if (state.groups.length === 1) openGroup(state.groups[0].id);
  else showGroups();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.groupId && !$('#app').hidden) loadLegs(false); });

if (state.token) boot(); else showScreen('login');
