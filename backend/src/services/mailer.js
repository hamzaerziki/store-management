import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { getSetting } from './app-settings.js';

let transporter = null;
let transporterKey = '';

function envMail() {
  return {
    enabled: Boolean(config.mail.enabled && config.mail.host && config.mail.from),
    host: config.mail.host || '',
    port: config.mail.port,
    secure: Boolean(config.mail.secure),
    user: config.mail.user || '',
    password: config.mail.password || '',
    from: config.mail.from || config.mail.user || 'no-reply@safari.local',
    source: 'env',
  };
}

export async function getMailSettings({ includeSecret = false } = {}) {
  const db = await getSetting('smtp', {});
  const env = envMail();
  const hasDb = db && typeof db === 'object' && (db.host || db.user || db.from || db.enabled !== undefined);
  const merged = hasDb ? {
    enabled: Boolean(db.enabled),
    host: String(db.host || ''),
    port: Number(db.port || env.port || 587),
    secure: Boolean(db.secure),
    user: String(db.user || ''),
    password: String(db.password || ''),
    from: String(db.from || db.user || env.from || 'no-reply@safari.local'),
    source: 'db',
  } : env;

  const configured = Boolean(merged.enabled && merged.host && merged.from);
  const response = {
    enabled: merged.enabled,
    host: merged.host,
    port: merged.port,
    secure: merged.secure,
    user: merged.user,
    from: merged.from,
    configured,
    source: merged.source,
    password_set: Boolean(merged.password),
  };
  if (includeSecret) response.password = merged.password;
  return response;
}

export async function mailConfigured() {
  const settings = await getMailSettings({ includeSecret: false });
  return settings.configured;
}

async function getTransporter() {
  const settings = await getMailSettings({ includeSecret: true });
  if (!settings.configured) return null;
  const key = JSON.stringify([settings.host, settings.port, settings.secure, settings.user, settings.password, settings.from]);
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
    });
    transporterKey = key;
  }
  return { client: transporter, settings };
}

export async function sendMail({ to, subject, text }) {
  const resolved = await getTransporter();
  if (!resolved) return { skipped: true, reason: 'mail_disabled' };
  if (!to) return { skipped: true, reason: 'no_recipient' };
  const info = await resolved.client.sendMail({
    from: resolved.settings.from,
    to,
    subject: subject || 'Notification Safari',
    text: text || '',
  });
  return { skipped: false, messageId: info.messageId };
}

export async function sendTestMail(to) {
  const resolved = await getTransporter();
  if (!resolved) throw Object.assign(new Error('SMTP non configur?'), { status: 400 });
  const target = String(to || '').trim();
  if (!target) throw Object.assign(new Error('Email de test requis'), { status: 400 });
  const info = await resolved.client.sendMail({
    from: resolved.settings.from,
    to: target,
    subject: 'Test SMTP - Safari Store Management',
    text: `Ceci est un email de test envoy? le ${new Date().toLocaleString('fr-FR')}.`,
  });
  return { ok: true, messageId: info.messageId };
}
