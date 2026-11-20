import crypto from 'crypto';

export function decisionFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
}
