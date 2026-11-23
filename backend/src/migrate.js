import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run(file) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'init', file), 'utf8');
  await pool.query(sql);
  console.log(`Applied ${file}`);
}

try {
  const r = await pool.query("SELECT to_regclass('public.users') AS exists");
  if (!r.rows[0].exists) {
    await run('01-schema.sql');
    await run('02-seed.sql');
    await run('03-quote-extraction.sql');
    await run('04-service-items.sql');
    await run('05-project-spaces.sql');
    await run('06-approval-chain.sql');
    await run('07-dossier-complete.sql');
    await run('08-demands.sql');
    await run('09-demands-detail.sql');
    await run('10-store-brands.sql');
    await run('11-workflow-planning.sql');
    await run('12-dosi-role.sql');
    await run('13-quote-demand-link.sql');
    await run('14-governance.sql');
    await run('15-dossier-complete.sql');
    await run('16-dossier-backfill.sql');
    await run('17-document-lines-fiscal.sql');
    await run('18-role-swap.sql');
    await run('19-demo-assignments.sql');
    await run('20-remove-preouverture.sql');
    await run('21-clear-preouverture-reason.sql');
    await run('22-document-folders.sql');
    await run('23-store-images.sql');
    await run('24-security-hardening.sql');
    await run('25-category-budgets.sql');
    await run('26-single-store-drafts.sql');
    await run('27-backfill-workbook-quotes.sql');
    await run('28-it-category-taxonomy.sql');
    await run('29-demand-execution.sql');
    await run('30-notification-templates.sql');
    await run('31-gantt-traceability.sql');
    await run('32-execution-progress-logic.sql');
    await run('33-audit-journal.sql');
    await run('34-user-departments.sql');
    await run('35-category-french-smtp-settings.sql');
    await run('36-store-image-transform.sql');
    await run('37-fix-category-mojibake.sql');
    await run('38-remove-default-demo-users.sql');
    await run('39-user-must-change-password.sql');
    await run('40-budget-branches.sql');
  } else {
    await run('03-quote-extraction.sql');
    await run('04-service-items.sql');
    await run('05-project-spaces.sql');
    await run('06-approval-chain.sql');
    await run('07-dossier-complete.sql');
    await run('08-demands.sql');
    await run('09-demands-detail.sql');
    await run('10-store-brands.sql');
    await run('11-workflow-planning.sql');
    await run('12-dosi-role.sql');
    await run('13-quote-demand-link.sql');
    await run('14-governance.sql');
    await run('15-dossier-complete.sql');
    await run('16-dossier-backfill.sql');
    await run('17-document-lines-fiscal.sql');
    await run('18-role-swap.sql');
    await run('19-demo-assignments.sql');
    await run('20-remove-preouverture.sql');
    await run('21-clear-preouverture-reason.sql');
    await run('22-document-folders.sql');
    await run('23-store-images.sql');
    await run('24-security-hardening.sql');
    await run('25-category-budgets.sql');
    await run('26-single-store-drafts.sql');
    await run('27-backfill-workbook-quotes.sql');
    await run('28-it-category-taxonomy.sql');
    await run('29-demand-execution.sql');
    await run('30-notification-templates.sql');
    await run('31-gantt-traceability.sql');
    await run('32-execution-progress-logic.sql');
    await run('33-audit-journal.sql');
    await run('34-user-departments.sql');
    await run('35-category-french-smtp-settings.sql');
    await run('36-store-image-transform.sql');
    await run('37-fix-category-mojibake.sql');
    await run('38-remove-default-demo-users.sql');
    await run('39-user-must-change-password.sql');
    await run('40-budget-branches.sql');
    console.log('Schema already present ? migrations applied.');
  }
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

