import { query } from '../db.js';
import { publishEvent, EVENT_KEYS } from '../services/notification-service.js';

function ipRank(ip) {
  if (!ip) return 0;
  const v = String(ip).trim().replace(/^::ffff:/, '');
  if (!v) return 0;
  if (v === '::1' || v === '127.0.0.1' || v.startsWith('127.')) return 1;
  if (v.startsWith('172.')) {
    const second = Number(v.split('.')[1]);
    if (second >= 16 && second <= 31) return 1; // docker/internal
  }
  if (v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('169.254.')) return 2; // LAN/private
  if (v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return 1;
  return 3; // public
}

function pickIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded || '')
    .split(',').map(v => String(v).trim().replace(/^::ffff:/, '')).filter(Boolean);
  const realIp = String(req?.headers?.['x-real-ip'] || '').trim().replace(/^::ffff:/, '');
  const remote = String(req?.ip || req?.socket?.remoteAddress || '').trim().replace(/^::ffff:/, '');
  const candidates = [...chain, realIp, remote].filter(Boolean);
  let best = null, bestRank = 0;
  for (const ip of candidates) {
    const r = ipRank(ip);
    if (r > bestRank) { best = ip; bestRank = r; }
    if (bestRank === 3) break;
  }
  return best || candidates[0] || null;
}

export async function audit(req, action, entity, entityId, details = {}) {
  const user = req?.user || {};
  const ip = pickIp(req);
  try {
    await query(
      `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,ip)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [user.id || null, user.name || 'system', action, entity, entityId || null, JSON.stringify(details), ip]
    );
  } catch (e) {
    try {
      await query(
        `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [user.id || null, user.name || 'system', action, entity, entityId || null, JSON.stringify(details)]
      );
    } catch (e2) {
      console.error('audit error:', e2.message);
    }
  }
}

const LEGACY_NOTIFY_EVENT = {
  validation: 'validation_finale_dg',
  approval: 'validation_finale_dg',
  rejection: 'rejet_correction',
  quote: 'validation_finale_dg',
  info: 'annulation',
};

export async function notifyEvent(eventKey, context = {}, options = {}) {
  const key = EVENT_KEYS.includes(eventKey) ? eventKey : LEGACY_NOTIFY_EVENT.info;
  try {
    return await publishEvent(key, context, options);
  } catch (e) {
    console.error('notify error:', e.message);
    return { error: e.message, recipients: 0, event_key: key };
  }
}

export async function notify(userIds, message, type = 'info', context = {}) {
  const recipients = [...new Set((Array.isArray(userIds) ? userIds : [userIds])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (!recipients.length) return { skipped: true, recipients: 0 };
  const eventKey = LEGACY_NOTIFY_EVENT[type] || LEGACY_NOTIFY_EVENT.info;
  return notifyEvent(eventKey, {
    ...context,
    participant_ids: recipients,
    responsible_user_ids: recipients,
    message: String(message || ''),
    reference: context.reference || String(message || '').slice(0, 120),
  }, { actorId: context.actor_id || null, correlationId: context.correlationId || null });
}

export function usersWithRoles(roles) {
  return query('SELECT id FROM users WHERE active = true AND role = ANY($1)', [roles]);
}
