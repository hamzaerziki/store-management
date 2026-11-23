import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query } from '../db.js';
import { requireAuth, requireRole, asyncRoute, USER_ROLES } from '../middleware/auth.js';
import { audit, pickIp } from '../utils/audit.js';

const router = Router();

router.param('id', (req, res, next, value) => {
  if (value !== undefined && !/^[1-9][0-9]*$/.test(String(value))) return res.status(400).json({ error: 'Identifiant invalide' });
  req.params.id = String(Number(value));
  next();
});
router.param('resource', (req, res, next, value) => {
  const allowed = new Set(['purchase_orders','invoices','payments','incidents','claims','risks']);
  if (!allowed.has(String(value || ''))) return res.status(400).json({ error: 'Ressource invalide' });
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.security.loginMaxAttempts,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(req.body?.email || '').trim().toLowerCase().slice(0, 120)}`,
  message: { error: 'Trop de tentatives de connexion. Veuillez réessayer dans quelques instants.' },
});

function passwordError(value) {
  if (!value || String(value).length < config.security.passwordMinLength) {
    return `Le mot de passe doit contenir au moins ${config.security.passwordMinLength} caractères`;
  }
  return null;
}

router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const r = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = r.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    await audit(req, 'LOGIN_FAILED', 'user', null, { email });
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  const loginIp = pickIp(req);
  const loginUa = String(req.headers['user-agent'] || '').slice(0, 500) || null;
  await query('UPDATE users SET last_login_ip=$1, last_login_at=NOW(), last_login_user_agent=$2 WHERE id=$3', [loginIp, loginUa, user.id]).catch(e => console.error('login ip update error:', e.message));
  const token = signToken(user);
  await audit(req, 'LOGIN_SUCCESS', 'user', user.id, { email: user.email, ip: loginIp });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, must_change_password: !!user.must_change_password },
  });
}));

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT id,name,email,role,department,active,must_change_password,last_login_ip,last_login_at,created_at FROM users WHERE id = $1', [req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(r.rows[0]);
}));

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, ver: user.token_version || 0 },
    config.jwt.secret,
    {
      algorithm: 'HS256',
      expiresIn: config.jwt.expires,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    }
  );
}

router.post('/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Champs requis' });
  const invalid = passwordError(next);
  if (invalid) return res.status(400).json({ error: invalid });
  const r = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current, r.rows[0].password_hash))) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  }
  const updated = await query(
    'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1, must_change_password = FALSE WHERE id = $2 RETURNING id,name,email,role,token_version,must_change_password',
    [await bcrypt.hash(next, config.security.bcryptRounds), req.user.id]
  );
  await audit(req, 'CHANGE_PASSWORD', 'user', req.user.id, {});
  const user = updated.rows[0];
  res.json({
    ok: true,
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, must_change_password: !!user.must_change_password },
  });
}));

router.post('/register', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { name, email, password, role, department } = req.body || {};
  const invalid = passwordError(password);
  if (!name || !email || invalid || !USER_ROLES.includes(role)) {
    return res.status(400).json({ error: invalid || 'Données invalides' });
  }
  const needsDept = ['IT', 'MG', 'RMG'].includes(role);
  const dept = needsDept ? String(department || (role === 'RMG' ? 'MG' : role)).toUpperCase() : null;
  if (needsDept && !['IT', 'MG'].includes(dept)) {
    return res.status(400).json({ error: 'Département requis (IT ou MG) pour ce rôle' });
  }
  const hash = await bcrypt.hash(password, config.security.bcryptRounds);
  const r = await query(
    'INSERT INTO users (name,email,password_hash,role,department,must_change_password) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id,name,email,role,department,active,must_change_password',
    [name, email, hash, role, needsDept ? dept : null]
  );
  await audit(req, 'CREATE_USER', 'user', r.rows[0].id, { role, department: r.rows[0].department });
  res.status(201).json(r.rows[0]);
}));
router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  await audit(req, 'LOGOUT', 'user', req.user.id, { email: req.user?.email || null });
  res.json({ ok: true });
}));

export default router;

