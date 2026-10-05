/* CareNest front end - team KINGS */
const TEAM = {
  name: 'KINGS',
  members: [
    ['Dipansh Kumar', '12611923'],
    ['Rishv Rana', '12611359'],
    ['Ansh Bhardwaj', '12612099'],
  ],
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = localStorage.getItem('cn_token');
let me = null;

/* ---------- Helpers ---------- */
const todayStr = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const fmtDate = (d) =>
  d ? new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtStamp = (s) =>
  new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const badge = (s) => `<span class="badge s-${s.toLowerCase()}">${esc(s)}</span>`;
const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toast').append(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(url, method = 'GET', body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function teamHTML() {
  return `<p class="team-name">Team ${TEAM.name}</p>
    <ul class="team-list">${TEAM.members.map(([n, id]) => `<li>${esc(n)}<span>(${id})</span></li>`).join('')}</ul>`;
}

function openModal(title, html, wide) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="close" aria-label="Close">&times;</button></div>
    <div class="modal-body">${html}</div></div>`;
  const onKey = (e) => { if (e.key === 'Escape') back.close(); };
  back.close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.close(); });
  $('.close', back).onclick = back.close;
  document.addEventListener('keydown', onKey);
  $('#modal-root').append(back);
  const first = back.querySelector('input,select,textarea');
  if (first) first.focus();
  return back;
}

function bindForm(modal, handler) {
  const form = $('form', modal);
  const err = $('.form-error', form);
  const cancel = $('[data-close]', form);
  if (cancel) cancel.onclick = modal.close;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = $('button:not([type=button])', form);
    btn.disabled = true;
    try { await handler(Object.fromEntries(new FormData(form)), form); }
    catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; }
  });
}

/* ---------- Auth ---------- */
function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-team').innerHTML = teamHTML();
}

function logout() {
  token = null; me = null;
  localStorage.removeItem('cn_token');
  location.hash = '';
  showLogin();
}

/* Tabs: sign in / create account / OTP */
let challengeId = null;
let resendTimer = null;
function showAuth(which) {
  ['login', 'register', 'otp'].forEach((n) => { $(`#${n}-form`).hidden = n !== which; });
  $('#auth-tabs').hidden = which === 'otp';
  document.querySelectorAll('#auth-tabs button').forEach((b) => {
    const on = b.dataset.tab === which;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  ['login-error', 'register-error', 'otp-error'].forEach((id) => { $('#' + id).textContent = ''; });
}
document.querySelectorAll('#auth-tabs button').forEach((b) => b.addEventListener('click', () => showAuth(b.dataset.tab)));

function startResendCountdown() {
  const btn = $('#otp-resend');
  let left = 30;
  clearInterval(resendTimer);
  btn.disabled = true;
  btn.textContent = `Resend code in ${left}s`;
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = 'Resend code'; }
    else btn.textContent = `Resend code in ${left}s`;
  }, 1000);
}

function showOtp(r) {
  challengeId = r.challengeId;
  $('#otp-msg').innerHTML = `We sent a 6-digit code to <strong>${esc(r.email)}</strong>. It expires in 5 minutes.` +
    (r.emailSent ? '' : '<span class="note" style="display:block;margin-top:.6rem">The email could not be sent. Ask the person running the server to check the email settings, or read the code in the server terminal.</span>');
  $('#otp-form').reset();
  showAuth('otp');
  $('#otp-form').code.focus();
  startResendCountdown();
}

/* Step 1: email + password */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  if (!f.email.trim() || !f.password) { err.textContent = 'Enter your email and password.'; return; }
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true; btn.textContent = 'Sending code...';
  try { showOtp(await api('/login', 'POST', f)); }
  catch (x) { err.textContent = x.message; }
  finally { btn.disabled = false; btn.textContent = 'Continue'; }
});

