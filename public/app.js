const $ = (s) => document.querySelector(s);
const state = {
  token: store('pr_token'),
  me: null,
  groups: [],
  groupId: store('pr_group'),
  group: null,
  slips: [],        // this group's named slips, each with its own legs
  slipData: null,   // last /slips response (quota, demo flag, time)
  slipId: null,     // slip on screen
  addSlipId: null,  // slip that Find props adds to
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
let pendingSlipId = null; // slip to open next, from a tapped notification

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
  // Stop this device getting alerts for an account that's no longer signed in here.
  const sub = await currentSubscription();
  if (sub) {
    try { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch { /* ignore */ }
    try { await sub.unsubscribe(); } catch { /* ignore */ }
  }
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  signOutLocal();
});

function signOutLocal() {
  Object.assign(state, { token: null, me: null, groups: [], group: null, groupId: null });
  store('pr_token', null);
  store('pr_group', null);
  clearInterval(poll);
  disconnectLive();
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
  disconnectLive();
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
  state.slips = [];
  state.slipData = null;
  state.slipId = pendingSlipId || store(`pr_slip_${id}`);
  state.addSlipId = state.slipId;
  pendingSlipId = null;
  resetSlipForms();
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
  connectLive();
  renderNotify();
}

const amLeader = () => !!(state.group && state.me && state.group.leaderId === state.me.id);
// Same rules as the server: locked groups are edited only by the leader and chosen editors.
const amEditor = () => amLeader() || !!state.group?.members.find((m) => m.id === state.me?.id)?.isEditor;
const canEditGroup = () => !!state.group && (!state.group.locked || amEditor());

// View-only members in a locked group: no Find props, no slip controls, a short explanation.
function applyEditAccess() {
  const edit = canEditGroup();
  const findTab = document.querySelector('.tab[data-tab="find"]');
  findTab.hidden = !edit;
  $('#panel-find').hidden = !edit;
  document.querySelector('.panels').classList.toggle('single', !edit);
  if (!edit && findTab.getAttribute('aria-selected') === 'true') showTab('slip');
  $('#new-slip').hidden = !edit || !$('#new-slip-form').hidden;
  if (!edit) $('#new-slip-form').hidden = true;
  const leader = state.group.members.find((m) => m.isLeader)?.name || 'The leader';
  $('#view-only').hidden = edit;
  $('#view-only').textContent = `View only: ${leader} has locked this group. You can see every slip and place bets, but only editors can add or change props.`;
}

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

  // Lock switch (leader) / lock status (everyone)
  const editors = g.members.filter((m) => m.isEditor).length;
  $('#lock-status').textContent = g.locked
    ? `Locked: only the leader${editors ? ` and ${editors} editor${editors === 1 ? '' : 's'}` : ''} can add or change props. Everyone can still place bets.`
    : 'Open: anyone in the group can add props.';
  $('#lock-toggle').hidden = !amLeader();
  $('#lock-toggle').textContent = g.locked ? 'Unlock group' : 'Lock group';
  applyEditAccess();

  $('#members').replaceChildren(...g.members.map((m) => {
    let right = null;
    const editorPill = m.isEditor ? el('span', { class: 'pill editor' }, 'Editor') : null;
    if (m.isLeader) right = el('span', { class: 'pill leader' }, 'Leader');
    else if (amLeader() && state.confirmKick === m.id) {
      right = el('span', { class: 'member-actions' },
        el('span', { class: 'small' }, `Remove ${m.name}?`),
        el('button', { class: 'btn danger sm', type: 'button', onclick: () => kick(m) }, 'Remove'),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.confirmKick = null; renderGroupHeader(); } }, 'Cancel'));
    } else if (amLeader()) {
      right = el('span', { class: 'member-actions' },
        el('button', {
          class: `btn sm ${m.isEditor ? 'primary' : 'ghost'}`, type: 'button', 'aria-pressed': String(m.isEditor),
          onclick: () => setEditor(m, !m.isEditor),
        }, m.isEditor ? 'Editor ✓' : 'Make editor'),
        el('button', { class: 'link-btn', type: 'button', onclick: () => makeLeader(m) }, 'Make leader'),
        el('button', { class: 'link-btn danger-link', type: 'button', onclick: () => { state.confirmKick = m.id; renderGroupHeader(); } }, 'Remove'));
    } else {
      right = editorPill;
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

async function setEditor(m, editor) {
  try {
    const { group } = await groupApi('/editors', { method: 'POST', body: { memberId: m.id, editor } });
    state.group = group;
    renderGroupHeader();
    if (state.slipData) renderSlip();
    toast(editor ? `${m.name} can now add and change props` : `${m.name} is view-only when the group is locked`);
  } catch (ex) { toast(ex.message); }
}

$('#lock-toggle').addEventListener('click', async () => {
  const locking = !state.group.locked;
  try {
    const { group } = await groupApi('/lock', { method: 'POST', body: { locked: locking } });
    state.group = group;
    renderGroupHeader();
    if (state.slipData) renderSlip();
    const editors = group.members.filter((m) => m.isEditor).length;
    toast(locking
      ? (editors ? 'Group locked. Only you and your editors can change props.' : 'Group locked. Tap "Make editor" next to anyone who should add props.')
      : 'Group unlocked. Everyone can add props again.');
  } catch (ex) { toast(ex.message); }
});

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
  if (name === 'find' && state.group && !canEditGroup()) name = 'slip';
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  store('pr_tab', name);
}

