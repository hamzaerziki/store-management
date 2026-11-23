import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can, readScope } from '../middleware/auth.js';

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
      JOIN categories c ON true
      LEFT JOIN LATERAL (
        SELECT department
        FROM budget_category_lines b
        WHERE b.category_id = c.id AND b.department IN ('IT','MG')
        GROUP BY department
        ORDER BY COUNT(*) DESC, department
        LIMIT 1
      ) bcl ON true
      WHERE s.id=$1
      ON CONFLICT (store_id, category_id, department) DO NOTHING`,
    [storeId]
  );

  await query(`INSERT INTO budget_branches (store_id, code, label, color, position)
    SELECT $1, v.code, v.label, v.color, v.position FROM (VALUES ('IT','IT','#0E7A5F',1),('MG','MG','#B8862F',2)) v(code,label,color,position)
    ON CONFLICT (store_id, code) DO NOTHING`, [storeId]).catch(()=>{});
  const [branchResult, deptResult, categoryResult, supplierResult, lineResult] = await Promise.all([
    query(`SELECT id, code, label, color, allocated_budget, position FROM budget_branches WHERE store_id=$1 ORDER BY position, id`, [storeId]).catch(async()=>({rows:[{id:0,code:'IT',label:'IT',color:'#0E7A5F',allocated_budget:0,position:1},{id:0,code:'MG',label:'MG',color:'#B8862F',allocated_budget:0,position:2}]})),
    query(
      `WITH planned AS (
         SELECT bc.department, ROUND(SUM(bc.planned_amount), 2) AS planned_amount
          FROM budget_categories bc
          JOIN categories c ON c.id=bc.category_id
          WHERE bc.store_id=$1
         GROUP BY bc.department
       ),
       consumed AS (
         SELECT CASE WHEN owner_role IN ('IT','MG') THEN owner_role ELSE bc2.department END AS department,
                ROUND(SUM(d.amount), 2) AS used_amount,
                COUNT(*)::int AS approved_demand_count
         FROM demands d
         LEFT JOIN LATERAL (
           SELECT bc.department FROM budget_categories bc
           JOIN items i ON i.category_id=bc.category_id AND i.store_id=bc.store_id
           WHERE bc.store_id=d.store_id AND i.id=d.item_id
           LIMIT 1
         ) bc2 ON true
         WHERE d.store_id=$1 AND d.status='approved'
         GROUP BY 1
       ),
       departments AS (
         SELECT code AS department FROM budget_branches WHERE store_id=$1
         UNION SELECT department FROM planned
         UNION SELECT department FROM consumed WHERE department IS NOT NULL
       )
       SELECT dp.department,
              COALESCE(pl.planned_amount, 0) AS planned_amount,
              COALESCE(cs.used_amount, 0) AS used_amount,
              COALESCE(cs.approved_demand_count, 0) AS approved_demand_count
       FROM departments dp
       LEFT JOIN planned pl ON pl.department=dp.department
       LEFT JOIN consumed cs ON cs.department=dp.department
       ORDER BY dp.department`,
      [storeId]
    ),
    query(
       `SELECT c.id, c.name, c.owner_role, c.items_included, bc.department, bc.planned_amount,
              COALESCE(SUM(CASE WHEN d.status='approved' THEN d.amount ELSE 0 END), 0) AS used_amount,
              COUNT(DISTINCT d.id)::int AS demand_count,
              COUNT(DISTINCT CASE WHEN d.status='approved' THEN d.id END)::int AS approved_demand_count
        FROM budget_categories bc
        JOIN categories c ON c.id=bc.category_id
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
  const branchByCode = new Map(branchResult.rows.map(b => [b.code, b]));
  const departments = deptResult.rows.map(row => {
    const planned = Number(row.planned_amount || 0);
    const branch = branchByCode.get(row.department) || {};
    const explicitAllocated = Number(branch.allocated_budget || 0);
    const fallbackAllocated = totalPlanned ? Math.round(storeBudget * planned / totalPlanned * 100) / 100 : 0;
    return {
      department: row.department,
      id: row.department,
      label: branch.label || row.department,
      color: branch.color || (row.department==='IT'?'#0E7A5F':row.department==='MG'?'#B8862F':'#3B82F6'),
      planned_amount: planned,
      used_amount: Number(row.used_amount || 0),
      approved_demand_count: Number(row.approved_demand_count || 0),
      consumed_amount: Number(row.used_amount || 0),
      allocated_budget: explicitAllocated > 0 ? explicitAllocated : fallbackAllocated,
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

router.post('/branches', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { store_id, name, code, color, allocated_budget } = req.body || {};
  const storeId = Number(store_id);
  if (!storeId) return res.status(400).json({ error: 'Magasin requis' });
  const label = String(name || code || '').trim();
  const cleanCode = String(code || label).toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);
  if (!label || !cleanCode) return res.status(400).json({ error: 'Nom de branche requis' });
  const r = await query(
    `INSERT INTO budget_branches (store_id, code, label, color, allocated_budget, position)
     VALUES ($1,$2,$3,$4,$5, COALESCE((SELECT MAX(position)+1 FROM budget_branches WHERE store_id=$1),1))
     ON CONFLICT (store_id, code) DO UPDATE SET label=EXCLUDED.label, color=EXCLUDED.color, allocated_budget=EXCLUDED.allocated_budget, updated_at=NOW()
     RETURNING *`,
    [storeId, cleanCode, label, String(color||'#0E7A5F').slice(0,20), Number(allocated_budget)||0]
  );
  res.status(201).json(r.rows[0]);
}));

router.post('/categories', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { name, owner_role, department, planned_amount, store_id } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanDepartment = String(department || '').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);
  if (!cleanName || !cleanDepartment) {
    return res.status(400).json({ error: 'Nom et branche sont requis' });
  }
  const scope = ['IT', 'MG', 'BOTH'].includes(owner_role) ? owner_role : (['IT','MG'].includes(cleanDepartment) ? cleanDepartment : 'BOTH');
  const category = await query(
    `INSERT INTO categories (name, owner_role) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET owner_role=EXCLUDED.owner_role RETURNING id, name, owner_role`,
    [cleanName, scope]
  );
  const amount = Number(planned_amount) || 0;
  const storeId = Number(store_id);
  const budgets = await query(
    storeId
      ? `INSERT INTO budget_categories (store_id, category_id, department, planned_amount)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (store_id, category_id, department) DO UPDATE SET planned_amount=EXCLUDED.planned_amount
         RETURNING *`
      : `INSERT INTO budget_categories (store_id, category_id, department, planned_amount)
         SELECT s.id, $1, $2, $3 FROM stores s
         ON CONFLICT (store_id, category_id, department) DO UPDATE SET planned_amount=EXCLUDED.planned_amount
         WHERE budget_categories.planned_amount=0 AND EXCLUDED.planned_amount>0
         RETURNING *`,
    storeId ? [storeId, category.rows[0].id, cleanDepartment, amount] : [category.rows[0].id, cleanDepartment, amount]
  );
  res.status(201).json({ ...category.rows[0], budgets: budgets.rows });
}));

export default router;
