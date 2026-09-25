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
  for (const s of ['login', 'add-email', 'set-password', 'groups', 'app']) $(`#${s}`).hidden = s !== name;
}

document.querySelectorAll('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
  const input = b.previousElementSibling;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.textContent = show ? 'Hide' : 'Show';
  b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}));

// ---------------------------------------------------------------- invite links (/join/CODE)

const inviteFromPath = location.pathname.match(/^\/join\/([A-Za-z0-9]{4,12})\/?$/);
if (inviteFromPath) {
  store('pr_invite', inviteFromPath[1].toUpperCase());
  history.replaceState(null, '', '/');
}
const inviteLink = (code) => `${location.origin}/join/${code}`;

async function showInviteBanner() {
  const code = store('pr_invite');
  $('#invite-banner').hidden = true;
  if (!code) return;
  try {
    const { name, members } = await api(`/api/invite/${code}`);
    $('#invite-banner-text').textContent =
      `Join ${name} (${members} member${members === 1 ? '' : 's'}). Sign in or create an account and you'll be added.`;
  } catch (ex) {
    $('#invite-banner-text').textContent = ex.message;
    store('pr_invite', null);
  }
  $('#invite-banner').hidden = false;
}

async function acceptInvite() {
  const code = store('pr_invite');
  store('pr_invite', null);
  try {
    const { group } = await api('/api/groups/join', { method: 'POST', body: { code } });
    await loadMe();
    openGroup(group.id);
    toast(`You're in ${group.name}`);
    return true;
  } catch (ex) {
    toast(ex.message);
    return false;
  }
}

// ---------------------------------------------------------------- sign in / sign up / reset

const AUTH_FORMS = ['signin', 'signup', 'forgot', 'reset'];
function showAuth(which) {
  for (const f of AUTH_FORMS) {
    $(`#${f}-form`).hidden = f !== which;
    showError(`#${f}-error`);
  }
  $('.mode-tabs').hidden = which === 'forgot' || which === 'reset';
  $('#mode-signin').setAttribute('aria-selected', String(which === 'signin'));
  $('#mode-signup').setAttribute('aria-selected', String(which === 'signup'));
  showScreen('login');
  showInviteBanner();
}

function signedIn(token) {
  state.token = token;
  store('pr_token', token);
  boot();
}

// Ask the browser to save the password (Chrome/Android/Edge). Safari/iOS saves from the form fields instead.
async function rememberPassword(id, password, name) {
  try {
    if (!id || !password || !window.PasswordCredential || !navigator.credentials) return;
    await navigator.credentials.store(new PasswordCredential({ id, password, name: name || id }));
  } catch { /* the viewer declined or the browser can't; nothing to do */ }
}

$('#mode-signin').addEventListener('click', () => showAuth('signin'));
$('#mode-signup').addEventListener('click', () => showAuth('signup'));
$('#show-forgot').addEventListener('click', () => {
  const typed = $('#signin-login').value.trim();
  if (typed.includes('@')) $('#forgot-email').value = typed;
  showAuth('forgot');
});
document.querySelectorAll('.back-to-signin').forEach((b) => b.addEventListener('click', () => showAuth('signin')));

$('#signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#signin-error');
  try {
    const login = $('#signin-login').value.trim();
    const password = $('#signin-password').value;
    const { token } = await api('/api/login', { method: 'POST', body: { login, password } });
    await rememberPassword(login, password);
    $('#signin-password').value = '';
    signedIn(token);
  } catch (ex) { showError('#signin-error', ex.message); }
});

$('#signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#signup-error');
  try {
    const name = $('#signup-name').value;
    const email = $('#signup-email').value.trim();
    const password = $('#signup-password').value;
    const { token } = await api('/api/signup', { method: 'POST', body: { name, email, password } });
    await rememberPassword(email, password, name);
    $('#signup-password').value = '';
    signedIn(token);
  } catch (ex) { showError('#signup-error', ex.message); }
});