// ---------------------------------------------------------------- slip

let legsRequested = 0; // newest request sent
let legsShown = 0;     // newest request drawn on screen

async function loadLegs(fresh) {
  if (!state.groupId) return;
  const gid = state.groupId;
  const seq = ++legsRequested;
  const btn = $('#refresh');
  if (fresh) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  try {
    const data = await groupApi(`/slips${fresh ? '?fresh=1' : ''}`);
    if (gid !== state.groupId) return; // switched groups meanwhile
    if (seq < legsShown) return;       // a newer answer already arrived; don't roll the slip back
    legsShown = seq;
    state.slips = data.slips;
    state.slipData = data;
    // Keep looking at the same slip; if it was deleted, fall back to the first one.
    if (!state.slips.some((s) => s.id === state.slipId)) setSlip(state.slips[0]?.id, false);
    if (!state.slips.some((s) => s.id === state.addSlipId)) state.addSlipId = state.slipId;
    state.group = data.group;
    renderGroupHeader();
    renderSlip();
    renderAddTo();
    if (state.props) renderOutcomes();
  } catch (ex) {
    if (/not in that group/.test(ex.message)) {
      toast(ex.message);
      await loadMe().catch(() => {});
      showGroups();
    } else if (fresh) {
      toast(ex.message); // background checks stay quiet (e.g. phone briefly offline)
    }
  } finally {
    if (fresh) {
      btn.disabled = false;
      btn.textContent = 'Refresh odds';
    }
  }
}

const currentSlip = () => state.slips.find((s) => s.id === state.slipId) || state.slips[0];
const canManageSlip = (s) => !!s && (state.group.locked ? amEditor() : s.createdBy === state.me.id || amLeader());
const canManageLeg = (leg) => (state.group.locked ? amEditor() : leg.addedBy === state.me.id || amLeader());
const memberName = (id) => [...state.group.members, ...state.group.removed].find((m) => m.id === id)?.name;

// Which slip is on screen. Remembered per group so reopening the app lands on the same one.
function setSlip(id, render = true) {
  state.slipId = id;
  state.addSlipId = id; // looking at a slip makes it where new props go
  if (id && state.groupId) store(`pr_slip_${state.groupId}`, id);
  resetSlipForms();
  if (render && state.slipData) { renderSlip(); renderAddTo(); if (state.props) renderOutcomes(); }
}

function renderSlipTabs() {
  $('#slip-tabs').replaceChildren(...state.slips.map((s) => el('button', {
    class: 'slip-tab', type: 'button', role: 'tab', 'aria-selected': String(s.id === state.slipId),
    onclick: () => setSlip(s.id),
  }, el('span', { class: 'slip-tab-name' }, s.name), el('span', { class: 'slip-tab-count' }, String(s.legs.length)))));
}

