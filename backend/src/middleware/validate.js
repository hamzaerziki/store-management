import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const resourceParam = z.object({ resource: z.enum(['purchase_orders','invoices','payments','incidents','claims','risks']) });

export function validate(schema, pick = 'body') {
  return (req, res, next) => {
    const src = pick === 'query' ? req.query : pick === 'params' ? req.params : req.body;
    const parsed = schema.safeParse(src ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Données invalides',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (pick === 'query') req.query = { ...req.query, ...parsed.data };
    else if (pick === 'params') req.params = { ...req.params, ...parsed.data };
    else req.body = parsed.data;
    next();
  };
}

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().max(200).optional(),
}).passthrough();
