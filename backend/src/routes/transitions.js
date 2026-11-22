import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, readScope, assignedStoreIds, GLOBAL_READ_ROLES } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.entity) { params.push(req.query.entity); where += ` AND st.entity = $${params.length}`; }
  if (req.query.entity_id) { params.push(req.query.entity_id); where += ` AND st.entity_id = $${params.length}`; }
  const r = await query(
    `SELECT st.*, u.name AS actor_name,
       CASE st.entity
         WHEN 'demand' THEN (SELECT store_id FROM demands WHERE id=st.entity_id)
         WHEN 'comparison' THEN (SELECT i.store_id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE c.id=st.entity_id)
         WHEN 'budget' THEN (SELECT store_id FROM budgets WHERE id=st.entity_id)
         WHEN 'project' THEN st.entity_id
         WHEN 'purchase_orders' THEN (SELECT store_id FROM purchase_orders WHERE id=st.entity_id)
         WHEN 'invoices' THEN (SELECT store_id FROM invoices WHERE id=st.entity_id)
         WHEN 'risks' THEN (SELECT store_id FROM risks WHERE id=st.entity_id)
         WHEN 'receptions' THEN (SELECT store_id FROM receptions WHERE id=st.entity_id)
         WHEN 'planning_tasks' THEN (SELECT store_id FROM planning_tasks WHERE id=st.entity_id)
       END AS store_id,
       CASE st.entity
         WHEN 'demand' THEN (SELECT title FROM demands WHERE id=st.entity_id)
         WHEN 'comparison' THEN (SELECT i.name FROM comparisons c JOIN items i ON i.id=c.item_id WHERE c.id=st.entity_id)
         WHEN 'budget' THEN (SELECT label FROM budgets WHERE id=st.entity_id)
         WHEN 'project' THEN (SELECT name FROM stores WHERE id=st.entity_id)
       END AS label
     FROM state_transitions st LEFT JOIN users u ON u.id=st.actor_id
     WHERE ${where} ORDER BY st.created_at DESC, st.id DESC LIMIT 500`,
    params
  );
  let rows = r.rows;
  if (req.query.store_id) rows = rows.filter(row => String(row.store_id) === String(req.query.store_id));
  if (!GLOBAL_READ_ROLES.includes(req.user.role)) {
    const ids = new Set((await assignedStoreIds(req.user.id)).map(Number));
    rows = rows.filter(row => row.store_id && ids.has(Number(row.store_id)));
  }
  res.json(rows);
}));

export default router;
