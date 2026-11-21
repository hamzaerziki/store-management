import { query } from '../db.js';
import { publishEvent, EVENT_KEYS } from '../services/notification-service.js';

export async function audit(req, action, entity, entityId, details = {}) {
  const user = req?.user || {};
  const forwarded = req?.headers?.['x-forwarded-for'];
  const forwardedIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '')
    .toString().split(',').map(v => v.trim()).find(Boolean);
  const realIp = req?.headers?.['x-real-ip'];
  const rawIp = forwardedIp || realIp || req?.ip || req?.socket?.remoteAddress || '';
  const ip = String(rawIp).replace(/^::ffff:/, '').trim() || null;
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