/* Step 2: the code */
$('#otp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#otp-error');
  err.textContent = '';
  try {
    const r = await api('/login/verify', 'POST', { challengeId, code: e.target.code.value });
    token = r.token; me = r.user;
    localStorage.setItem('cn_token', token);
    clearInterval(resendTimer);
    $('#login-form').reset();
    showAuth('login');
    showApp();
  } catch (x) { err.textContent = x.message; }
});
$('#otp-resend').onclick = async () => {
  try {
    const r = await api('/login/resend', 'POST', { challengeId });
    toast(r.emailSent ? 'New code sent' : 'Code generated. Email could not be sent.', r.emailSent ? '' : 'error');
    startResendCountdown();
  } catch (x) { $('#otp-error').textContent = x.message; }
};
$('#otp-back').onclick = () => { clearInterval(resendTimer); challengeId = null; showAuth('login'); };

/* Patient sign-up */
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#register-error');
  err.textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  try {
    await api('/register', 'POST', f);
    toast('Account created. Sign in to continue.');
    e.target.reset();
    showAuth('login');
    $('#login-form').email.value = f.email;
    $('#login-form').password.focus();
  } catch (x) { err.textContent = x.message; }
  finally { btn.disabled = false; }
});

/* Light / dark theme */
function applyTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('cn_theme', t); }
applyTheme(localStorage.getItem('cn_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

document.querySelectorAll('[data-fill]').forEach((b) =>
  b.addEventListener('click', () => {
    const [em, pw] = b.dataset.fill.split('|');
    const f = $('#login-form');
    f.email.value = em; f.password.value = pw;
  })
);

$('#logout-btn').onclick = logout;
$('#menu-btn').onclick = () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#menu-btn').setAttribute('aria-expanded', open);
};

/* ---------- Shell & routing ---------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  patients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.500 2.400 6.500 6"/><circle cx="17.500" cy="9" r="2.500"/><path d="M17 14.200c2.600.2 4.500 2 4.500 4.800"/>',
  appointments: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  staff: '<path d="M12 3l8 3v6c0 4.500-3.200 7.700-8 9-4.800-1.300-8-4.500-8-9V6z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.400 3.600-7 8-7s8 2.600 8 7"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.5"/>',
};
const STAFF_ROLES = ['admin', 'doctor', 'receptionist'];
const NAV = [
  ['dashboard', 'Dashboard'],
  ['patients', 'Patients', STAFF_ROLES],
  ['appointments', 'Appointments'],
  ['staff', 'Staff', ['admin']],
  ['profile', 'My profile'],
  ['about', 'About'],
];

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#who-name').textContent = me.name;
  $('#who-role').textContent = me.role;
  $('#who-avatar').textContent = me.name.replace(/^Dr\.?\s*/i, '').charAt(0).toUpperCase();
  $('#nav').innerHTML = NAV.filter((n) => !n[2] || n[2].includes(me.role))
    .map(([id, label]) => `<a href="#/${id}" data-r="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>${label}</a>`).join('');
  $('#app-team').innerHTML = teamHTML();
  route();
}