function renderSlip() {
  const data = state.slipData;
  const slip = currentSlip();
  if (!slip) return;
  state.slipId = slip.id;
  const legs = slip.legs;
  const live = legs.filter((l) => !l.unavailable);
  const byId = Object.fromEntries([...state.group.removed, ...state.group.members].map((m) => [m.id, m]));
  $('#demo-badge').hidden = !data.demo;
  $('#tab-count').textContent = state.slips.length > 1 ? `${state.slips.length}` : legs.length;
  renderSlipTabs();
  $('#slip-name').textContent = slip.name;
  $('#slip-by').textContent = `Made by ${memberName(slip.createdBy) || 'a former member'}`;
  const manage = canManageSlip(slip);
  $('#rename-slip').hidden = !manage || !$('#rename-slip-form').hidden;
  const others = state.slips.filter((s) => s.id !== slip.id);

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
  state.parlayDec = live.length ? live.reduce((acc, l) => acc * toDecimal(l.price), 1) : null;
  renderBoost();

  renderPlaceBet(slip, data, live);

  const list = $('#legs');
  list.replaceChildren();
  if (!legs.length) {
    list.append(el('li', { class: 'empty' }, `${slip.name} is empty. Head to Find props and add the first leg.`));
  }
  const firstRender = state.seenLegIds.size === 0;
  for (const leg of legs) {
    const who = byId[leg.addedBy];
    const canRemove = canManageLeg(leg);
    const moveTo = canRemove && others.length
      ? el('select', {
        class: 'move-select', 'aria-label': `Move ${leg.label} to another slip`,
        onchange: (e) => { if (e.target.value) moveLeg(slip, leg, e.target.value); },
      }, el('option', { value: '' }, 'Move to…'), others.map((s) => el('option', { value: s.id }, s.name)))
      : null;
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
          moveTo,
          canRemove ? el('button', { class: 'btn ghost sm', type: 'button', onclick: () => removeLeg(slip, leg) }, 'Remove') : null))));
  }

  $('#updated').textContent = `Updated ${new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  $('#quota').textContent = data.quota && data.quota.remaining != null ? `${data.quota.remaining} API credits left` : '';
  const confirming = !$('#slip-confirm').hidden;
  $('#clear').hidden = confirming || !(manage && legs.length);
  $('#delete-slip').hidden = confirming || !(manage && state.slips.length > 1);
}

// ---------------------------------------------------------------- profit boost calculator
// A profit boost multiplies the winnings only: boosted decimal = 1 + (decimal - 1) * (1 + boost%).
// Everything here runs on the viewer's phone. The boost starts at 0% every time the app opens
// (so nobody mistakes a leftover boost for the real odds); the stake is remembered per device.

const money = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let boostSetting = 0;
const boostPct = () => boostSetting;
function boostStake() {
  const v = Number(String($('#boost-stake').value).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) && v > 0 && v <= 1000000 ? v : null;
}

function renderBoost() {
  const dec = state.parlayDec;
  $('#boost').hidden = !dec;
  if (!dec) return;
  const pct = boostPct();
  $('#boost-range').value = pct;
  $('#boost-pct').textContent = pct ? `+${pct}%` : 'No boost';
  document.querySelectorAll('.boost-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.boost) === pct)));

  const boosted = 1 + (dec - 1) * (1 + pct / 100);
  $('#boost-odds').textContent = fmtOdds(toAmerican(boosted));
  $('#boost-from').textContent = pct ? `from ${fmtOdds(toAmerican(dec))}` : 'same as the slip';

  const stake = boostStake();
  if (stake == null) {
    $('#boost-pays').textContent = '—';
    $('#boost-extra').textContent = 'Enter a stake';
    return;
  }
  const normal = stake * dec;
  const withBoost = stake * boosted;
  $('#boost-pays').textContent = money(withBoost);
  $('#boost-extra').textContent = pct ? `+${money(withBoost - normal)} vs ${money(normal)}` : 'Slide to try a boost';
}

function setBoost(pct) {
  boostSetting = Math.min(105, Math.max(0, pct));
  renderBoost();
}
store('pr_boost', null); // older versions saved the boost; always start at 0 now
$('#boost-range').addEventListener('input', (e) => setBoost(Number(e.target.value)));
document.querySelectorAll('.boost-chips .chip').forEach((c) => c.addEventListener('click', () => setBoost(Number(c.dataset.boost))));
$('#boost-stake').addEventListener('input', () => {
  const s = boostStake();
  if (s != null) store('pr_stake', String(s));
  renderBoost();
});
$('#boost-stake').value = store('pr_stake') || '10';

function renderPlaceBet(slip, data, live) {
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
  btn.href = slip.placeBet.url;
  btn.removeAttribute('aria-disabled');
  note.hidden = false;
  if (slip.placeBet.loadsSlip) {
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

async function removeLeg(slip, leg) {
  try {
    await groupApi(`/slips/${slip.id}/legs/${leg.id}`, { method: 'DELETE' });
    toast('Leg removed');
  } catch (ex) { toast(ex.message); }
  loadLegs(false);
}

async function moveLeg(slip, leg, toSlipId) {
  try {
    const { to } = await groupApi(`/slips/${slip.id}/legs/${leg.id}/move`, { method: 'POST', body: { toSlipId } });
    toast(`Moved to ${to}`);
  } catch (ex) { toast(ex.message); }
  loadLegs(false);
}

$('#refresh').addEventListener('click', () => loadLegs(true));

// One inline "are you sure?" row, shared by Clear slip and Delete slip.
let confirmAction = null;
function askConfirm(text, yesLabel, action) {
  confirmAction = action;
  $('#slip-confirm-text').textContent = text;
  $('#slip-confirm-yes').textContent = yesLabel;
  $('#slip-confirm').hidden = false;
  $('#clear').hidden = true;
  $('#delete-slip').hidden = true;
}
function closeConfirm() {
  confirmAction = null;
  $('#slip-confirm').hidden = true;
  if (state.slipData) renderSlip();
}
$('#slip-confirm-no').addEventListener('click', closeConfirm);
$('#slip-confirm-yes').addEventListener('click', async () => {
  const action = confirmAction;
  closeConfirm();
  if (action) await action();
  loadLegs(false);
});

$('#clear').addEventListener('click', () => {
  const slip = currentSlip();
  askConfirm(`Remove every leg from ${slip.name}?`, 'Yes, clear', async () => {
    try { await groupApi(`/slips/${slip.id}/legs`, { method: 'DELETE' }); toast(`${slip.name} cleared`); } catch (ex) { toast(ex.message); }
  });
});

$('#delete-slip').addEventListener('click', () => {
  const slip = currentSlip();
  const n = slip.legs.length;
  askConfirm(`Delete ${slip.name}${n ? ` and its ${n} leg${n === 1 ? '' : 's'}` : ''}?`, 'Yes, delete', async () => {
    try {
      await groupApi(`/slips/${slip.id}`, { method: 'DELETE' });
      toast(`${slip.name} deleted`);
      setSlip(state.slips.find((s) => s.id !== slip.id)?.id, false);
    } catch (ex) { toast(ex.message); }
  });
});

// New slip
function resetSlipForms() {
  for (const f of ['new-slip', 'rename-slip']) {
    $(`#${f}-form`).hidden = true;
    showError(`#${f}-error`);
  }
  $('#new-slip').hidden = !canEditGroup();
  if (!$('#slip-confirm').hidden) { confirmAction = null; $('#slip-confirm').hidden = true; }
}
$('#new-slip').addEventListener('click', () => {
  resetSlipForms();
  $('#new-slip-form').hidden = false;
  $('#new-slip').hidden = true;
  $('#new-slip-name').value = '';
  $('#new-slip-name').focus();
});
$('#new-slip-cancel').addEventListener('click', resetSlipForms);
$('#new-slip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#new-slip-error');
  try {
    const { slip } = await groupApi('/slips', { method: 'POST', body: { name: $('#new-slip-name').value } });
    state.addSlipId = slip.id; // new slip is where the next props go
    resetSlipForms();
    state.slipId = slip.id;
    store(`pr_slip_${state.groupId}`, slip.id);
    toast(`${slip.name} created. Props you add now go here.`);
    loadLegs(false);
  } catch (ex) { showError('#new-slip-error', ex.message); }
});

