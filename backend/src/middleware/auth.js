import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

export const DD_ROLES = ['DD'];
export const DEPARTMENT_DD_ROLES = ['RMG'];
export const VALIDATOR_ROLES = ['CDG', 'CG', ...DD_ROLES, ...DEPARTMENT_DD_ROLES, 'DG'];
export const USER_ROLES = ['admin', 'IT', 'MG', ...VALIDATOR_ROLES];

export const PERMISSIONS = {
  manage_users: ['admin'],
  manage_stores: ['admin', ...DD_ROLES],
  edit_budget: ['IT', ...DD_ROLES, ...DEPARTMENT_DD_ROLES],
  manage_catalog: ['admin', 'IT', 'MG'],
  upload_quotes: ['admin', 'IT', 'MG', 'RMG', 'CDG', 'CG', 'DG', ...DD_ROLES],
  manage_comparisons: ['IT', 'MG'],
  update_items: ['admin', 'IT', 'MG'],
  view_quotes: ['IT', 'MG', 'CDG', 'CG', ...DD_ROLES, 'DG'],
  financial_validation: ['CDG', 'CG', ...DD_ROLES, 'DG'],
  cdg_validation: ['CDG', 'CG'],
  dd_validation: DD_ROLES,
  final_validation: ['DG'],
  view_budget: ['admin', 'CDG', 'CG', ...DD_ROLES, 'DG'],
  view_audit: ['admin', 'CDG', 'CG', ...DD_ROLES, 'DG'],
  export_reports: ['admin', ...DD_ROLES, 'DG'],
  manage_operations: ['admin', 'IT', 'MG', 'CG', 'CDG', ...DD_ROLES, ...DEPARTMENT_DD_ROLES, 'DG'],
  view_demands: ['admin', 'IT', 'MG', 'CG', 'CDG', ...DD_ROLES, 'DG'],
  manage_demands: ['admin', 'IT', 'MG', ...DD_ROLES],
};

export function departmentOf(role) {
  if (role === 'IT') return 'IT';
  if (['MG', 'RMG'].includes(role)) return 'MG';
  return null;
}

export function canValidateDepartment(role, ownerRole) {
  const department = departmentOf(role);
  if (!department) return true;
  return department === departmentOf(ownerRole);
}

export function ddRolesForOwner(ownerRole, creatorRole = null) {
  return [...DD_ROLES];
}

export const GLOBAL_READ_ROLES = ['admin', 'CDG', 'CG', ...DD_ROLES, ...DEPARTMENT_DD_ROLES, 'DG'];
export const GLOBAL_WRITE_ROLES = ['admin', 'DG', 'CDG', 'CG', ...DD_ROLES];
export const FINANCIAL_DECISION_ROLES = ['CDG', 'CG', ...DD_ROLES, 'DG'];

const NO_FINANCIAL_RIGHTS = 'L’administrateur ne dispose d’aucun droit financier implicite';

export function isAdmin(req) {
  return req.user?.role === 'admin';
}

export function assertFinancialActor(req) {
  if (isAdmin(req)) {
    const error = new Error(NO_FINANCIAL_RIGHTS);
    error.status = 403;
    throw error;
  }
}

export function denyAdminFinancial(req, res, next) {
  if (isAdmin(req)) return res.status(403).json({ error: NO_FINANCIAL_RIGHTS });
  return next();
}

export async function assignedStoreIds(userId) {
  const ids = new Set();
  if (!userId) return [];
  try {
    const r = await query(
      'SELECT DISTINCT store_id FROM store_assignments WHERE user_id=$1 AND active=true AND store_id IS NOT NULL',
      [userId]
    );
    r.rows.forEach(row => ids.add(Number(row.store_id)));
  } catch (e) {}
  try {
    const r = await query(
      'SELECT DISTINCT project_id AS store_id FROM project_members WHERE user_id=$1 AND active=true AND deleted_at IS NULL',
      [userId]
    );
    r.rows.forEach(row => ids.add(Number(row.project_id)));
  } catch (e) {}
  return [...ids].filter(Boolean);
}

export async function hasAssignment(userId, storeId, lotId = null) {
  if (!storeId || !userId) return false;
  const scoped = await query(
    `SELECT id FROM store_assignments
      WHERE user_id=$1 AND store_id=$2 AND active=true
        AND (lot_id IS NULL OR lot_id IS NOT DISTINCT FROM $3) LIMIT 1`,
    [userId, storeId, lotId || null]
  );
  if (scoped.rowCount) return true;
  try {
    const member = await query(
      'SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2 AND active=true AND deleted_at IS NULL LIMIT 1',
      [storeId, userId]
    );
    if (member.rowCount) return true;
  } catch (e) {}
  return false;
}

export async function assertAssignment(req, storeId, lotId = null, options = {}) {
  const role = req.user?.role;
  if (options.financial) assertFinancialActor(req);
  if (role === 'IT' || GLOBAL_WRITE_ROLES.includes(role)) return;
  if (!storeId) {
    const error = new Error('Affectation requise : sélectionnez un magasin');
    error.status = 403;
    throw error;
  }
  if (!(await hasAssignment(req.user.id, storeId, lotId))) {
    const error = new Error('Affectation refusée : ce magasin ne vous est pas attribué');
    error.status = 403;
    throw error;
  }
}

export async function readScope(req, column = 'store_id', startIndex = 1) {
  const role = req.user?.role;
  if (GLOBAL_READ_ROLES.includes(role)) return { clause: '', params: [], all: true };
  const ids = await assignedStoreIds(req.user.id);
  if (!ids.length) return { clause: 'AND 1=0', params: [], all: false };
  return { clause: `AND ${column} = ANY($${startIndex}::int[])`, params: [ids], all: false };
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.token || req.query?.access_token || null);
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    const r = await query('SELECT id, role, name, token_version FROM users WHERE id=$1 AND active=true', [payload.id]);
    if (!r.rows[0]) return res.status(401).json({ error: 'Session expirée ou invalide' });
    if (Number(payload.ver || 0) !== Number(r.rows[0].token_version || 0)) {
      return res.status(401).json({ error: 'Session expirée ou invalide' });
    }
    req.user = { id: r.rows[0].id, role: r.rows[0].role, name: r.rows[0].name || payload.name };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expirée ou invalide' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé pour votre rôle' });
    }
    next();
  };
}

export function can(permission) {
  return (req, res, next) => {
    const allowed = PERMISSIONS[permission] || [];
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Permission refusée : ${permission}` });
    }
    next();
  };
}

export function scope(req) {
  const role = req.user?.role;
  if (role === 'IT') return { clause: "AND i.owner_role = 'IT'", params: [] };
  if (role === 'MG') return { clause: "AND i.owner_role IN ('MG','RMG')", params: [] };
  return { clause: '', params: [] };
}

export async function ownsItem(req, itemId) {
  if (req.user.role === 'admin' || VALIDATOR_ROLES.includes(req.user.role)) return true;
  const r = await query('SELECT owner_role FROM items WHERE id = $1', [itemId]);
  if (!r.rows[0]) return false;
  if (req.user.role === 'MG') return ['MG', 'RMG'].includes(r.rows[0].owner_role);
  return r.rows[0].owner_role === req.user.role;
}

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
