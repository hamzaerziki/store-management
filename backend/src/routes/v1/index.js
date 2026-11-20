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
