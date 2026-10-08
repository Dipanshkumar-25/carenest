const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'carenest-dev-secret-change-me';

/* ---------- Database ---------- */
const db = new Database(path.join(__dirname, 'carenest.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS patients(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  gender TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','doctor','receptionist','patient')),
  phone TEXT DEFAULT '',
  specialization TEXT DEFAULT '',
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS appointments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Booked' CHECK(status IN ('Booked','Checked-in','Completed','Cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diagnosis TEXT NOT NULL,
  prescription TEXT DEFAULT '',
  follow_up TEXT DEFAULT '',
  visit_date TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

/* An older CareNest database has no patient_id column on users */
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'patient_id')) {
  console.error('\nOld CareNest database found. Stop the server, delete the file "carenest.db" in this folder, then run npm start again.\n');
  process.exit(1);
}

const localDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const today = () => localDate(0);
const addDays = (n) => localDate(n);

/* Seed demo data on first run. Set ADMIN_EMAIL to an inbox you own so the admin OTP reaches you. */
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const addUser = db.prepare('INSERT INTO users(name,email,password,role,phone,specialization) VALUES(?,?,?,?,?,?)');
  addUser.run('Clinic Admin', (process.env.ADMIN_EMAIL || 'admin@carenest.com').toLowerCase(), bcrypt.hashSync('Admin@123', 10), 'admin', '9000000001', '');
  addUser.run('Dr. Anita Mehta', 'doctor@carenest.com', bcrypt.hashSync('Doctor@123', 10), 'doctor', '9000000002', 'General Physician');
  addUser.run('Front Desk', 'reception@carenest.com', bcrypt.hashSync('Desk@123', 10), 'receptionist', '9000000003', '');
  const addPatient = db.prepare('INSERT INTO patients(name,age,gender,phone,address) VALUES(?,?,?,?,?)');
  addPatient.run('Riya Sharma', 29, 'Female', '9811122233', 'Lajpat Nagar, Delhi');
  addPatient.run('Karan Verma', 41, 'Male', '9822233344', 'Dwarka, Delhi');
  const addAppt = db.prepare('INSERT INTO appointments(patient_id,doctor_id,date,time,reason,status) VALUES(?,?,?,?,?,?)');
  addAppt.run(1, 2, today(), '10:30', 'Fever and cough', 'Booked');
  addAppt.run(2, 2, today(), '11:15', 'Routine check-up', 'Checked-in');
  addAppt.run(1, 2, addDays(-1), '09:45', 'Follow-up visit', 'Completed');
  addAppt.run(2, 2, addDays(-2), '12:00', 'Blood pressure check', 'Completed');
  addAppt.run(1, 2, addDays(-3), '15:30', 'Headache', 'Cancelled');
  addAppt.run(2, 2, addDays(1), '10:00', 'Diabetes review', 'Booked');
}

/* ---------- App setup ---------- */
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v) => /^\d{10}$/.test(v);
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  phone: u.phone, specialization: u.specialization, patient_id: u.patient_id,
});

/* ---------- Rate limit ---------- */
const attempts = new Map();
function limitLogin(req, res, next) {
  const now = Date.now();
  const rec = (attempts.get(req.ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (rec.length >= 30) return fail(res, 'Too many attempts. Try again in 15 minutes.', 429);
  rec.push(now);
  attempts.set(req.ip, rec);
  next();
}

/* ---------- Email OTP ---------- */
const OTP_TTL = 5 * 60 * 1000;
const OTP_RESEND_WAIT = 30 * 1000;
const OTP_MAX_TRIES = 5;
const challenges = new Map(); // challengeId -> { userId, hash, expires, tries, lastSent }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const maskEmail = (e) => e.replace(/^(.{1,2}).*(@.*)$/, '$1***$2');
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expires < now) challenges.delete(id);
}, 60 * 1000).unref();

const mailer =
  process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    : null;

/* Render's free plan blocks SMTP ports, so on Render use Brevo's HTTPS API (set BREVO_API_KEY + MAIL_FROM).
   Locally, Gmail SMTP (SMTP_USER + SMTP_PASS) still works as before. */
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || '';

