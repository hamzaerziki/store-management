import { Router } from 'express';
import {
  standardContext, v1Auth, errorEnvelope, errorHandlerV1,
} from '../../middleware/standard.js';
import financeRouter from './finance.js';
import projectsRouter from './projects.js';
import planningRouter from './planning.js';
import governanceRouter from './governance.js';
import settingsRouter from './settings.js';

const router = Router();

router.param('id', (req, res, next, value) => {
  if (value !== undefined && !/^[1-9][0-9]*$/.test(String(value))) return res.status(400).json({ error: 'Identifiant invalide' });
  req.params.id = String(Number(value));
  next();
});
router.param('resource', (req, res, next, value) => {
  const allowed = new Set(['purchase_orders','invoices','payments','incidents','claims','risks']);
  if (!allowed.has(String(value || ''))) return res.status(400).json({ error: 'Ressource invalide' });
  next();
});

router.use(standardContext);
router.use(v1Auth);

router.use(financeRouter);
router.use(projectsRouter);
router.use(planningRouter);
router.use(governanceRouter);
router.use(settingsRouter);

router.use((req, res) => errorEnvelope(res, 404, 'NOT_FOUND', 'Route API v1 introuvable', req.correlationId));
router.use(errorHandlerV1);

export default router;