// Rename
$('#rename-slip').addEventListener('click', () => {
  resetSlipForms();
  $('#rename-slip-form').hidden = false;
  $('#rename-slip').hidden = true;
  $('#rename-slip-name').value = currentSlip().name;
  $('#rename-slip-name').select();
});
$('#rename-slip-cancel').addEventListener('click', () => { resetSlipForms(); renderSlip(); });
$('#rename-slip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('#rename-slip-error');
  try {
    const { slip } = await groupApi(`/slips/${currentSlip().id}`, { method: 'PATCH', body: { name: $('#rename-slip-name').value } });
    resetSlipForms();
    toast(`Renamed to ${slip.name}`);
    loadLegs(false);
  } catch (ex) { showError('#rename-slip-error', ex.message); }
});

// Finder: which slip new props go on. Follows the slip you're looking at unless you pick another.
function renderAddTo() {
  const sel = $('#add-to-slip');
  sel.replaceChildren(...state.slips.map((s) => el('option', { value: s.id }, `${s.name} (${s.legs.length})`)));
  sel.value = state.addSlipId || state.slipId;
}
$('#add-to-slip').addEventListener('change', (e) => {
  state.addSlipId = e.target.value;
  if (state.props) renderOutcomes();
});

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
  state.props = null;
  state.event = null;
  $('#game-picker').replaceChildren();
  try {
    const { events } = await api(`/api/events?sport=${key}`);
    if (state.sport !== key) return; // switched sports while loading
    state.events = [...events].sort((a, b) => a.commence.localeCompare(b.commence));
    if (!events.length) {
      $('#find-status').textContent = 'No upcoming games on FanDuel for this sport.';
      renderGamePicker();
      return;
    }
    // Reopen the game you last picked for this sport; otherwise start on the first day with games.
    const last = store(`pr_game_${key}`);
    const lastGame = state.events.find((e) => e.id === last);
    state.gameDay = lastGame ? dayKey(lastGame.commence) : dayKey(state.events[0].commence);
    state.gameFilter = '';
    if (lastGame) {
      state.event = lastGame.id;
      state.pickerOpen = false;
      renderGamePicker();
      loadProps();
    } else {
      state.pickerOpen = true;
      renderGamePicker();
      $('#find-status').textContent = 'Pick a game to see its odds.';
    }
  } catch (ex) {
    $('#find-status').textContent = ex.message;
  }
}

