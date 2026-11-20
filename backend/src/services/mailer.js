import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;

export function mailConfigured() {
  return Boolean(config.mail.enabled && config.mail.host && config.mail.from);
}

function getTransporter() {
  if (!mailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user
        ? { user: config.mail.user, pass: config.mail.password }
        : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, text }) {
  const client = getTransporter();
  if (!client) return { skipped: true, reason: 'mail_disabled' };
  if (!to) return { skipped: true, reason: 'no_recipient' };
  const info = await client.sendMail({
    from: config.mail.from,
    to,
    subject: subject || 'Notification Safari',
    text: text || '',
  });
  return { skipped: false, messageId: info.messageId };
}