async function sendOtp(to, name, code, purpose = 'login') {
  const safeName = String(name).replace(/[<>&]/g, '');
  const isReset = purpose === 'reset';
  const what = isReset ? 'reset your password' : 'finish signing in';
  const subject = isReset ? 'Reset your CareNest password' : 'Your CareNest verification code';
  const text = `Hi ${safeName},\n\nUse this code to ${what}: ${code}\nIt expires in 5 minutes. If this was not you, ignore this email.\n\nTeam KINGS`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #d9e7e4;border-radius:12px">
          <h2 style="color:#0e4a52;margin:0 0 8px">CareNest</h2>
          <p>Hi ${safeName}, use this code to ${what}:</p>
          <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#0e4a52;margin:16px 0">${code}</p>
          <p style="color:#5d7480;font-size:13px">It expires in 5 minutes. If this was not you, ignore this email.</p></div>`;

  if (BREVO_KEY && MAIL_FROM) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: 'CareNest', email: MAIL_FROM },
          to: [{ email: to, name: safeName }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });
      if (r.ok) return true;
      console.error('Brevo could not send email:', r.status, await r.text());
    } catch (e) {
      console.error('Brevo request failed:', e.message);
    }
  } else if (mailer) {
    try {
      await mailer.sendMail({ from: `"CareNest" <${process.env.SMTP_USER}>`, to, subject, text, html });
      return true;
    } catch (e) {
      console.error('Could not send email:', e.message);
    }
  }
  console.log(`[CareNest OTP] Email was not sent. Code for ${to} is ${code}`);
  return false;
}

async function issueChallenge(user, existingId) {
  const id = existingId || crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  challenges.set(id, { userId: user.id, hash: sha(code), expires: Date.now() + OTP_TTL, tries: 0, lastSent: Date.now() });
  const sent = await sendOtp(user.email, user.name, code);
  return { id, sent };
}

/* ---------- Auth ---------- */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const { id } = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!user) return fail(res, 'Session expired. Please sign in again.', 401);
    req.user = user;
    next();
  } catch {
    fail(res, 'Please sign in to continue.', 401);
  }
}
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : fail(res, 'You do not have permission to do this.', 403);

/* Step 1: password check, then email a code */
app.post('/api/login', limitLogin, async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!isEmail(email) || !password) return fail(res, 'Enter a valid email and password.');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) return fail(res, 'Email or password is incorrect.', 401);
  /* Each role signs in from its own tab. The tab sends its role; a mismatch is refused (checked only after the password is right). */
  const role = str(req.body.role);
  if (role && role !== user.role) return fail(res, `This account is not a ${role} account. Pick the correct login tab.`, 403);
  const { id, sent } = await issueChallenge(user);
  res.json({ otpRequired: true, challengeId: id, email: maskEmail(user.email), emailSent: sent });
});

/* Step 2: check the code */
app.post('/api/login/verify', limitLogin, (req, res) => {
  const id = str(req.body.challengeId);
  const code = str(req.body.code);
  const ch = challenges.get(id);
  if (!ch || ch.expires < Date.now()) {
    challenges.delete(id);
    return fail(res, 'This code has expired. Sign in again to get a new one.', 401);
  }
  if (!/^\d{6}$/.test(code)) return fail(res, 'Enter the 6-digit code.');
  if (sha(code) !== ch.hash) {
    ch.tries += 1;
    if (ch.tries >= OTP_MAX_TRIES) {
      challenges.delete(id);
      return fail(res, 'Too many wrong codes. Sign in again to get a new one.', 401);
    }
    return fail(res, `That code is wrong. ${OTP_MAX_TRIES - ch.tries} tries left.`, 401);
  }
  challenges.delete(id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ch.userId);
  if (!user) return fail(res, 'Account not found.', 401);
  res.json({ token: jwt.sign({ id: user.id }, SECRET, { expiresIn: '8h' }), user: publicUser(user) });
});

app.post('/api/login/resend', limitLogin, async (req, res) => {
  const id = str(req.body.challengeId);
  const ch = challenges.get(id);
  if (!ch) return fail(res, 'This session expired. Sign in again.', 401);
  const wait = OTP_RESEND_WAIT - (Date.now() - ch.lastSent);
  if (wait > 0) return fail(res, `Wait ${Math.ceil(wait / 1000)} seconds before asking for a new code.`, 429);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ch.userId);
  const r = await issueChallenge(user, id);
  res.json({ emailSent: r.sent });
});

/* ---------- Forgot password: email -> code -> new password ---------- */
const resets = new Map(); // id -> { userId|null, hash, expires, tries, lastSent, verified }
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of resets) if (c.expires < now) resets.delete(id);
}, 60 * 1000).unref();

async function issueReset(user, existingId) {
  const id = existingId || crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  resets.set(id, { userId: user ? user.id : null, hash: sha(user ? code : crypto.randomUUID()), expires: Date.now() + OTP_TTL, tries: 0, lastSent: Date.now(), verified: false });
  if (user) await sendOtp(user.email, user.name, code, 'reset');
  return id;
}

/* Same answer whether or not the email has an account, so nobody can probe which emails exist */
app.post('/api/forgot', limitLogin, async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const role = str(req.body.role);
  if (!isEmail(email)) return fail(res, 'Enter a valid email address.');
  let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (user && role && role !== user.role) user = null;
  const id = await issueReset(user);
  res.json({ challengeId: id, email: maskEmail(email) });
});

app.post('/api/forgot/resend', limitLogin, async (req, res) => {
  const id = str(req.body.challengeId);
  const ch = resets.get(id);
  if (!ch || ch.verified) return fail(res, 'This session expired. Start again.', 401);
  const wait = OTP_RESEND_WAIT - (Date.now() - ch.lastSent);
  if (wait > 0) return fail(res, `Wait ${Math.ceil(wait / 1000)} seconds before asking for a new code.`, 429);
  const user = ch.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(ch.userId) : null;
  await issueReset(user, id);
  res.json({ ok: true });
});

app.post('/api/forgot/verify', limitLogin, (req, res) => {
  const id = str(req.body.challengeId);
  const code = str(req.body.code);
  const ch = resets.get(id);
  if (!ch || ch.expires < Date.now()) {
    resets.delete(id);
    return fail(res, 'This code has expired. Start again to get a new one.', 401);
  }
  if (!/^\d{6}$/.test(code)) return fail(res, 'Enter the 6-digit code.');
  if (sha(code) !== ch.hash) {
    ch.tries += 1;
    if (ch.tries >= OTP_MAX_TRIES) {
      resets.delete(id);
      return fail(res, 'Too many wrong codes. Start again to get a new one.', 401);
    }
    return fail(res, `That code is wrong. ${OTP_MAX_TRIES - ch.tries} tries left.`, 401);
  }
  ch.verified = true;
  ch.expires = Date.now() + 10 * 60 * 1000;
  res.json({ ok: true });
});

app.post('/api/forgot/reset', limitLogin, (req, res) => {
  const id = str(req.body.challengeId);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const ch = resets.get(id);
  if (!ch || !ch.verified || ch.expires < Date.now() || !ch.userId) return fail(res, 'This session expired. Start again.', 401);
  if (password.length < 6) return fail(res, 'Password must be at least 6 characters.');
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(password, 10), ch.userId);
  resets.delete(id);
  res.json({ ok: true });
});

/* Patient sign-up */
app.post('/api/register', limitLogin, (req, res) => {
  const name = str(req.body.name);
  const age = Number(req.body.age);
  const gender = str(req.body.gender);
  const phone = str(req.body.phone);
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (name.length < 2) return fail(res, 'Enter your full name.');
  if (!Number.isInteger(age) || age < 0 || age > 120) return fail(res, 'Age must be a whole number from 0 to 120.');
  if (!['Male', 'Female', 'Other'].includes(gender)) return fail(res, 'Choose a gender.');
  if (!isPhone(phone)) return fail(res, 'Phone number must be 10 digits.');
  if (!isEmail(email)) return fail(res, 'Enter a valid email address. Your sign-in code is sent there.');
  if (password.length < 6) return fail(res, 'Password must be at least 6 characters.');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return fail(res, 'That email is already registered. Try signing in.', 409);
  const create = db.transaction(() => {
    const p = db.prepare('INSERT INTO patients(name,age,gender,phone) VALUES(?,?,?,?)').run(name, age, gender, phone);
    db.prepare("INSERT INTO users(name,email,password,role,phone,patient_id) VALUES(?,?,?,'patient',?,?)")
      .run(name, email, bcrypt.hashSync(password, 10), phone, p.lastInsertRowid);
  });
  create();
  res.status(201).json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

app.put('/api/me', auth, (req, res) => {
  const name = str(req.body.name);
  const phone = str(req.body.phone);
  if (name.length < 2) return fail(res, 'Name must be at least 2 characters.');
  if (phone && !isPhone(phone)) return fail(res, 'Phone number must be 10 digits.');
  const { current_password, new_password } = req.body;
  if (new_password) {
    if (typeof new_password !== 'string' || new_password.length < 6) return fail(res, 'New password must be at least 6 characters.');
    if (!current_password || !bcrypt.compareSync(current_password, req.user.password)) return fail(res, 'Current password is incorrect.');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  }
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, req.user.id);
  if (req.user.patient_id) db.prepare('UPDATE patients SET name=?, phone=? WHERE id=?').run(name, phone || '0000000000', req.user.patient_id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
});

/* ---------- Users / staff ---------- */
app.get('/api/doctors', auth, (req, res) => {
  res.json(db.prepare("SELECT id,name,specialization FROM users WHERE role='doctor' ORDER BY name").all());
});

app.get('/api/users', auth, allow('admin'), (req, res) => {
  res.json(db.prepare('SELECT id,name,email,role,phone,specialization FROM users ORDER BY role,name').all());
});

app.post('/api/users', auth, allow('admin'), (req, res) => {
  const name = str(req.body.name);
  const email = str(req.body.email).toLowerCase();
  const role = str(req.body.role);
  const phone = str(req.body.phone);
  const specialization = str(req.body.specialization);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (name.length < 2) return fail(res, 'Name must be at least 2 characters.');
  if (!isEmail(email)) return fail(res, 'Enter a valid email address.');
  if (!['admin', 'doctor', 'receptionist'].includes(role)) return fail(res, 'Choose a valid role.');
  if (password.length < 6) return fail(res, 'Password must be at least 6 characters.');
  if (phone && !isPhone(phone)) return fail(res, 'Phone number must be 10 digits.');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return fail(res, 'That email is already registered.', 409);
  const info = db
    .prepare('INSERT INTO users(name,email,password,role,phone,specialization) VALUES(?,?,?,?,?,?)')
    .run(name, email, bcrypt.hashSync(password, 10), role, phone, role === 'doctor' ? specialization : '');
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/users/:id', auth, allow('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return fail(res, 'You cannot delete your own account.');
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

/* ---------- Patients ---------- */
function validatePatient(b) {
  const p = {
    name: str(b.name), age: Number(b.age), gender: str(b.gender),
    phone: str(b.phone), address: str(b.address), notes: str(b.notes),
  };
  if (p.name.length < 2) return { error: 'Patient name must be at least 2 characters.' };
  if (!Number.isInteger(p.age) || p.age < 0 || p.age > 120) return { error: 'Age must be a whole number from 0 to 120.' };
  if (!['Male', 'Female', 'Other'].includes(p.gender)) return { error: 'Choose a gender.' };
  if (!isPhone(p.phone)) return { error: 'Phone number must be 10 digits.' };
  return { p };
}

app.get('/api/patients', auth, (req, res) => {
  if (req.user.role === 'patient') {
    return res.json(db.prepare('SELECT * FROM patients WHERE id=?').all(req.user.patient_id));
  }
  const q = `%${str(req.query.q)}%`;
  res.json(
    db.prepare('SELECT * FROM patients WHERE name LIKE ? OR phone LIKE ? ORDER BY created_at DESC, id DESC').all(q, q)
  );
});

app.get('/api/patients/:id', auth, (req, res) => {
  if (req.user.role === 'patient' && Number(req.params.id) !== req.user.patient_id) {
    return fail(res, 'You can only view your own records.', 403);
  }
  const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(req.params.id);
  if (!patient) return fail(res, 'Patient not found.', 404);
  const visits = db
    .prepare('SELECT v.*, u.name doctor_name FROM visits v JOIN users u ON u.id=v.doctor_id WHERE patient_id=? ORDER BY v.id DESC')
    .all(patient.id);
  const appointments = db
    .prepare('SELECT a.*, u.name doctor_name FROM appointments a JOIN users u ON u.id=a.doctor_id WHERE patient_id=? ORDER BY date DESC, time DESC')
    .all(patient.id);
  res.json({ patient, visits, appointments });
});

app.post('/api/patients', auth, allow('admin', 'receptionist', 'doctor'), (req, res) => {
  const { p, error } = validatePatient(req.body);
  if (error) return fail(res, error);
  const info = db
    .prepare('INSERT INTO patients(name,age,gender,phone,address,notes) VALUES(?,?,?,?,?,?)')
    .run(p.name, p.age, p.gender, p.phone, p.address, p.notes);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/patients/:id', auth, allow('admin', 'receptionist', 'doctor'), (req, res) => {
  const { p, error } = validatePatient(req.body);
  if (error) return fail(res, error);
  const info = db
    .prepare('UPDATE patients SET name=?,age=?,gender=?,phone=?,address=?,notes=? WHERE id=?')
    .run(p.name, p.age, p.gender, p.phone, p.address, p.notes, req.params.id);
  if (!info.changes) return fail(res, 'Patient not found.', 404);
  res.json({ ok: true });
});

app.delete('/api/patients/:id', auth, allow('admin'), (req, res) => {
  db.prepare('DELETE FROM patients WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- Appointments ---------- */
const STATUSES = ['Booked', 'Checked-in', 'Completed', 'Cancelled'];

app.get('/api/appointments', auth, (req, res) => {
  const where = [];
  const args = [];
  if (req.user.role === 'doctor') { where.push('a.doctor_id=?'); args.push(req.user.id); }
  if (req.user.role === 'patient') { where.push('a.patient_id=?'); args.push(req.user.patient_id); }
  if (STATUSES.includes(req.query.status)) { where.push('a.status=?'); args.push(req.query.status); }
  if (isDate(str(req.query.date))) { where.push('a.date=?'); args.push(req.query.date); }
  if (str(req.query.q)) { where.push('(p.name LIKE ? OR u.name LIKE ?)'); args.push(`%${str(req.query.q)}%`, `%${str(req.query.q)}%`); }
  const sql = `SELECT a.*, p.name patient_name, u.name doctor_name
    FROM appointments a
    JOIN patients p ON p.id=a.patient_id
    JOIN users u ON u.id=a.doctor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.date DESC, a.time ASC`;
  res.json(db.prepare(sql).all(...args));
});

app.post('/api/appointments', auth, allow('admin', 'receptionist', 'patient'), (req, res) => {
  const patient_id = req.user.role === 'patient' ? req.user.patient_id : Number(req.body.patient_id);
  const doctor_id = Number(req.body.doctor_id);
  const date = str(req.body.date);
  const time = str(req.body.time);
  const reason = str(req.body.reason);
  if (!db.prepare('SELECT id FROM patients WHERE id=?').get(patient_id)) return fail(res, 'Choose a patient.');
  if (!db.prepare("SELECT id FROM users WHERE id=? AND role='doctor'").get(doctor_id)) return fail(res, 'Choose a doctor.');
  if (!isDate(date)) return fail(res, 'Choose a valid date.');
  if (date < today()) return fail(res, 'Appointments cannot be booked in the past.');
  if (!isTime(time)) return fail(res, 'Choose a valid time.');
  const clash = db
    .prepare("SELECT id FROM appointments WHERE doctor_id=? AND date=? AND time=? AND status!='Cancelled'")
    .get(doctor_id, date, time);
  if (clash) return fail(res, 'That doctor already has an appointment at this time. Pick another slot.', 409);
  const info = db
    .prepare('INSERT INTO appointments(patient_id,doctor_id,date,time,reason) VALUES(?,?,?,?,?)')
    .run(patient_id, doctor_id, date, time, reason);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/appointments/:id/status', auth, (req, res) => {
  const status = str(req.body.status);
  if (!STATUSES.includes(status)) return fail(res, 'Choose a valid status.');
  const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id);
  if (!appt) return fail(res, 'Appointment not found.', 404);
  if (req.user.role === 'doctor' && appt.doctor_id !== req.user.id) return fail(res, 'This appointment belongs to another doctor.', 403);
  if (req.user.role === 'patient') {
    if (appt.patient_id !== req.user.patient_id) return fail(res, 'This is not your appointment.', 403);
    if (status !== 'Cancelled' || appt.status !== 'Booked') return fail(res, 'You can only cancel a booked appointment.', 403);
  }
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, appt.id);
  res.json({ ok: true });
});

app.delete('/api/appointments/:id', auth, allow('admin', 'receptionist'), (req, res) => {
  db.prepare('DELETE FROM appointments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- Visits (history) ---------- */
app.post('/api/patients/:id/visits', auth, allow('doctor', 'admin'), (req, res) => {
  const diagnosis = str(req.body.diagnosis);
  const prescription = str(req.body.prescription);
  const follow_up = str(req.body.follow_up);
  if (!db.prepare('SELECT id FROM patients WHERE id=?').get(req.params.id)) return fail(res, 'Patient not found.', 404);
  if (diagnosis.length < 3) return fail(res, 'Enter a diagnosis (at least 3 characters).');
  if (follow_up && !isDate(follow_up)) return fail(res, 'Choose a valid follow-up date.');
  db.prepare('INSERT INTO visits(patient_id,doctor_id,diagnosis,prescription,follow_up) VALUES(?,?,?,?,?)')
    .run(req.params.id, req.user.id, diagnosis, prescription, follow_up);
  res.status(201).json({ ok: true });
});

/* ---------- Dashboard ---------- */
app.get('/api/stats', auth, (req, res) => {
  const u = req.user;
  const col = u.role === 'doctor' ? 'doctor_id' : u.role === 'patient' ? 'patient_id' : null;
  const val = Number(u.role === 'doctor' ? u.id : u.patient_id);
  const sc = (alias = '') => (col ? ` AND ${alias}${col}=${val}` : '');
  const t = today();
  const count = (sql, ...a) => db.prepare(sql).get(...a).c;

  const week = [];
  for (let i = -6; i <= 0; i++) {
    const d = addDays(i);
    week.push({ date: d, count: count(`SELECT COUNT(*) c FROM appointments WHERE date=? AND status!='Cancelled'${sc()}`, d) });
  }
  const byStatus = {};
  STATUSES.forEach((s) => { byStatus[s] = count(`SELECT COUNT(*) c FROM appointments WHERE status=?${sc()}`, s); });

  res.json({
    patients: count('SELECT COUNT(*) c FROM patients'),
    doctors: count("SELECT COUNT(*) c FROM users WHERE role='doctor'"),
    todayTotal: count(`SELECT COUNT(*) c FROM appointments WHERE date=?${sc()}`, t),
    waiting: count(`SELECT COUNT(*) c FROM appointments WHERE date=? AND status IN ('Booked','Checked-in')${sc()}`, t),
    completedToday: count(`SELECT COUNT(*) c FROM appointments WHERE date=? AND status='Completed'${sc()}`, t),
    week,
    byStatus,
    today: db
      .prepare(`SELECT a.*, p.name patient_name, u.name doctor_name FROM appointments a
        JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.doctor_id
        WHERE a.date=?${sc('a.')} ORDER BY a.time`)
      .all(t),
    upcoming: db
      .prepare(`SELECT a.*, p.name patient_name, u.name doctor_name FROM appointments a
        JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.doctor_id
        WHERE a.date>=? AND a.status IN ('Booked','Checked-in')${sc('a.')} ORDER BY a.date, a.time LIMIT 6`)
      .all(t),
    followUps: db
      .prepare(`SELECT v.follow_up, v.diagnosis, p.id patient_id, p.name patient_name, p.phone
        FROM visits v JOIN patients p ON p.id=v.patient_id
        WHERE v.follow_up!='' AND v.follow_up BETWEEN ? AND ?${sc('v.')}
        ORDER BY v.follow_up LIMIT 8`)
      .all(t, addDays(7)),
  });
});

app.use('/api', (req, res) => fail(res, 'Not found.', 404));

app.listen(PORT, () => {
  console.log(`CareNest is running at http://localhost:${PORT}`);
  console.log(BREVO_KEY && MAIL_FROM ? `OTP emails will be sent through Brevo from ${MAIL_FROM}` : mailer ? `OTP emails will be sent from ${process.env.SMTP_USER}` : 'Email is not set up, so OTP codes will be printed in this terminal.');
});
