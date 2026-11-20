import { Router } from 'express';
import { tx, query } from '../../db.js';
import { asyncV1, setETag, badRequest, forbidden, precondition } from '../../middleware/standard.js';
import {
  auditInTx, assertAssignment, assertWritable, effectiveRole, parseId,
} from './shared.js';
import { avancementProjet, fetchAvancementProjet } from '../../utils/finance.js';

const router = Router();

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw badRequest('Avancement invalide : nombre attendu');
  return Math.round(Math.min(100, Math.max(0, number)) * 100) / 100;
}

router.patch('/tasks/:id/progress', asyncV1(async (req, res) => {
  const id = parseId(req.params.id, 'tâche');
  if (req.body?.progress_pct === undefined && req.body?.progress === undefined) {
    throw badRequest('progress_pct requis');
  }
  const progress = clampProgress(req.body.progress_pct ?? req.body.progress);
  const found = (await query(
    `SELECT t.*, wp.project_id, wp.owner_user_id AS package_owner_id
       FROM tasks t JOIN work_packages wp ON wp.id=t.package_id
      WHERE t.id=$1 AND t.deleted_at IS NULL`,
    [id]
  )).rows[0];
  if (!found) throw badRequest('Tâche introuvable');
  await assertWritable(req, found.project_id);
  await assertAssignment(req, found.project_id, found.package_id);
  const role = await effectiveRole(req, found.project_id, found.package_id);
  if (role !== 'DD' && role !== 'RMG' && role !== 'DG' && role !== 'CDG' && role !== 'CG' && role !== 'IT' && role !== 'MG') {
    throw forbidden('Rôle non autorisé à modifier l’avancement des tâches');
  }
  if (Number(found.progress_pct) !== progress && !String(req.body?.justification || '').trim()) {
    throw badRequest('Justification obligatoire pour modifier l’avancement d’une tâche');
  }
  const header = req.get('If-Match');
  if (header && header !== '*') {
    const expected = header.replace(/^W\//, '').replace(/^"|"$/g, '').trim();
    if (expected !== String(found.row_version)) {
      throw precondition(`Conflit de concurrence sur la tâche : version attendue ${expected}, version actuelle ${found.row_version}`, {
        expected, current: found.row_version,
      });
    }
  }
  const result = await tx(async client => {
    const locked = await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [id]);
    if (!locked.rowCount) throw badRequest('Tâche introuvable');
    const before = locked.rows[0];
    const nextState = progress >= 100 ? 'terminee' : progress > 0 ? 'en_cours' : 'a_faire';
    const updated = await client.query(
      `UPDATE tasks SET progress_pct=$1, status=$2, updated_by=$3, updated_at=NOW()
        WHERE id=$4 RETURNING *`,
      [progress, nextState, req.user.id, id]
    );
    const allTasks = await client.query(
      `SELECT t.weight, t.progress_pct FROM tasks t
         JOIN work_packages wp ON wp.id=t.package_id
        WHERE wp.project_id=$1 AND t.deleted_at IS NULL AND t.weight > 0`,
      [found.project_id]
    );
    const projectProgress = avancementProjet(allTasks.rows);
    await client.query(
      'UPDATE stores SET progress_justification=$1, updated_by=$2, updated_at=NOW() WHERE id=$3',
      [req.body?.justification || null, req.user.id, found.project_id]
    );
    await auditInTx(client, req, 'TASK_PROGRESS_UPDATE', 'task', id, {
      before: { progress_pct: before.progress_pct, row_version: before.row_version },
      after: { progress_pct: progress, status: nextState, row_version: updated.rows[0].row_version },
      justification: req.body?.justification || null,
      project_progress: projectProgress,
    });
    return { task: updated.rows[0], project_progress: projectProgress };
  });
  setETag(res, result.task);
  res.json(result);
}));

export default router;