async function requestCode() {
  const { message } = await api('/api/forgot', { method: 'POST', body: { email: $('#forgot-email').value } });
  $('#reset-sent').textContent = `${message} Check your spam folder if it's not in your inbox.`;
}

$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#forgot-error');
  try {
    await requestCode();
    $('#reset-username').value = $('#forgot-email').value.trim();
    showAuth('reset');
    $('#reset-code').focus();
  } catch (ex) { showError('#forgot-error', ex.message); }
});

$('#resend-code').addEventListener('click', async () => {
  showError('#reset-error');
  try { await requestCode(); toast('New code sent'); } catch (ex) { showError('#reset-error', ex.message); }
});

$('#reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#reset-error');
  try {
    const email = $('#forgot-email').value.trim();
    const password = $('#reset-password').value;
    const { token } = await api('/api/reset', {
      method: 'POST', body: { email, code: $('#reset-code').value, password },
    });
    await rememberPassword(email, password);
    $('#reset-code').value = '';
    $('#reset-password').value = '';
    toast('Password updated. Other devices were signed out.');
    signedIn(token);
  } catch (ex) { showError('#reset-error', ex.message); }
});

$('#set-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#set-password-error');
  try {
    const password = $('#set-password-input').value;
    await api('/api/me/password', { method: 'POST', body: { password } });
    await rememberPassword(state.me.email || state.me.name, password, state.me.name);
    $('#set-password-input').value = '';
    toast('Password saved. Use it to sign in from now on.');
    boot();
  } catch (ex) { showError('#set-password-error', ex.message); }
});

$('#add-email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#add-email-error');
  try {
    await api('/api/me/email', { method: 'POST', body: { email: $('#add-email-input').value } });
    toast('Email saved. Use it to sign in from now on.');
    boot();
  } catch (ex) { showError('#add-email-error', ex.message); }
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
  showAuth('signin');
}

// ---------------------------------------------------------------- groups

async function loadMe() {
  const data = await api('/api/me');
  state.me = data.me;
  state.groups = data.groups;
  state.createNeedsCode = data.createNeedsCode;
  state.sportsbooks = data.sportsbooks;
  document.querySelectorAll('.storage-warning').forEach((p) => { p.hidden = !data.storageWarning; });
  $('#set-password-username').value = data.me.email || data.me.name;
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
  state.confirmKick = null;
  $('#code-form').hidden = true;
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
  $('#invite-link').textContent = inviteLink(g.code);
  $('#edit-code').hidden = !amLeader() || !$('#code-form').hidden;
  if (!amLeader()) $('#code-form').hidden = true;
  const bookSel = $('#book-select');
  bookSel.replaceChildren(...state.sportsbooks.map((b) => el('option', { value: b.key }, b.title)));
  bookSel.value = g.sportsbook.key;
  bookSel.disabled = !amLeader();
  bookSel.title = amLeader() ? '' : 'Only the group leader can change this';
  $('#member-count').textContent = `${g.members.length} member${g.members.length === 1 ? '' : 's'}`;

  $('#members').replaceChildren(...g.members.map((m) => {
    let right = null;
    if (m.isLeader) right = el('span', { class: 'pill leader' }, 'Leader');
    else if (amLeader() && state.confirmKick === m.id) {
      right = el('span', { class: 'member-actions' },
        el('span', { class: 'small' }, `Remove ${m.name}?`),
        el('button', { class: 'btn danger sm', type: 'button', onclick: () => kick(m) }, 'Remove'),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.confirmKick = null; renderGroupHeader(); } }, 'Cancel'));
    } else if (amLeader()) {
      right = el('span', { class: 'member-actions' },
        el('button', { class: 'link-btn', type: 'button', onclick: () => makeLeader(m) }, 'Make leader'),
        el('button', { class: 'link-btn danger-link', type: 'button', onclick: () => { state.confirmKick = m.id; renderGroupHeader(); } }, 'Remove'));
    }
    return el('li', { class: 'member' },
      el('span', {}, m.name, m.id === state.me.id ? el('span', { class: 'muted' }, ' (you)') : null), right);
  }));

  const removed = amLeader() ? g.removed : [];
  $('#removed-wrap').hidden = !removed.length;
  $('#removed').replaceChildren(...removed.map((m) => el('li', { class: 'member' },
    el('span', { class: 'muted' }, m.name),
    el('button', { class: 'link-btn', type: 'button', onclick: () => unban(m) }, 'Let back in'))));
}