const routes = {};
async function route() {
  if (!me) return;
  let r = location.hash.replace('#/', '') || 'dashboard';
  const nav = NAV.find((n) => n[0] === r);
  if (!routes[r] || (nav && nav[2] && !nav[2].includes(me.role))) r = 'dashboard';
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.r === r);
    if (a.dataset.r === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#sidebar').classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  $('#view').innerHTML = '<p class="muted">Loading...</p>';
  try { await routes[r](); }
  catch (e) { $('#view').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

/* ---------- Shared: status dropdown ---------- */
const STATUSES = ['Booked', 'Checked-in', 'Completed', 'Cancelled'];
const statusSelect = (a) => {
  if (me.role === 'patient') {
    return badge(a.status) + (a.status === 'Booked' ? ` <button class="btn small danger" data-cancel="${a.id}">Cancel</button>` : '');
  }
  return `<select class="status-select" data-id="${a.id}" aria-label="Status for ${esc(a.patient_name)}">
    ${STATUSES.map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
};

function bindStatus(root, reload) {
  root.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Cancel this appointment?')) return;
      try {
        await api(`/appointments/${b.dataset.cancel}/status`, 'PUT', { status: 'Cancelled' });
        toast('Appointment cancelled');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    })
  );
  root.querySelectorAll('.status-select').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await api(`/appointments/${sel.dataset.id}/status`, 'PUT', { status: sel.value });
        toast('Status changed to ' + sel.value);
        reload();
      } catch (e) { toast(e.message, 'error'); reload(); }
    })
  );
}

/* ---------- Dashboard ---------- */
routes.dashboard = async function () {
  const s = await api('/stats');
  const isPatient = me.role === 'patient';
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const canBook = ['admin', 'receptionist', 'patient'].includes(me.role);
  const first = esc(me.name.replace(/^Dr\.?\s*/i, '').split(' ')[0]);
  const cards = isPatient
    ? [[s.byStatus.Booked + s.byStatus['Checked-in'], 'Upcoming visits'], [s.byStatus.Completed, 'Visits completed'], [s.followUps.length, 'Follow-ups this week'], [s.byStatus.Cancelled, 'Cancelled']]
    : [[s.todayTotal, 'Appointments today'], [s.waiting, 'Still to be seen'], [s.completedToday, 'Completed today'], [s.patients, 'Registered patients']];
  const maxWeek = Math.max(1, ...s.week.map((d) => d.count));
  const total = Object.values(s.byStatus).reduce((a, b) => a + b, 0);
  const cls = { Booked: 'c-booked', 'Checked-in': 'c-checked-in', Completed: 'c-completed', Cancelled: 'c-cancelled' };
  const charts = isPatient ? '' : `
    <div class="charts">
      <div class="card"><h3>Appointments, last 7 days</h3>
        <div class="bars">${s.week.map((d, i) => `<div class="bar ${i === 6 ? 'today' : ''}"><i style="height:${Math.max(3, (d.count / maxWeek) * 78)}%"><b>${d.count}</b></i><span>${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</span></div>`).join('')}</div>
      </div>
      <div class="card"><h3>Appointment status</h3>
        <div class="stack" role="img" aria-label="Appointment status breakdown">${total ? STATUSES.map((st) => `<i class="${cls[st]}" style="width:${(s.byStatus[st] / total) * 100}%"></i>`).join('') : ''}</div>
        <ul class="legend">${STATUSES.map((st) => `<li><em class="${cls[st]}"></em>${st}<b>${s.byStatus[st]}</b></li>`).join('')}</ul>
      </div>
    </div>`;
  const list = isPatient ? s.upcoming : s.today;
  const listTitle = isPatient ? 'Your upcoming appointments' : "Today's schedule";
  const listHtml = list.length
    ? `<div class="table-wrap"><table><thead><tr>${isPatient ? '<th>Date</th>' : ''}<th>Time</th>${isPatient ? '' : '<th>Patient</th>'}<th>Doctor</th><th>Status</th></tr></thead><tbody>
      ${list.map((a) => `<tr>${isPatient ? `<td>${fmtDate(a.date)}</td>` : ''}<td>${fmtTime(a.time)}</td>${isPatient ? '' : `<td>${esc(a.patient_name)}</td>`}<td>${esc(a.doctor_name)}</td><td>${statusSelect(a)}</td></tr>`).join('')}
      </tbody></table></div>`
    : `<p class="empty">${isPatient ? 'No upcoming appointments. Book one to get started.' : 'No appointments today.'}</p>`;
  $('#view').innerHTML = `
    <div class="page-head">
      <div><h2>${greet}, ${first}</h2>
        <p>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="actions">
        ${isPatient ? '<button class="btn" id="my-records">My records</button>' : ''}
        ${canBook ? '<button class="btn primary" id="new-appt">Book appointment</button>' : ''}
      </div>
    </div>
    <div class="stats">${cards.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
    ${charts}
    <div class="two-col">
      <div class="card"><h3>${listTitle}</h3>${listHtml}</div>
      <div class="card"><h3>Follow-ups in the next 7 days</h3>
        ${s.followUps.length ? `<ul class="list">${s.followUps.map((f) =>
          `<li ${isPatient ? '' : `data-pid="${f.patient_id}"`}><div><strong>${esc(f.patient_name)}</strong><small>${esc(f.diagnosis)}</small></div><span>${fmtDate(f.follow_up)}</span></li>`).join('')}</ul>`
          : '<p class="empty">No follow-ups due this week.</p>'}
      </div>
    </div>`;
  bindStatus($('#view'), routes.dashboard);
  const nb = $('#new-appt');
  if (nb) nb.onclick = () => apptForm(isPatient ? me.patient_id : null, routes.dashboard);
  const mr = $('#my-records');
  if (mr) mr.onclick = () => openPatient(me.patient_id, routes.dashboard);
  document.querySelectorAll('li[data-pid]').forEach((li) => li.onclick = () => openPatient(li.dataset.pid, routes.dashboard));
};

/* ---------- Patients ---------- */
routes.patients = async function () {
  $('#view').innerHTML = `
    <div class="page-head"><div><h2>Patients</h2><p>Search by name or phone number.</p></div>
      <button class="btn primary" id="add-patient">Add patient</button></div>
    <div class="card">
      <div class="filters"><input type="search" id="p-search" placeholder="Search patients" aria-label="Search patients"></div>
      <div id="p-table"></div>
    </div>`;
  const load = async () => {
    const list = await api('/patients?q=' + encodeURIComponent($('#p-search').value));
    $('#p-table').innerHTML = list.length
      ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Age</th><th>Gender</th><th>Phone</th><th>Registered</th></tr></thead><tbody>
        ${list.map((p) => `<tr class="click" data-id="${p.id}" tabindex="0"><td><strong>${esc(p.name)}</strong></td><td>${p.age}</td><td>${esc(p.gender)}</td><td>${esc(p.phone)}</td><td>${fmtStamp(p.created_at)}</td></tr>`).join('')}
        </tbody></table></div>`
      : '<p class="empty">No patients found. Add a patient to get started.</p>';
    document.querySelectorAll('#p-table tr.click').forEach((tr) => {
      const open = () => openPatient(tr.dataset.id, load);
      tr.onclick = open;
      tr.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    });
  };
  $('#p-search').addEventListener('input', debounce(() => load().catch((e) => toast(e.message, 'error'))));
  $('#add-patient').onclick = () => patientForm(null, load);
  await load();
};

function patientForm(p, done) {
  p = p || {};
  const m = openModal(p.id ? 'Edit patient' : 'Add patient', `<form>
    <label>Full name<input name="name" required minlength="2" value="${esc(p.name)}"></label>
    <div class="grid-2">
      <label>Age<input name="age" type="number" min="0" max="120" required value="${esc(p.age)}"></label>
      <label>Gender<select name="gender" required>${['Male', 'Female', 'Other'].map((g) => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    </div>
    <label>Phone (10 digits)<input name="phone" inputmode="numeric" pattern="\\d{10}" maxlength="10" required title="Enter a 10 digit phone number" value="${esc(p.phone)}"></label>
    <label>Address<input name="address" value="${esc(p.address)}"></label>
    <label>Medical notes<textarea name="notes">${esc(p.notes)}</textarea></label>
    <p class="form-error" role="alert"></p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save patient</button></div>
  </form>`);
  bindForm(m, async (data) => {
    await api(p.id ? '/patients/' + p.id : '/patients', p.id ? 'PUT' : 'POST', data);
    toast(p.id ? 'Patient updated' : 'Patient added');
    m.close();
    done && done();
  });
}

async function openPatient(id, refresh) {
  let d;
  try { d = await api('/patients/' + id); } catch (e) { return toast(e.message, 'error'); }
  const { patient: p, visits, appointments } = d;
  const canVisit = ['doctor', 'admin'].includes(me.role);
  const canBook = ['admin', 'receptionist', 'patient'].includes(me.role);
  const m = openModal(p.name, `
    <div class="kv">
      <div><small>Age</small>${p.age}</div><div><small>Gender</small>${esc(p.gender)}</div>
      <div><small>Phone</small>${esc(p.phone)}</div><div><small>Address</small>${esc(p.address) || 'Not added'}</div>
    </div>
    ${p.notes ? `<p><strong>Notes:</strong> ${esc(p.notes)}</p>` : ''}
    <div class="actions spaced">
      ${me.role !== 'patient' ? '<button class="btn small" id="pd-edit">Edit details</button>' : ''}
      ${canBook ? '<button class="btn small" id="pd-book">Book appointment</button>' : ''}
      ${me.role === 'admin' ? '<button class="btn small danger" id="pd-del">Delete patient</button>' : ''}
    </div>
    <h3>Visit history</h3>
    ${visits.length ? `<ul class="timeline">${visits.map((v) => `<li><time>${fmtStamp(v.visit_date)} with ${esc(v.doctor_name)}</time>
      <p><strong>${esc(v.diagnosis)}</strong></p>
      ${v.prescription ? `<p>Prescription: ${esc(v.prescription)}</p>` : ''}
      ${v.follow_up ? `<p class="muted">Follow-up on ${fmtDate(v.follow_up)}</p>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">No visits recorded yet.</p>'}
    ${canVisit ? `<form id="visit-form"><h3>Record a visit</h3>
      <label>Diagnosis<input name="diagnosis" required minlength="3"></label>
      <label>Prescription<textarea name="prescription"></textarea></label>
      <label>Follow-up date (optional)<input name="follow_up" type="date" min="${todayStr()}"></label>
      <p class="form-error" role="alert"></p>
      <button class="btn primary">Save visit</button></form>` : ''}
    <h3 style="margin-top:1.4rem">Appointments</h3>
    ${appointments.length ? `<ul class="list">${appointments.map((a) => `<li><div><strong>${fmtDate(a.date)} at ${fmtTime(a.time)}</strong><small>${esc(a.doctor_name)}${a.reason ? ', ' + esc(a.reason) : ''}</small></div>${badge(a.status)}</li>`).join('')}</ul>`
      : '<p class="muted">No appointments yet.</p>'}
  `, true);
  const reopen = () => { m.close(); openPatient(id, refresh); refresh && refresh(); };
  const edit = $('#pd-edit');
  if (edit) edit.onclick = () => patientForm(p, reopen);
  const book = $('#pd-book');
  if (book) book.onclick = () => apptForm(p.id, reopen);
  const del = $('#pd-del');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${p.name} and all their records? This cannot be undone.`)) return;
    try { await api('/patients/' + p.id, 'DELETE'); toast('Patient deleted'); m.close(); refresh && refresh(); }
    catch (e) { toast(e.message, 'error'); }
  };
  if (canVisit) bindForm(m, async (data) => {
    await api(`/patients/${p.id}/visits`, 'POST', data);
    toast('Visit saved');
    reopen();
  });
}

/* ---------- Appointments ---------- */
routes.appointments = async function () {
  const canManage = ['admin', 'receptionist'].includes(me.role);
  const canBook = canManage || me.role === 'patient';
  $('#view').innerHTML = `
    <div class="page-head"><div><h2>Appointments</h2><p>${['doctor', 'patient'].includes(me.role) ? 'Your appointments.' : 'All clinic appointments.'}</p></div>
      ${canBook ? '<button class="btn primary" id="new-appt">Book appointment</button>' : ''}</div>
    <div class="card">
      <div class="filters">
        <input type="search" id="a-q" placeholder="Search patient or doctor" aria-label="Search appointments">
        <select id="a-status" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
        <input type="date" id="a-date" aria-label="Filter by date">
      </div>
      <div id="a-table"></div>
    </div>`;
  const load = async () => {
    const qs = new URLSearchParams({ q: $('#a-q').value, status: $('#a-status').value, date: $('#a-date').value });
    const list = await api('/appointments?' + qs);
    $('#a-table').innerHTML = list.length
      ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th>${canManage ? '<th></th>' : ''}</tr></thead><tbody>
        ${list.map((a) => `<tr><td>${fmtDate(a.date)}</td><td>${fmtTime(a.time)}</td><td>${esc(a.patient_name)}</td><td>${esc(a.doctor_name)}</td><td>${esc(a.reason) || '-'}</td><td>${statusSelect(a)}</td>
          ${canManage ? `<td><button class="btn small danger" data-del="${a.id}">Delete</button></td>` : ''}</tr>`).join('')}
        </tbody></table></div>`
      : '<p class="empty">No appointments match these filters.</p>';
    bindStatus($('#a-table'), load);
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this appointment?')) return;
      try { await api('/appointments/' + b.dataset.del, 'DELETE'); toast('Appointment deleted'); load(); }
      catch (e) { toast(e.message, 'error'); }
    });
  };
  const reload = debounce(() => load().catch((e) => toast(e.message, 'error')));
  ['#a-q', '#a-status', '#a-date'].forEach((s) => $(s).addEventListener('input', reload));
  const nb = $('#new-appt');
  if (nb) nb.onclick = () => apptForm(me.role === 'patient' ? me.patient_id : null, load);
  await load();
};

async function apptForm(presetPatient, done) {
  let patients, doctors;
  try { [patients, doctors] = await Promise.all([api('/patients'), api('/doctors')]); }
  catch (e) { return toast(e.message, 'error'); }
  if (!patients.length) return toast('Add a patient first.', 'error');
  if (!doctors.length) return toast('Add a doctor in Staff first.', 'error');
  const m = openModal('Book appointment', `<form>
    ${me.role === 'patient' ? `<input type="hidden" name="patient_id" value="${me.patient_id}">` : `<label>Patient<select name="patient_id" required><option value="">Choose a patient</option>
      ${patients.map((p) => `<option value="${p.id}" ${p.id == presetPatient ? 'selected' : ''}>${esc(p.name)} (${esc(p.phone)})</option>`).join('')}</select></label>`}
    <label>Doctor<select name="doctor_id" required><option value="">Choose a doctor</option>
      ${doctors.map((d) => `<option value="${d.id}">${esc(d.name)}${d.specialization ? ', ' + esc(d.specialization) : ''}</option>`).join('')}</select></label>
    <div class="grid-2">
      <label>Date<input name="date" type="date" min="${todayStr()}" value="${todayStr()}" required></label>
      <label>Time<input name="time" type="time" required></label>
    </div>
    <label>Reason for visit<input name="reason" maxlength="200"></label>
    <p class="form-error" role="alert"></p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Book appointment</button></div>
  </form>`);
  bindForm(m, async (data) => {
    await api('/appointments', 'POST', data);
    toast('Appointment booked');
    m.close();
    done && done();
  });
}

/* ---------- Staff (admin) ---------- */
routes.staff = async function () {
  const users = await api('/users');
  $('#view').innerHTML = `
    <div class="page-head"><div><h2>Staff</h2><p>Add doctors and front-desk staff, and control who can sign in.</p></div>
      <button class="btn primary" id="add-user">Add staff member</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><strong>${esc(u.name)}</strong>${u.specialization ? `<br><small class="muted">${esc(u.specialization)}</small>` : ''}</td>
        <td><span class="badge role-${u.role}">${u.role}</span></td><td>${esc(u.email)}</td><td>${esc(u.phone) || '-'}</td>
        <td>${u.id === me.id ? '<span class="muted">You</span>' : `<button class="btn small danger" data-del="${u.id}">Remove</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  $('#add-user').onclick = () => {
    const m = openModal('Add staff member', `<form>
      <label>Full name<input name="name" required minlength="2"></label>
      <label>Email<input name="email" type="email" required></label>
      <div class="grid-2">
        <label>Role<select name="role" id="u-role" required><option value="doctor">Doctor</option><option value="receptionist">Receptionist</option><option value="admin">Admin</option></select></label>
        <label>Phone<input name="phone" inputmode="numeric" pattern="\\d{10}" maxlength="10" title="Enter a 10 digit phone number"></label>
      </div>
      <label id="u-spec">Specialization<input name="specialization" placeholder="For example: Dentist"></label>
      <label>Temporary password<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
      <p class="form-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add staff member</button></div>
    </form>`);
    const role = $('#u-role', m);
    role.onchange = () => { $('#u-spec', m).hidden = role.value !== 'doctor'; };
    bindForm(m, async (data) => {
      await api('/users', 'POST', data);
      toast('Staff member added');
      m.close();
      routes.staff();
    });
  };
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this staff member? Their appointments will also be deleted.')) return;
    try { await api('/users/' + b.dataset.del, 'DELETE'); toast('Staff member removed'); routes.staff(); }
    catch (e) { toast(e.message, 'error'); }
  });
};

/* ---------- Profile ---------- */
routes.profile = async function () {
  $('#view').innerHTML = `
    <div class="page-head"><div><h2>My profile</h2><p>Update your details or change your password.</p></div></div>
    <div class="card" style="max-width:560px"><form id="pf">
      <label>Full name<input name="name" required minlength="2" value="${esc(me.name)}"></label>
      <label>Email<input value="${esc(me.email)}" disabled></label>
      <label>Phone<input name="phone" inputmode="numeric" pattern="\\d{10}" maxlength="10" title="Enter a 10 digit phone number" value="${esc(me.phone)}"></label>
      <h3>Change password</h3>
      <label>Current password<input name="current_password" type="password" autocomplete="current-password"></label>
      <label>New password (at least 6 characters)<input name="new_password" type="password" minlength="6" autocomplete="new-password"></label>
      <p class="form-error" role="alert"></p>
      <button class="btn primary">Save changes</button>
    </form></div>`;
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', e.target);
    err.textContent = '';
    const data = Object.fromEntries(new FormData(e.target));
    if (!data.new_password) { delete data.new_password; delete data.current_password; }
    try {
      me = await api('/me', 'PUT', data);
      $('#who-name').textContent = me.name;
      toast('Profile saved');
      e.target.current_password.value = ''; e.target.new_password.value = '';
    } catch (x) { err.textContent = x.message; }
  });
};

/* ---------- About ---------- */
routes.about = async function () {
  $('#view').innerHTML = `
    <div class="page-head"><div><h2>About CareNest</h2><p>A clinic management system built by team ${TEAM.name}.</p></div></div>
    <div class="card">
      <h3>What CareNest does</h3>
      <p>CareNest replaces paper registers and scattered notes. Front-desk staff register patients and book appointments, doctors record visits and follow-ups, and admins manage who can sign in.</p>
      <h3>Team ${TEAM.name}</h3>
      <div class="team-cards">${TEAM.members.map(([n, id]) =>
        `<div class="member"><div class="avatar">${esc(n.charAt(0))}</div><b>${esc(n)}</b><span>${id}</span></div>`).join('')}</div>
    </div>`;
};

/* ---------- Start ---------- */
(async function init() {
  if (!token) return showLogin();
  try { me = await api('/me'); showApp(); }
  catch { showLogin(); }
})();
