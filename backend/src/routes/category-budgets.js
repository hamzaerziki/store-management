import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can, readScope } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, can('view_budget'), asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'id', 1);
  const stores = await query(`SELECT id, name, budget FROM stores WHERE 1=1 ${scope.clause} ORDER BY name`, scope.params);
  const requested = Number(req.query.store_id);
  const storeId = stores.rows.some(s => s.id === requested) ? requested : stores.rows[0]?.id;
  if (!storeId) return res.json({ stores: [], store: null, departments: [], categories: [], lines: [] });

  const storeResult = await query(`SELECT id, name, budget FROM stores WHERE id=$1 ${scope.clause}`, [storeId, ...scope.params]);
  const store = storeResult.rows[0];
  if (!store) return res.status(404).json({ error: 'Magasin introuvable' });

  // Ensure every store has budget slots for current workbook/global categories (IT/MG split)
  await query(
    `INSERT INTO budget_categories (store_id, category_id, department, planned_amount)
     SELECT s.id, c.id,
            CASE
              WHEN c.owner_role = 'IT' THEN 'IT'
              WHEN c.owner_role = 'MG' THEN 'MG'
              WHEN bcl.department IN ('IT','MG') THEN bcl.department
              ELSE 'MG'
            END,
            0
     FROM stores s
     JOIN categories c ON c.name ~ '^[0-9]{2} — '
     LEFT JOIN LATERAL (
       SELECT department
       FROM budget_category_lines b
       WHERE b.category_id = c.id AND b.department IN ('IT','MG')
       GROUP BY department
       ORDER BY COUNT(*) DESC, department
       LIMIT 1
     ) bcl ON true
     ON CONFLICT (store_id, category_id, department) DO NOTHING`
  );

  const [deptResult, categoryResult, supplierResult, lineResult] = await Promise.all([
    query(
      `WITH planned AS (
         SELECT bc.department, ROUND(SUM(bc.planned_amount), 2) AS planned_amount
         FROM budget_categories bc
         JOIN categories c ON c.id=bc.category_id AND c.name ~ '^[0-9]{2} — '
         WHERE bc.store_id=$1
         GROUP BY bc.department
       ),
       consumed AS (
         SELECT CASE WHEN owner_role='IT' THEN 'IT' ELSE 'MG' END AS department,
                ROUND(SUM(amount), 2) AS used_amount,
                COUNT(*)::int AS approved_demand_count
         FROM demands
         WHERE store_id=$1 AND status='approved'
         GROUP BY CASE WHEN owner_role='IT' THEN 'IT' ELSE 'MG' END
       ),
       departments AS (
         SELECT department FROM planned
         UNION
         SELECT department FROM consumed
       )
       SELECT dp.department,
              COALESCE(pl.planned_amount, 0) AS planned_amount,
              COALESCE(cs.used_amount, 0) AS used_amount,
              COALESCE(cs.approved_demand_count, 0) AS approved_demand_count
       FROM departments dp
       LEFT JOIN planned pl ON pl.department=dp.department
       LEFT JOIN consumed cs ON cs.department=dp.department
       ORDER BY dp.department DESC`,
      [storeId]
    ),
    query(
       `SELECT c.id, c.name, c.owner_role, c.items_included, bc.department, bc.planned_amount,
              COALESCE(SUM(CASE WHEN d.status='approved' THEN d.amount ELSE 0 END), 0) AS used_amount,
              COUNT(DISTINCT d.id)::int AS demand_count,
              COUNT(DISTINCT CASE WHEN d.status='approved' THEN d.id END)::int AS approved_demand_count
       FROM budget_categories bc
       JOIN categories c ON c.id=bc.category_id AND c.name ~ '^[0-9]{2} — '
        LEFT JOIN items i ON i.category_id=c.id AND i.store_id=bc.store_id
        LEFT JOIN demands d ON d.item_id=i.id AND d.store_id=bc.store_id
        WHERE bc.store_id=$1
       GROUP BY c.id, c.name, c.owner_role, bc.department, bc.planned_amount
       ORDER BY bc.department DESC, bc.planned_amount DESC, c.name`,
      [storeId]
    ),
    query(
      `WITH demand_quotes AS (
         SELECT DISTINCT ON (d.id) d.id AS demand_id, i.category_id, q.supplier_id, q.amount_ht
         FROM demands d
         JOIN items i ON i.id=d.item_id AND i.store_id=d.store_id
         JOIN quotes q ON q.demand_id=d.id AND q.supplier_id IS NOT NULL
         WHERE d.store_id=$1
         ORDER BY d.id, q.id DESC
       )
       SELECT dq.category_id, s.id, s.name,
              COUNT(*)::int AS demand_count,
              ROUND(COALESCE(SUM(dq.amount_ht), 0), 2) AS planned_amount
       FROM demand_quotes dq
       JOIN suppliers s ON s.id=dq.supplier_id
       GROUP BY dq.category_id, s.id, s.name ORDER BY s.name`,
      [storeId]
    ),
    query(
      `SELECT bcl.id, bcl.article, bcl.amount_ht, bcl.source_row, bcl.supplier_id,
              bcl.category_id, c.name AS category_name, bcl.department,
              s.name AS supplier_name
       FROM budget_category_lines bcl
       JOIN categories c ON c.id=bcl.category_id
       LEFT JOIN suppliers s ON s.id=bcl.supplier_id
       WHERE bcl.store_id=$1 ORDER BY bcl.source_row NULLS LAST, bcl.id`,
      [storeId]
    ),
  ]);

  const totalPlanned = deptResult.rows.reduce((sum, row) => sum + Number(row.planned_amount || 0), 0);
  const storeBudget = Number(store.budget || 0);
  const departments = deptResult.rows.map(row => {
    const planned = Number(row.planned_amount || 0);
    return {
      department: row.department,
      planned_amount: planned,
      used_amount: Number(row.used_amount || 0),
      approved_demand_count: Number(row.approved_demand_count || 0),
      allocated_budget: totalPlanned ? Math.round(storeBudget * planned / totalPlanned * 100) / 100 : 0,
    };
  });
  const suppliersByCategory = supplierResult.rows.reduce((acc, row) => {
    (acc[row.category_id] ||= []).push(row);
    return acc;
  }, {});

  res.json({
    stores: stores.rows,
    store,
    total_budget: storeBudget,
    total_planned: Math.round(totalPlanned * 100) / 100,
    departments,
    categories: categoryResult.rows.map(row => ({
      ...row,
      planned_amount: Number(row.planned_amount || 0),
      used_amount: Number(row.used_amount || 0),
      available_amount: Math.round((Number(row.planned_amount || 0) - Number(row.used_amount || 0)) * 100) / 100,
      suppliers: suppliersByCategory[row.id] || [],
    })),
    lines: lineResult.rows,
  });
}));

router.post('/categories', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { name, owner_role, department, planned_amount } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanDepartment = department === 'IT' || department === 'MG' ? department : null;
  if (!cleanName || !cleanDepartment) {
    return res.status(400).json({ error: 'Nom et département sont requis' });
  }
  const scope = ['IT', 'MG', 'BOTH'].includes(owner_role) ? owner_role : cleanDepartment;
  const category = await query(
    `INSERT INTO categories (name, owner_role) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET owner_role=EXCLUDED.owner_role RETURNING id, name, owner_role`,
    [cleanName, scope]
  );
  const amount = Number(planned_amount) || 0;
  const budgets = await query(
    `INSERT INTO budget_categories (store_id, category_id, department, planned_amount)
     SELECT s.id, $2, $3, $4 FROM stores s
     ON CONFLICT (store_id, category_id, department) DO UPDATE
     SET planned_amount=EXCLUDED.planned_amount
     WHERE budget_categories.planned_amount=0 AND EXCLUDED.planned_amount>0
     RETURNING *`,
    [category.rows[0].id, cleanDepartment, amount]
  );
  res.status(201).json({ ...category.rows[0], budgets: budgets.rows });
}));

export default router;