async function kick(m) {
  state.confirmKick = null;
  try {
    const { group } = await groupApi('/kick', { method: 'POST', body: { memberId: m.id } });
    state.group = group;
    renderGroupHeader();
    toast(`${m.name} was removed. They can't rejoin unless you let them back in.`);
  } catch (ex) { toast(ex.message); renderGroupHeader(); }
}

async function unban(m) {
  try {
    const { group } = await groupApi('/unban', { method: 'POST', body: { memberId: m.id } });
    state.group = group;
    renderGroupHeader();
    toast(`${m.name} can rejoin with the invite code`);
  } catch (ex) { toast(ex.message); }
}

$('#book-select').addEventListener('change', async (e) => {
  try {
    const { group } = await groupApi('/sportsbook', { method: 'POST', body: { sportsbook: e.target.value } });
    state.group = group;
    loadLegs(false);
    toast(`Bets now go to ${group.sportsbook.title}`);
  } catch (ex) { toast(ex.message); renderGroupHeader(); }
});

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast(text); }
}

$('#copy-link').addEventListener('click', () => copyText(inviteLink(state.group.code), 'Invite link copied'));

$('#share-link').addEventListener('click', async () => {
  const url = inviteLink(state.group.code);
  if (navigator.share) {
    try {
      await navigator.share({ title: `Join ${state.group.name} on Parlay Room`, text: `Join ${state.group.name} on Parlay Room`, url });
      return;
    } catch (ex) {
      if (ex && ex.name === 'AbortError') return; // closed the share sheet
    }
  }
  copyText(url, 'Invite link copied. Paste it in a text to your friends.');
});

$('#copy-code').addEventListener('click', async () => {
  const code = state.group?.code;
  try { await navigator.clipboard.writeText(code); toast('Invite code copied'); }
  catch { toast(`Invite code: ${code}`); }
});

function closeCodeForm() {
  $('#code-form').hidden = true;
  showError('#code-error');
  renderGroupHeader();
}

async function saveCode(code) {
  showError('#code-error');
  try {
    const { group } = await groupApi('/code', { method: 'POST', body: { code } });
    state.group = group;
    closeCodeForm();
    toast(`Invite code is now ${group.code}. The old one no longer works.`);
  } catch (ex) { showError('#code-error', ex.message); }
}

$('#edit-code').addEventListener('click', () => {
  $('#code-form').hidden = false;
  $('#edit-code').hidden = true;
  $('#code-input').value = state.group.code;
  $('#code-input').select();
});
$('#cancel-code').addEventListener('click', closeCodeForm);
$('#random-code').addEventListener('click', () => saveCode(''));
$('#code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#code-input').value.trim();
  if (!v) return showError('#code-error', 'Type a code, or tap Random.');
  saveCode(v);
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
  const byId = Object.fromEntries([...state.group.removed, ...state.group.members].map((m) => [m.id, m]));
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
    if (state.token) { showAuth('signin'); showError('#signin-error', ex.message); }
    return;
  }
  if (state.me.needsPassword) return showScreen('set-password');
  if (!state.me.email) return showScreen('add-email');
  if (store('pr_invite') && await acceptInvite()) return;
  if (state.groupId && state.groups.some((g) => g.id === state.groupId)) openGroup(state.groupId);
  else if (state.groups.length === 1) openGroup(state.groups[0].id);
  else showGroups();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.groupId && !$('#app').hidden) loadLegs(false); });

if (state.token) boot(); else showAuth(store('pr_invite') ? 'signup' : 'signin');
