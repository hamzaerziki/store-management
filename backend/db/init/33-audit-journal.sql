-- 33-audit-journal.sql
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
