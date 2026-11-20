import { query, tx } from '../db.js';
import { decisionFingerprint } from '../utils/decision.js';
import { badRequest, forbidden, notFound } from '../middleware/standard.js';
import { mailConfigured, sendMail } from './mailer.js';

export const DD_ROLE_CODES = ['DD'];
export const CDG_ROLE_CODES = ['CDG', 'CG'];
export const DG_ROLE_CODES = ['DG'];
export const CHANNELS = ['internal', 'email'];

export const CRITICAL_EVENTS = new Set([
  'validation_cdg',
  'validation_dd',
  'validation_finale_dg',
  'rejet_correction',
]);

export const EVENT_KEYS = [
  'demande_soumise',
  'validation_cdg',
  'validation_dd',
  'validation_finale_dg',
  'rejet_correction',
  'revision_budget_soumise',
  'revision_budget_approuvee',
  'annulation',
  'depassement_retard',
  'modification_date_ouverture',
];

export function rolesForStep(step) {
  if (step === 'DD' || step === 'dd') return DD_ROLE_CODES;
  if (step === 'DG' || step === 'dg') return DG_ROLE_CODES;
  return CDG_ROLE_CODES;
}

function withRequester(roles, ctx) {
  const ids = new Set();
  if (ctx.requester_id) ids.add(Number(ctx.requester_id));
  if (ctx.demandeur_id) ids.add(Number(ctx.demandeur_id));
  if (ctx.submitted_by) ids.add(Number(ctx.submitted_by));
  return ids;
}

function withResponsibles(roles, ctx) {
  const ids = new Set();
  for (const key of ['responsible_user_ids', 'owner_user_id', 'lot_owner_id', 'participant_ids']) {
    const value = ctx[key];
    if (Array.isArray(value)) value.forEach(id => ids.add(Number(id)));
    else if (value) ids.add(Number(value));
  }
  return ids;
}

export const EVENT_MATRIX = {
  demande_soumise: {
    label: 'Demande soumise',
    roles: ctx => rolesForStep(ctx.current_step || ctx.validator_role || 'CDG'),
    users: ctx => withRequester(null, ctx),
    critical: false,
  },
  validation_cdg: {
    label: 'Validation CDG',
    roles: () => DD_ROLE_CODES,
    users: ctx => withRequester(null, ctx),
    critical: true,
  },
  validation_dd: {
    label: 'Validation DD',
    roles: () => DG_ROLE_CODES,
    users: ctx => withRequester(null, ctx),
    critical: true,
  },
  validation_finale_dg: {
    label: 'Validation finale DG',
    roles: () => [...CDG_ROLE_CODES, ...DD_ROLE_CODES],
    users: ctx => new Set([...withRequester(null, ctx), ...withResponsibles(null, ctx)]),
    critical: true,
  },
  rejet_correction: {
    label: 'Rejet ou demande de correction',
    roles: () => [],
    users: ctx => new Set([...withRequester(null, ctx), ...withResponsibles(null, ctx)]),
    critical: true,
  },
  revision_budget_soumise: {
    label: 'Révision de budget soumise',
    roles: () => CDG_ROLE_CODES,
    users: () => new Set(),
    critical: false,
  },
  revision_budget_approuvee: {
    label: 'Révision de budget approuvée',
    roles: () => [...CDG_ROLE_CODES, ...DD_ROLE_CODES, 'IT'],
    users: ctx => withRequester(null, ctx),
    critical: false,
  },
  annulation: {
    label: 'Annulation de demande ou de budget',
    roles: () => [...CDG_ROLE_CODES, ...DG_ROLE_CODES, ...DD_ROLE_CODES],
    users: ctx => new Set([...withResponsibles(null, ctx), ...(Array.isArray(ctx.participant_ids) ? ctx.participant_ids.map(Number) : [])]),
    critical: false,
  },
  depassement_retard: {
    label: 'Dépassement ou retard critique',
    roles: ctx => {
      const severe = ['critique', 'critical', 'high', 'eleve'].includes(String(ctx.severity || '').toLowerCase());
      return [...CDG_ROLE_CODES, ...DD_ROLE_CODES, ...(severe ? DG_ROLE_CODES : [])];
    },
    users: ctx => withResponsibles(null, ctx),
    critical: false,
  },
  modification_date_ouverture: {
    label: 'Modification de la date d’ouverture',
    roles: () => [...CDG_ROLE_CODES, ...DD_ROLE_CODES, 'IT', ...DG_ROLE_CODES],
    users: ctx => new Set([...withRequester(null, ctx), ...withResponsibles(null, ctx)]),
    critical: false,
  },
};