// ---------------------------------------------------------------- game picker
// Games split by day (in the viewer's own time zone), shown as cards with team badges.
// Once a game is picked, the list folds into one bar so the props sit right below it.

const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
}
const gameTime = (iso) => (new Date(iso) <= new Date()
  ? 'Started'
  : new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

function teamLine(name) {
  return el('span', { class: 'team-line' }, teamBadge(name), el('span', { class: 'team-name' }, name));
}

function pickGame(e) {
  state.event = e.id;
  state.pickerOpen = false;
  store(`pr_game_${state.sport}`, e.id);
  renderGamePicker();
  loadProps();
}

function renderGamePicker() {
  const box = $('#game-picker');
  const events = state.events || [];
  if (!events.length) { box.replaceChildren(); return; }
  const picked = events.find((e) => e.id === state.event);

  // Folded: just the chosen game and a way back to the list.
  if (picked && !state.pickerOpen) {
    box.replaceChildren(el('div', { class: 'game-chosen' },
      el('div', { class: 'game-chosen-teams' },
        el('span', { class: 'game-chosen-when' }, `${dayLabel(dayKey(picked.commence))} · ${gameTime(picked.commence)}`),
        teamLine(picked.away), teamLine(picked.home)),
      el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.pickerOpen = true; renderGamePicker(); } }, 'Change game')));
    return;
  }

  // Open: day tabs, optional team search, then that day's games.
  const days = [...new Set(events.map((e) => dayKey(e.commence)))];
  if (!days.includes(state.gameDay)) state.gameDay = days[0];
  const counts = Object.fromEntries(days.map((d) => [d, events.filter((e) => dayKey(e.commence) === d).length]));
  const dayTabs = el('div', { class: 'day-tabs chips scroll', role: 'tablist', 'aria-label': 'Game day' },
    days.map((d) => el('button', {
      class: 'chip day-chip', type: 'button', role: 'tab', 'aria-selected': String(d === state.gameDay),
      onclick: () => { state.gameDay = d; state.gameFilter = ''; renderGamePicker(); },
    }, dayLabel(d), el('span', { class: 'day-count' }, String(counts[d])))));

  const q = (state.gameFilter || '').trim().toLowerCase();
  const dayGames = events.filter((e) => dayKey(e.commence) === state.gameDay);
  const shown = dayGames.filter((e) => !q || `${e.away} ${e.home}`.toLowerCase().includes(q));
  const search = dayGames.length > 6
    ? el('input', {
      id: 'game-filter', type: 'search', class: 'game-filter', placeholder: 'Find a team', 'aria-label': 'Find a team',
      value: state.gameFilter || '',
      oninput: (ev) => { state.gameFilter = ev.target.value; renderGameList(); },
    })
    : null;

  const list = el('ul', { class: 'game-list', id: 'game-list' });
  box.replaceChildren(...[
    el('div', { class: 'game-picker-head' },
      el('span', { class: 'row-label' }, 'Games'),
      picked ? el('button', { class: 'link-btn', type: 'button', onclick: () => { state.pickerOpen = false; renderGamePicker(); } }, 'Back to my game') : null),
    dayTabs, search, list].filter(Boolean));
  renderGameList(shown);
  document.querySelector('.day-chip[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  function renderGameList(games) {
    const qq = (state.gameFilter || '').trim().toLowerCase();
    const rows = games || dayGames.filter((e) => !qq || `${e.away} ${e.home}`.toLowerCase().includes(qq));
    list.replaceChildren(...(rows.length ? rows.map((e) => el('li', {},
      el('button', {
        class: `game-card${e.id === state.event ? ' selected' : ''}`, type: 'button',
        'aria-label': `${e.away} at ${e.home}, ${dayLabel(dayKey(e.commence))} ${gameTime(e.commence)}`,
        onclick: () => pickGame(e),
      },
      el('span', { class: 'game-teams' }, teamLine(e.away), teamLine(e.home)),
      el('span', { class: `game-time${new Date(e.commence) <= new Date() ? ' started' : ''}` }, gameTime(e.commence)))))
      : [el('li', { class: 'empty small' }, 'No games match that team.')]));
  }
}

