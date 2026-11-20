INSERT INTO quotes (item_id, supplier_id, demand_id, lot_id, amount_ht, amount_tva, amount_ttc,
                    currency, quote_ref, notes, uploaded_by, state, created_by)
SELECT
  d.item_id,
  bcl.supplier_id,
  d.id,
  d.lot_id,
  bcl.amount_ht,
  ROUND(bcl.amount_ht * 0.20, 2),
  ROUND(bcl.amount_ht * 1.20, 2),
  'MAD',
  LEFT('WB-LACOSTE-' || COALESCE(bcl.source_row::text, bcl.id::text), 100),
  'Ligne importée du workbook — catégorie : ' || c.name || ' — prestataire : ' || COALESCE(s.name, 'non renseigné'),
  d.created_by,
  'brouillon',
  d.created_by
FROM demands d
JOIN items i ON i.id=d.item_id
JOIN budget_category_lines bcl
  ON bcl.category_id=i.category_id
 AND LEFT(bcl.article, 200)=i.name
 AND bcl.amount_ht=i.estimated_budget
JOIN categories c ON c.id=bcl.category_id
LEFT JOIN suppliers s ON s.id=bcl.supplier_id
WHERE d.status='draft'
  AND d.description='Importé du workbook BUDGET LACOSTE CAPITAL MALL V1 (1).xlsx'
  AND bcl.supplier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.demand_id=d.id);