const BUILTIN_TEMPLATES = {
  demande_soumise: {
    subject: 'Nouvelle demande à approuver — {reference}',
    body: 'La demande {reference} ({title}) du magasin {store}, d’un montant de {amount} MAD, a été soumise par {actor}. Elle attend l’approbation CDG. Lien : {link}',
  },
  validation_cdg: {
    subject: 'Demande approuvée par CDG — {reference}',
    body: 'La demande {reference} ({title}) a été approuvée par {actor}. Elle attend maintenant l’approbation {next_role}. Commentaire : {comment}. Lien : {link}',
  },
  validation_dd: {
    subject: 'Demande approuvée par DD — {reference}',
    body: 'La demande {reference} ({title}) a été approuvée par {actor}. Elle attend maintenant l’approbation DG. Commentaire : {comment}. Lien : {link}',
  },
  validation_finale_dg: {
    subject: 'Demande approuvée par DG — {reference}',
    body: 'La demande {reference} ({title}), d’un montant de {amount} MAD, a été approuvée par {actor}. Le demandeur {demandeur} est informé. Lien : {link}',
  },
  rejet_correction: {
    subject: 'Demande rejetée — {reference}',
    body: 'La demande {reference} ({title}) a été rejetée par {actor}. Motif : {reason}. Lien : {link}',
  },
  revision_budget_soumise: {
    subject: 'Révision de budget soumise — {reference}',
    body: 'Ancien budget {old_amount}, nouveau budget {new_amount}, écart {delta}. Justification : {justification}. Lien : {link}',
  },
  revision_budget_approuvee: {
    subject: 'Révision de budget approuvée — {reference}',
    body: 'Ancien budget {old_amount}, nouveau budget {new_amount}, écart {delta}. Lien : {link}',
  },
  annulation: {
    subject: 'Annulation — {reference}',
    body: 'Auteur {actor}, motif : {reason}, effet : {effect}, date : {date}. Lien : {link}',
  },
  depassement_retard: {
    subject: 'Dépassement ou retard critique — {reference}',
    body: 'Seuil {threshold}, impact {impact}, action attendue : {action}. Lien : {link}',
  },
  modification_date_ouverture: {
    subject: 'Modification de la date d’ouverture — {reference}',
    body: 'Ancienne date {previous_date}, nouvelle date {new_date}, motif : {reason}. Lien : {link}',
  },
};

export function deepLink(context = {}) {
  const projectId = context.project_id || context.store_id;
  const base = projectId ? `/projects/${projectId}` : '/dashboard';
  if (context.approval_request_id) return `${base}/approvals/${context.approval_request_id}`;
  if (context.budget_id) return `${base}/budgets/${context.budget_id}`;
  if (context.quote_id) return `${base}/quotes/${context.quote_id}`;
  if (context.commitment_id) return `${base}/commitments/${context.commitment_id}`;
  if (context.invoice_id) return `${base}/invoices/${context.invoice_id}`;
  if (context.opening) return `${base}/opening`;
  return base;
}

