# Security Remediation Plan

## Dependency Audit (2026-11-22, container images)

### Backend (`npm audit --omit=dev`)
- **high**: `zod <4.6.6` - memory exhaustion on oversized constrained collections (GHSA-mrhx-c7xc-m3w5). Fix: upgrade to `zod@^4.6.7` (breaking) or remove constrained large-schema parsing on untrusted input; current `validate.js` scaffold not widely used.
- **moderate**: `uuid <11.1.1` via `exceljs` chain (GHSA-w5hq-g745-h8pq). Fix: upgrade `exceljs` to version with fixed uuid dependency when available; monitor upstream.
- **high/moderate reported by npm**: `nodemailer` advisories listed by npm include domain/TLS/DoS parsing issues; installed `nodemailer@^7.0.11` in manifest. Action: pin/test latest 7.x/8.x safe release in CI; disable dangerous transport features, keep `disableFileAccess`/`disableUrlAccess` defaults, validate recipient domains.
- **xlsx** removed from code path and replaced with `exceljs`.

### Frontend (`npm audit --omit=dev`)
- **moderate**: `react-router` / `react-router-dom` 6.x advisories. Manifest bumped to `^6.30.3`; npm still reports moderate for resolved 6.x line. Fix: evaluate migration to `react-router-dom@7.x` (breaking), add redirect/SSR guards, run full UI regression.

## CI Security Gates (recommended)
1. **Dependency scan**: `npm audit --omit=dev --audit-level=high` (backend/frontend), fail on high/critical.
2. **SAST**: CodeQL or Semgrep JS/TS ruleset (`security-audit`, `nodejs`, `react`).
3. **Secret scan**: gitleaks/trufflehog on push/PR; block `.env`, tokens, SMTP passwords.
4. **AuthZ regression**: API tests per `docs/authz-matrix.md` for 401/403/404 cases (unauth, wrong role, unassigned store, owner-only, admin-only).
5. **Container/image scan**: Trivy/Grype on built images.
6. **E2E smoke**: login, dashboard store/detail/reporting, file token view/download expiry, demand workflow, SMTP test endpoint with mock SMTP.

## Manual/E2E Checklist
- SMTP: configure real DB SMTP settings, send `/api/settings/smtp/test`, verify delivery and audit log.
- Role workflows: admin, CDG/CG, DD, DG, IT, MG, RMG; draft->pending_cdg->pending_dd->pending_dg->approved/rejected.
- File tokens: issue, view/download with `ft`, reject missing/expired/tampered/revoked-after-password-reset, reject unassigned user.
- KPI/graphs: dashboard global/store/reporting numbers match DB; refetch on focus; no mock values.
- Store tabs: all tabs load without `/api/dashboard/store/:id` 500; images/transforms render.
- CSP: validate PDF/image/video previews, uploads, inline styles, websocket/SSE if used; tighten directives after evidence.
