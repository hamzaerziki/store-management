import dotenv from 'dotenv';
dotenv.config();

const PLACEHOLDER_SECRETS = new Set([
  'change_this_secret_in_production',
  'please_change_this_to_a_long_random_string',
  'changeme',
  'secret',
]);

function requiredSecret(value) {
  const secret = String(value || '').trim();
  if (secret.length < 32 || PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    throw new Error('JWT_SECRET must be a unique random secret of at least 32 characters. Generate one with: openssl rand -base64 48');
  }
  return secret;
}

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const config = {
  port: intEnv('PORT', 4000, 1, 65535),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: intEnv('DB_PORT', 5432, 1, 65535),
    database: process.env.DB_NAME || 'safari',
    user: process.env.DB_USER || 'safari',
    password: process.env.DB_PASSWORD || 'safari_secret',
    poolMax: intEnv('DB_POOL_MAX', 20, 2, 100),
    idleTimeoutMillis: intEnv('DB_IDLE_TIMEOUT_MS', 30000, 1000, 600000),
    connectionTimeoutMillis: intEnv('DB_CONNECTION_TIMEOUT_MS', 5000, 500, 60000),
    statementTimeoutMs: intEnv('DB_STATEMENT_TIMEOUT_MS', 20000, 1000, 300000),
  },
  jwt: {
    secret: requiredSecret(process.env.JWT_SECRET),
    expires: process.env.JWT_EXPIRES || '12h',
    issuer: 'safari-store-management',
    audience: 'safari-web',
  },
  security: {
    bcryptRounds: intEnv('BCRYPT_ROUNDS', 12, 10, 15),
    passwordMinLength: intEnv('PASSWORD_MIN_LENGTH', 12, 8, 128),
    loginMaxAttempts: intEnv('LOGIN_MAX_ATTEMPTS', 10, 3, 100),
    trustProxy: process.env.TRUST_PROXY || '1',
    allowedOrigins: String(process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
    requestTimeoutMs: intEnv('REQUEST_TIMEOUT_MS', 30000, 5000, 300000),
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  mail: {
    enabled: String(process.env.MAIL_ENABLED || 'false').toLowerCase() === 'true',
    host: process.env.SMTP_HOST || '',
    port: intEnv('SMTP_PORT', 587, 1, 65535),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@safari.local',
  },
};