export function renderTemplate(text = '', payload = {}) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => {
    const value = payload[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function runner(client) {
  return client ? client.query.bind(client) : query;
}

async function resolveRecipients(context, matrixEntry, roles, client) {
  const run = runner(client);
  const ids = new Set(matrixEntry.users(context));
  const normalizedRoles = [...new Set(roles || matrixEntry.roles(context) || [])];
  if (normalizedRoles.length) {
    const scopedRoles = normalizedRoles;
    const users = await run('SELECT id FROM users WHERE active=true AND role = ANY($1::text[])', [scopedRoles]);
    users.rows.forEach(row => ids.add(Number(row.id)));
  }
  const projectId = context.project_id || context.store_id;
  if (projectId && matrixEntry === EVENT_MATRIX.revision_budget_approuvee) {
    const affected = await run(
      `SELECT user_id FROM project_members
        WHERE project_id=$1 AND active=true AND role IN ('IT','MG')`,
      [projectId]
    );
    affected.rows.forEach(row => ids.add(Number(row.user_id)));
  }
  ids.delete(null);
  ids.delete(undefined);
  ids.delete(0);
  if (context.actor_id) ids.delete(Number(context.actor_id));
  return [...ids];
}

async function loadTemplates(eventKey, client) {
  const run = runner(client);
  const r = await run('SELECT * FROM notification_templates WHERE event_key=$1 AND deleted_at IS NULL', [eventKey]);
  const fallback = BUILTIN_TEMPLATES[eventKey] || { subject: eventKey, body: '{reference} — {link}' };
  const result = {};
  for (const channel of CHANNELS) {
    const row = r.rows.find(item => item.channel === channel);
    result[channel] = row
      ? { subject: row.subject_template, body: row.body_template, enabled: row.enabled !== false }
      : { subject: fallback.subject, body: fallback.body, enabled: true };
  }
  return result;
}

async function loadRules(eventKey, client) {
  const run = runner(client);
  const r = await run('SELECT * FROM notification_rules WHERE event_key=$1 AND deleted_at IS NULL', [eventKey]);
  return r.rows;
}

async function outbox(client, payload) {
  await client.query(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb, NOW())`,
    [
      payload.actor_id || null,
      payload.actor_name || 'systeme',
      'NOTIFICATION_OUTBOX',
      'notification_event',
      payload.event_id || null,
      JSON.stringify(payload),
    ]
  );
}

export async function publishEvent(eventKey, context = {}, options = {}) {
  const matrix = EVENT_MATRIX[eventKey];
  if (!matrix) throw badRequest(`Événement de notification inconnu : ${eventKey}`, { allowed: EVENT_KEYS });
  const actorId = options.actorId ?? context.actor_id ?? null;
  const link = deepLink(context);
  const payload = {
    ...context,
    link,
    date: context.date || new Date().toISOString(),
    actor: context.actor || context.actor_name || null,
    reference: context.reference || context.reference || null,
    event_key: eventKey,
  };
  const templates = await loadTemplates(eventKey);
  payload.email_subject = renderTemplate(templates.email.subject, payload);
  payload.email_body = renderTemplate(templates.email.body, payload);
  const fingerprintSource = { ...context };
  delete fingerprintSource.date;
  delete fingerprintSource.link;
  delete fingerprintSource.email_subject;
  delete fingerprintSource.email_body;
  const fingerprint = decisionFingerprint({ eventKey, aggregate: context.aggregate_id || context.project_id || context.store_id || null, payload: fingerprintSource });
  const result = await tx(async client => {
    const recent = await client.query(
      `SELECT id, event_payload FROM notification_events
        WHERE event_key=$1 AND aggregate_type IS NOT DISTINCT FROM $2
          AND aggregate_id IS NOT DISTINCT FROM $3 AND occurred_at > NOW() - INTERVAL '10 minutes'
        ORDER BY occurred_at DESC LIMIT 20`,
      [eventKey, context.aggregate_type || null, context.aggregate_id ?? context.project_id ?? context.store_id ?? null]
    );
    if (recent.rows.some(row => row.event_payload?.fingerprint === fingerprint)) {
      return { event_id: recent.rows.find(row => row.event_payload?.fingerprint === fingerprint).id, event_key: eventKey, duplicate: true, recipients: 0, channels: [] };
    }
    const event = await client.query(
      `INSERT INTO notification_events
         (event_key, aggregate_type, aggregate_id, event_payload, occurred_at, actor_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4::jsonb, NOW(), $5, $5, $5)
       RETURNING *`,
      [
        eventKey,
        context.aggregate_type || 'project',
        context.aggregate_id ?? context.project_id ?? context.store_id ?? null,
        JSON.stringify({ ...payload, fingerprint }),
        actorId,
      ]
    );
    const eventRow = event.rows[0];
    const rules = await loadRules(eventKey, client);
    const channels = CHANNELS.filter(channel => {
      const rule = rules.find(item => item.channel === channel);
      if (!rule) return true;
      if (matrix.critical) return true;
      return rule.enabled !== false;
    });
    const created = [];
    for (const channel of channels) {
      const rule = rules.find(item => item.channel === channel);
      const roles = rule?.recipient_roles?.length ? rule.recipient_roles : matrix.roles(context);
      const userIds = await resolveRecipients(context, matrix, roles, client);
      const template = templates[channel] || BUILTIN_TEMPLATES[eventKey];
      const subject = renderTemplate(template.subject, payload);
      const body = renderTemplate(template.body, payload);
      const message = `${subject} — ${body}`;
      for (const userId of userIds) {
        const exists = await client.query(
          'SELECT id FROM notification_recipients WHERE event_id=$1 AND user_id=$2 AND channel=$3 LIMIT 1',
          [eventRow.id, userId, channel]
        );
        if (exists.rowCount) continue;
        const recipient = await client.query(
          `INSERT INTO notification_recipients
             (event_id, user_id, channel, status, retry_count, created_by, updated_by)
           VALUES ($1,$2,$3,$4,0,$5,$5)
           RETURNING *`,
          [eventRow.id, userId, channel, channel === 'internal' ? 'sent' : 'pending', actorId]
        );
        const notification = await client.query(
          `INSERT INTO notifications
             (user_id, message, type, read, event_type, object_type, object_id, event_id,
              channel, status, retry_count, created_by, updated_by, read_at)
           VALUES ($1,$2,$3,false,$4,$5,$6,$7,$8,$9,0,$10,$10,NULL)
           RETURNING *`,
          [
            userId,
            message,
            eventKey,
            eventKey,
            context.object_type || context.aggregate_type || 'project',
            context.object_id ?? context.aggregate_id ?? context.project_id ?? context.store_id ?? null,
            eventRow.id,
            channel,
            channel === 'internal' ? 'sent' : 'pending',
            actorId,
          ]
        );
        await outbox(client, {
          event_id: eventRow.id,
          recipient_id: recipient.rows[0].id,
          notification_id: notification.rows[0].id,
          user_id: userId,
          channel,
          event_key: eventKey,
          link,
          actor_id: actorId,
          correlation_id: options.correlationId || null,
        });
        created.push({ user_id: userId, channel, notification_id: notification.rows[0].id });
      }
    }
    return { event_id: eventRow.id, event_key: eventKey, duplicate: false, recipients: created, channels };
  });
  if (mailConfigured() && result.recipients?.some(row => row.channel === 'email')) {
    await deliverPendingEmails({ eventId: result.event_id, limit: 50 }).catch(error => {
      console.error('[mail] delivery failed:', error.message);
    });
  }
  return result;
}

export async function deliverPendingEmails({ eventId = null, limit = 50 } = {}) {
  if (!mailConfigured()) return { skipped: true, sent: 0, failed: 0 };
  const params = [];
  let where = "nr.channel='email' AND nr.status IN ('pending','failed') AND nr.retry_count < 5";
  if (eventId) { params.push(eventId); where += ` AND nr.event_id=$${params.length}`; }
  params.push(Math.min(500, Math.max(1, Number(limit) || 50)));
  const rows = await query(
    `SELECT nr.id AS recipient_id, nr.user_id, n.id AS notification_id,
            u.email, u.name AS user_name, u.active, ne.event_key, ne.event_payload
       FROM notification_recipients nr
       JOIN notifications n ON n.event_id=nr.event_id AND n.channel=nr.channel AND n.user_id=nr.user_id
       JOIN notification_events ne ON ne.id=nr.event_id
       JOIN users u ON u.id=nr.user_id
      WHERE ${where}
      ORDER BY nr.id
      LIMIT $${params.length}`,
    params
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows.rows) {
    try {
      if (!row.active) {
        await query(
          "UPDATE notification_recipients SET status='skipped', last_error='destinataire inactif', updated_at=NOW() WHERE id=$1",
          [row.recipient_id]
        );
        await query(
          "UPDATE notifications SET status='skipped', last_error='destinataire inactif', updated_at=NOW() WHERE id=$1",
          [row.notification_id]
        );
        continue;
      }
      const payload = row.event_payload || {};
      await sendMail({
        to: row.email,
        subject: payload.email_subject || `Notification ${row.event_key}`,
        text: payload.email_body || payload.message || `Notification ${row.event_key}`,
      });
      await query(
        "UPDATE notification_recipients SET status='sent', sent_at=COALESCE(sent_at,NOW()), updated_at=NOW() WHERE id=$1",
        [row.recipient_id]
      );
      await query(
        "UPDATE notifications SET status='sent', updated_at=NOW() WHERE id=$1",
        [row.notification_id]
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      await recordDeliveryFailure(row.recipient_id, error).catch(() => {});
    }
  }
  return { skipped: false, sent, failed };
}

export async function listRules(client) {
  const run = runner(client);
  const r = await run('SELECT * FROM notification_rules WHERE deleted_at IS NULL ORDER BY event_key, channel');
  return r.rows;
}

export async function listTemplates(client) {
  const run = runner(client);
  const r = await run('SELECT * FROM notification_templates WHERE deleted_at IS NULL ORDER BY event_key, channel, locale');
  return r.rows;
}

export async function upsertRules(entries = [], actorId = null) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) throw badRequest('Aucune règle fournie');
  const saved = [];
  for (const entry of list) {
    if (!entry.event_key || !EVENT_MATRIX[entry.event_key]) throw badRequest(`Événement inconnu : ${entry.event_key}`);
    const channel = entry.channel || 'internal';
    if (!CHANNELS.includes(channel)) throw badRequest(`Canal inconnu : ${channel}`);
    const existing = await query('SELECT * FROM notification_rules WHERE event_key=$1 AND channel=$2', [entry.event_key, channel]);
    const current = existing.rows[0];
    if (entry.enabled === false && (CRITICAL_EVENTS.has(entry.event_key) || (current && current.disableable === false))) {
      throw forbidden('Règle de notification critique : désactivation refusée');
    }
    const disableable = CRITICAL_EVENTS.has(entry.event_key) ? false : (entry.disableable === undefined ? (current?.disableable ?? true) : Boolean(entry.disableable));
    const roles = entry.recipient_roles === undefined ? (current?.recipient_roles || []) : (Array.isArray(entry.recipient_roles) ? entry.recipient_roles : [entry.recipient_roles]);
    const r = await query(
      `INSERT INTO notification_rules
         (event_key, recipient_roles, channel, reminder_delay, escalation_delay, enabled, disableable, created_by, updated_by)
       VALUES ($1,$2::text[],$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (event_key, channel) DO UPDATE SET
         recipient_roles=EXCLUDED.recipient_roles,
         reminder_delay=EXCLUDED.reminder_delay,
         escalation_delay=EXCLUDED.escalation_delay,
         enabled=EXCLUDED.enabled,
         disableable=EXCLUDED.disableable,
         updated_by=EXCLUDED.updated_by, updated_at=NOW()
       RETURNING *`,
      [
        entry.event_key,
        roles,
        channel,
        Number(entry.reminder_delay ?? current?.reminder_delay ?? 0) || 0,
        Number(entry.escalation_delay ?? current?.escalation_delay ?? 0) || 0,
        entry.enabled === undefined ? (current?.enabled ?? true) : Boolean(entry.enabled),
        disableable,
        actorId,
      ]
    );
    saved.push(r.rows[0]);
  }
  return saved;
}

export async function setRuleEnabled(ruleId, enabled, actorId = null) {
  const r = await query('SELECT * FROM notification_rules WHERE id=$1', [ruleId]);
  if (!r.rows[0]) throw notFound('Règle de notification introuvable');
  if (!enabled && (CRITICAL_EVENTS.has(r.rows[0].event_key) || r.rows[0].disableable === false)) {
    throw forbidden('Règle de notification critique : désactivation refusée');
  }
  const updated = await query('UPDATE notification_rules SET enabled=$1, updated_by=$2, updated_at=NOW() WHERE id=$3 RETURNING *', [!!enabled, actorId, ruleId]);
  return updated.rows[0];
}

export async function upsertTemplates(entries = [], actorId = null) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) throw badRequest('Aucun modèle fourni');
  const saved = [];
  for (const entry of list) {
    if (!entry.event_key || !EVENT_MATRIX[entry.event_key]) throw badRequest(`Événement inconnu : ${entry.event_key}`);
    const channel = entry.channel || 'internal';
    if (!CHANNELS.includes(channel)) throw badRequest(`Canal inconnu : ${channel}`);
    const locale = entry.locale || 'fr';
    const r = await query(
      `INSERT INTO notification_templates
         (event_key, channel, locale, subject_template, body_template, enabled, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (event_key, channel, locale) DO UPDATE SET
         subject_template=EXCLUDED.subject_template, body_template=EXCLUDED.body_template,
         enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=NOW()
       RETURNING *`,
      [
        entry.event_key,
        channel,
        locale,
        entry.subject_template || entry.subject || BUILTIN_TEMPLATES[entry.event_key].subject,
        entry.body_template || entry.body || BUILTIN_TEMPLATES[entry.event_key].body,
        entry.enabled === undefined ? true : Boolean(entry.enabled),
        actorId,
      ]
    );
    saved.push(r.rows[0]);
  }
  return saved;
}

export async function listNotifications(userId, filters = {}, pagination = { page: 1, pageSize: 20 }, options = {}) {
  const params = [];
  let where = 'n.user_id = $1';
  params.push(userId);
  if (!options.includeAll) {
    if (filters.unread_only === 'true' || filters.unread_only === true) where += ' AND n.read = false';
    if (filters.event_type) { params.push(filters.event_type); where += ` AND n.event_type = $${params.length}`; }
    if (filters.channel) { params.push(filters.channel); where += ` AND n.channel = $${params.length}`; }
  }
  if (options.includeAll && filters.user_id) { params.push(filters.user_id); where = `n.user_id = $${params.length}`; }
  const count = await query(`SELECT count(*)::int AS count FROM notifications n WHERE ${where}`, params);
  const r = await query(
    `SELECT n.*, ne.event_payload->>'link' AS deep_link, ne.occurred_at AS event_occurred_at
       FROM notifications n LEFT JOIN notification_events ne ON ne.id=n.event_id
      WHERE ${where}
      ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
    [...params, pagination.limit ?? pagination.pageSize, pagination.offset ?? ((pagination.page - 1) * pagination.pageSize)]
  );
  const unread = await query('SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND read=false', [userId]);
  return { rows: r.rows, total: count.rows[0]?.count || 0, unread_count: unread.rows[0]?.count || 0 };
}

export async function markNotificationRead(notificationId, userId, options = {}) {
  const r = await query('SELECT * FROM notifications WHERE id=$1', [notificationId]);
  if (!r.rows[0]) throw notFound('Notification introuvable');
  if (!options.includeAll && Number(r.rows[0].user_id) !== Number(userId)) throw forbidden('Accès refusé : notification appartenant à un autre utilisateur');
  const updated = await query(
    'UPDATE notifications SET read=true, read_at=COALESCE(read_at, NOW()), status=$3, updated_at=NOW() WHERE id=$1 RETURNING *',
    [notificationId, userId, 'read']
  );
  await query(
    'UPDATE notification_recipients SET status=$3, read_at=COALESCE(read_at, NOW()), updated_at=NOW() WHERE event_id=$1 AND user_id=$2 AND channel=$3',
    [r.rows[0].event_id, r.rows[0].user_id, r.rows[0].channel]
  ).catch(() => {});
  return updated.rows[0];
}

export async function recordDeliveryFailure(recipientId, error) {
  const r = await query(
    `UPDATE notification_recipients
        SET status='failed', retry_count=retry_count+1, last_error=$2, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [recipientId, String(error?.message || error || 'Erreur inconnue').slice(0, 2000)]
  );
  if (!r.rows[0]) throw notFound('Destinataire de notification introuvable');
  await query(
    'UPDATE notifications SET status=$2, retry_count=retry_count+1, last_error=$3, updated_at=NOW() WHERE event_id=$1 AND channel=$2',
    [r.rows[0].event_id, r.rows[0].channel, String(error?.message || error || '').slice(0, 2000)]
  ).catch(() => {});
  return r.rows[0];
}

export async function retryPendingNotifications(limit = 50) {
  const r = await query(
    `SELECT id FROM notification_recipients
      WHERE status='failed' AND retry_count < 5 ORDER BY id LIMIT $1`,
    [Math.min(500, Math.max(1, Number(limit) || 50))]
  );
  const retried = [];
  for (const row of r.rows) {
    const updated = await query(
      `UPDATE notification_recipients SET status='sent', sent_at=COALESCE(sent_at, NOW()), updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [row.id]
    );
    retried.push(updated.rows[0]);
  }
  return retried;
}

export async function flushOutbox(limit = 100) {
  const r = await query(
    `UPDATE notifications SET status='sent', sent_at=COALESCE(sent_at, NOW()), updated_at=NOW()
      WHERE status='pending' AND id IN (SELECT id FROM notifications WHERE status='pending' ORDER BY id LIMIT $1)
      RETURNING *`,
    [Math.min(500, Math.max(1, Number(limit) || 100))]
  );
  return r.rows;
}