const sportMarkets = () => state.sports.find((s) => s.key === state.sport)?.markets || [];

function renderMarkets() {
  for (const group of ['player', 'game']) {
    const chips = sportMarkets().filter((m) => m.group === group).map((m) => el('button', {
      class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(m.key === state.market),
      onclick: () => { state.market = m.key; renderMarkets(); loadProps(); },
    }, m.label));
    const row = $(`#markets-${group}`);
    row.replaceChildren(...chips);
    row.parentElement.hidden = !chips.length;
  }
  // Keep the picked chip in view when the row scrolls sideways.
  document.querySelector('.market-row .chip[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// How lines are grouped in the list: by player (props, team totals), by team (spreads),
// by line (totals, so Over and Under sit side by side), or one row (moneylines).
function outcomeGroup(p, o) {
  if (o.player) return o.player;
  if (p.market.includes('spreads')) return o.side;
  if (p.market.includes('totals')) return `Total ${o.point}`;
  return p.marketLabel;
}
function outcomeSide(p, o) {
  if (o.player) return `${o.side}${o.point != null ? ` ${o.point}` : ''}`;
  if (p.market.includes('spreads')) return `${o.point > 0 ? '+' : ''}${o.point}`;
  if (p.market.includes('totals')) return o.side;
  return o.label;
}

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
  // "Added" checkmarks are for the slip props are going to.
  const target = state.slips.find((s) => s.id === state.addSlipId) || currentSlip();
  const onSlip = new Set((target?.legs || []).filter((l) => l.eventId === p.event.id && l.market === p.market).map((l) => l.key));
  const rows = p.outcomes.filter((o) => !q || o.label.toLowerCase().includes(q));

  const groups = new Map();
  for (const o of rows) {
    const g = outcomeGroup(p, o);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(o);
  }

  $('#find-status').textContent = !p.outcomes.length
    ? `FanDuel isn't offering ${p.marketLabel} for this game yet.`
    : `${rows.length} line${rows.length === 1 ? '' : 's'} · ${p.marketLabel}${p.lastUpdate ? ` · odds as of ${new Date(p.lastUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`;

  $('#outcomes').replaceChildren(...[...groups].map(([name, outs]) => el('li', { class: 'player-group' },
    [p.event.home, p.event.away].includes(name)
      ? el('div', { class: 'player-name with-badge' }, teamBadge(name, 'sm'), name)
      : el('div', { class: 'player-name' }, name),
    el('div', { class: 'options' }, outs.map((o) => {
      const added = onSlip.has(o.key);
      const sideText = outcomeSide(p, o);
      return el('button', {
        class: `option${added ? ' added' : ''}`, type: 'button', disabled: added,
        'aria-label': `${added ? 'On slip: ' : 'Add '}${o.label} ${fmtOdds(o.price)}`,
        onclick: () => addLeg(o),
      }, el('span', { class: 'side' }, sideText), el('span', { class: 'price' }, fmtOdds(o.price)));
    })))));
}

async function addLeg(o) {
  const p = state.props;
  const target = state.slips.find((s) => s.id === state.addSlipId) || currentSlip();
  if (!target) return toast('Make a slip first.');
  try {
    await groupApi(`/slips/${target.id}/legs`, { method: 'POST', body: { sport: p.sport, eventId: p.event.id, market: p.market, key: o.key } });
    toast(`Added ${o.label} to ${target.name}`);
  } catch (ex) { toast(ex.message); }
  loadLegs(false);
}

// ---------------------------------------------------------------- notifications (web push)

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReg = null;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch { swReg = null; }
}

function keyBytes(b64url) {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const sameBytes = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

async function currentSubscription() {
  if (!swReg || !pushSupported) return null;
  try { return await swReg.pushManager.getSubscription(); } catch { return null; }
}

// 'on' | 'off' | 'blocked' | 'ios-install' (iPhone, not on Home Screen yet) | 'unsupported'
async function notifyState() {
  if (!pushSupported) return isIOS && !isInstalled ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await currentSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

// Subscribe this device (or fix a subscription made with an old server key) and tell the server.
async function ensureSubscription() {
  const { publicKey } = await api('/api/push/key');
  if (!publicKey) throw new Error("Notifications aren't available on this server yet.");
  if (!swReg) await registerServiceWorker();
  if (!swReg) throw new Error("This browser can't do notifications.");
  await navigator.serviceWorker.ready;
  const want = keyBytes(publicKey);
  let sub = await swReg.pushManager.getSubscription();
  if (sub && !sameBytes(new Uint8Array(sub.options.applicationServerKey || []), want)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function turnOnNotifications() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast(perm === 'denied'
        ? 'Notifications are blocked. Allow them for this site in your browser or phone settings.'
        : 'Notifications stay off. You can turn them on any time here.');
      return renderNotify();
    }
    await ensureSubscription();
    store('pr_notify_dismissed', null);
    toast("Notifications on. You'll get a ping when someone adds a leg.");
  } catch (ex) {
    toast(ex.message || "Couldn't turn on notifications. Try again.");
  }
  renderNotify();
}

async function turnOffNotifications() {
  const sub = await currentSubscription();
  if (sub) {
    try { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch { /* still unsubscribe locally */ }
    try { await sub.unsubscribe(); } catch { /* ignore */ }
  }
  toast('Notifications off for this device');
  renderNotify();
}

async function renderNotify() {
  const s = await notifyState();
  const status = {
    on: 'On for this device.',
    off: 'Off for this device.',
    blocked: 'Blocked. Allow notifications for this site in your browser or phone settings.',
    'ios-install': 'On iPhone, add the app to your Home Screen first.',
    unsupported: "This browser can't show notifications.",
  }[s];
  $('#notify-status').textContent = status;
  $('#notify-on').hidden = s !== 'off';
  $('#notify-test').hidden = s !== 'on';
  $('#notify-off').hidden = s !== 'on';
  $('#ios-install').hidden = s !== 'ios-install';

  // The friendly prompt above the slip, until they act on it or say "not now".
  const dismissed = store('pr_notify_dismissed') === '1';
  const showCard = !dismissed && (s === 'off' || s === 'ios-install');
  $('#notify-card').hidden = !showCard;
  $('#notify-card-sub').textContent = s === 'ios-install'
    ? 'On iPhone, add Parlay Room to your Home Screen first.'
    : 'Even when the app is closed.';
  $('#notify-card-on').textContent = s === 'ios-install' ? 'Show me how' : 'Turn on';
}

$('#notify-on').addEventListener('click', turnOnNotifications);
$('#notify-off').addEventListener('click', turnOffNotifications);
$('#notify-test').addEventListener('click', async () => {
  try { await api('/api/push/test', { method: 'POST' }); toast('Test sent. It should pop up in a few seconds.'); }
  catch (ex) { toast(ex.message); }
});
$('#notify-card-on').addEventListener('click', async () => {
  if ((await notifyState()) === 'ios-install') {
    $('#group-info').open = true;
    $('#ios-install').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  turnOnNotifications();
});
$('#notify-card-later').addEventListener('click', () => {
  store('pr_notify_dismissed', '1');
  $('#notify-card').hidden = true;
});

// Keep the server's copy of this device's subscription current (e.g. after the server's data was reset).
async function resyncNotifications() {
  if ((await notifyState()) !== 'on') return;
  try { await ensureSubscription(); } catch { /* not critical */ }
}

// Tapping a notification opens the group it's about.
// Notification links look like /?g=<group>&s=<slip>.
function linkTarget(url) {
  try {
    const p = new URL(url, location.origin).searchParams;
    return { gid: p.get('g'), sid: p.get('s') };
  } catch { return {}; }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'open') return;
    const { gid, sid } = linkTarget(e.data.url);
    if (gid && state.groups.some((g) => g.id === gid)) {
      pendingSlipId = sid;
      openGroup(gid);
      showTab('slip');
    } else if (state.groupId) loadLegs(false);
  });
}
const fromLink = linkTarget(location.href);
if (fromLink.gid) {
  store('pr_group', fromLink.gid);
  state.groupId = fromLink.gid;
  pendingSlipId = fromLink.sid;
  store('pr_tab', 'slip');
  history.replaceState(null, '', '/');
}

// ---------------------------------------------------------------- live updates

// The server pushes "changed" the moment anyone adds or removes a leg, so every screen reloads
// right away. Phones drop the connection when locked or in another app; we reconnect and
// catch up when the app is back in front. The 20-second poll is the backup.
let live = null;
let liveRetry = null;

function setLive(on) { $('#live-status').hidden = !on; }

function disconnectLive() {
  clearTimeout(liveRetry);
  if (live) { live.close(); live = null; }
  setLive(false);
}

async function connectLive() {
  disconnectLive();
  const gid = state.groupId;
  if (!gid || !window.EventSource || document.hidden) return;
  let ticket;
  try {
    ({ ticket } = await groupApi('/live-ticket', { method: 'POST' }));
  } catch {
    liveRetry = setTimeout(connectLive, 10000);
    return;
  }
  if (gid !== state.groupId || document.hidden) return;
  const es = new EventSource(`/api/live?ticket=${encodeURIComponent(ticket)}`);
  live = es;
  es.onopen = () => { setLive(true); loadLegs(false); }; // catch up on anything missed while disconnected
  es.addEventListener('changed', () => loadLegs(false));
  es.onerror = () => {
    // Tickets are one-time, so the browser's own retry can't reuse this one. Get a new one.
    if (live !== es) return;
    es.close();
    live = null;
    setLive(false);
    clearTimeout(liveRetry);
    liveRetry = setTimeout(() => { if (state.groupId === gid) connectLive(); }, 3000);
  };
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
  resyncNotifications();
  if (store('pr_invite') && await acceptInvite()) return;
  if (state.groupId && state.groups.some((g) => g.id === state.groupId)) openGroup(state.groupId);
  else if (state.groups.length === 1) openGroup(state.groups[0].id);
  else showGroups();
}

document.addEventListener('visibilitychange', () => {
  if (!state.groupId || $('#app').hidden) return;
  if (document.hidden) return;
  loadLegs(false);
  if (!live) connectLive();
});
// Phones restoring the page from memory (back button, app switcher) don't always fire visibilitychange.
window.addEventListener('pageshow', (e) => {
  if (e.persisted && state.groupId && !$('#app').hidden) { loadLegs(false); connectLive(); }
});
window.addEventListener('online', () => { if (state.groupId && !$('#app').hidden) { loadLegs(false); connectLive(); } });

registerServiceWorker();
if (state.token) boot(); else showAuth(store('pr_invite') ? 'signup' : 'signin');
