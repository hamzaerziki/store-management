# Safari Store Opening Tracker

> Web application to manage, validate and monitor the opening of the new **Safari Import Export** stores.

---

## 1. Context

**Safari Import Export** is preparing to open about **7 new stores** in a short period of time.

Each store needs to be fully fitted out before opening: **furniture, equipment, IT hardware, and all other management-related items** (*mobilier, équipement, matériel informatique, moyens généraux, etc.*).

Today, this process involves many people, many suppliers and many quotes (*devis*). Without a central tool, it is hard to:

- Compare supplier quotes in a clean and traceable way.
- Know which purchases have been validated, and by whom.
- Know, at any moment, how far along each store is.
- Give top management a reliable view without chasing people for updates.

A **validation committee** is in charge of this project. It is made up of:

| Role | Full name | Short description |
|------|-----------|-------------------|
| **IT** | Information Technology | Handles all technical and IT needs (computers, POS, network, printers, etc.). |
| **MG** | Moyens Généraux (General Services) | Handles furniture, equipment, fittings, supplies and logistics of the store. |
| **CG** | Contrôle de Gestion (Management Control) | Controls budgets, costs and the financial relevance of each purchase. |
| **DG** | Direction Générale (General Management) | Has the global vision and takes final decisions. |

---

## 2. Objectives

### Main objective
Build **one single web app** that centralizes the whole store-opening process, from the first quote to the final "store ready" status, with a clear, real-time view of progress for every store.

### Specific objectives

1. **Centralize** all quotes (*devis*) per store, per category and per supplier.
2. **Compare** quotes automatically (*comparatif*) so the best offer can be chosen quickly and transparently.
3. **Track** every item through a clear workflow: quoted → compared → validated → ordered → delivered → installed.
4. **Show progress** in real time, per store and globally, through dashboards.
5. **Control access** with RBAC (Role-Based Access Control) so each person only sees and does what their role allows.
6. **Keep an audit trail**: who uploaded, checked, validated or rejected what, and when.
7. **Reduce time and errors** compared to emails, Excel files and WhatsApp messages.

---

## 3. How it works (the big idea)

```
   IT / MG                         CG                         DG
 ───────────                   ──────────                ─────────────
 Upload devis        →      Reviews comparatifs   →     Sees progress of
 Build comparatifs          Checks budgets              each store & global
 Check items done           Validates / flags           Final validation
        │                         │                           │
        └──────────── Progress updates automatically ─────────┘
```

- **IT and MG** work on the ground: they **upload quotes**, create **comparisons**, and **tick/check items** as they advance (quote received, validated, ordered, delivered, installed).
- Every check **automatically updates the progress** of the store, so the others can see that **the store is on track**.
- **CG and DG** mainly **follow the progress** through dashboards, review comparisons and give their approvals. They do not need to ask for updates because everything is visible live.

---

## 4. Users and roles (RBAC)

### 4.1 Roles

| Role | Main mission in the app |
|------|-------------------------|
| **Admin** (technical) | Manages users, roles, stores, categories and settings. |
| **IT** | Uploads quotes and builds comparisons for IT items. Checks IT items as they progress. |
| **MG** | Uploads quotes and builds comparisons for furniture/equipment/general items. Checks items as they progress. |
| **CG** | Reviews comparisons and budgets. Validates or rejects from a financial point of view. Sees all progress. |
| **DG** | Sees global and per-store progress. Gives final approval on key decisions. Read-focused. |

### 4.2 Permissions matrix

Legend: ✅ allowed · 👁️ read only · ❌ not allowed · ⚙️ limited to own scope (IT items for IT, general items for MG)

| Action | Admin | IT | MG | CG | DG |
|--------|:-----:|:--:|:--:|:--:|:--:|
| Manage users and roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create / edit stores | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage categories and item catalog | ✅ | ⚙️ | ⚙️ | ❌ | ❌ |
| Upload quotes (*devis*) | ❌ | ⚙️ | ⚙️ | ❌ | ❌ |
| Create / edit comparisons (*comparatif*) | ❌ | ⚙️ | ⚙️ | ❌ | ❌ |
| Check items / update item status | ❌ | ⚙️ | ⚙️ | ❌ | ❌ |
| View quotes and comparisons | ✅ | ✅ | ✅ | ✅ | 👁️ |
| Financial validation of a comparison | ❌ | ❌ | ❌ | ✅ | ✅ |
| Final validation / decision | ❌ | ❌ | ❌ | ❌ | ✅ |
| View progress dashboard (per store) | ✅ | ✅ | ✅ | ✅ | ✅ |
| View global dashboard (all stores) | ✅ | 👁️ | 👁️ | ✅ | ✅ |
| View budget vs. actual | ✅ | ❌ | ❌ | ✅ | ✅ |
| View audit log | ✅ | ❌ | ❌ | ✅ | ✅ |
| Export reports (PDF / Excel) | ✅ | ❌ | ❌ | ✅ | ✅ |

> This matrix is a starting point. It must be confirmed by the committee before development of the permissions layer.

---

## 5. Core features

### 5.1 Store management
- List of the ~7 stores with name, city, planned opening date and status.
- Each store has its own checklist of categories and items.

### 5.2 Categories and items
- Standard categories: **Furniture, Equipment, IT, Signage, Safety, Supplies, Other**.
- Item templates reused across stores (e.g. "Cash desk", "POS terminal", "Shelving unit").
- Quantity and estimated budget per item and per store.

### 5.3 Quotes (*devis*) upload
- Upload PDF / image / Excel files.
- Fields: supplier, date, validity, amount (excl. and incl. tax), currency, delivery time, payment terms, notes.
- Each quote is linked to a store, a category and one or more items.

### 5.4 Comparison (*comparatif*)
- Side-by-side comparison of 2 or more quotes for the same need.
- Criteria: price, delivery time, warranty, payment terms, supplier reliability, notes.
- Highlight of the cheapest and the best-scored offer.
- The user selects a **recommended supplier** with a written justification.
- Comparison goes through the validation flow (see section 6).

### 5.5 Item checklist and progress
- Each item moves through statuses (see section 6).
- IT and MG **check** items as steps are completed.
- Progress is **calculated automatically** from the statuses.

### 5.6 Dashboards
- **Per store:** progress %, items by status, budget vs. actual, delays, next actions.
- **Global (DG/CG):** all stores side by side, ranking, alerts on stores at risk, total budget consumption.
- Clear color signals: 🟢 on track · 🟠 at risk · 🔴 late.

### 5.7 Notifications
- In-app (and optional email) notifications: new quote uploaded, comparison waiting for validation, validation done, item blocked, deadline approaching.

### 5.8 Audit trail
- Every action is logged: who, what, when, before/after values.

### 5.9 Reports and export
- Export comparisons, budgets and progress reports to PDF and Excel.

---

## 6. Workflows

### 6.1 Item status lifecycle

```
To quote → Quotes received → Compared → Validated (CG) → Approved (DG) → Ordered → Delivered → Installed ✔
```

| Status | Who updates it |
|--------|----------------|
| To quote | System (default) |
| Quotes received | IT / MG |
| Compared | IT / MG |
| Validated (financial) | CG |
| Approved (final) | DG (for items above a defined amount threshold) |
| Ordered | IT / MG |
| Delivered | IT / MG |
| Installed | IT / MG |

> Rule to define with the committee: below a certain amount, CG validation alone is enough; above it, DG approval is also required.

### 6.2 Progress calculation

Each status has a weight. Example (adjustable in settings):

| Status | Weight |
|--------|-------:|
| To quote | 0% |
| Quotes received | 15% |
| Compared | 30% |
| Validated / Approved | 50% |
| Ordered | 70% |
| Delivered | 90% |
| Installed | 100% |

- **Item progress** = weight of its current status.
- **Store progress** = average of its items' progress, optionally weighted by budget.
- **Global progress** = average across the stores.

### 6.3 Typical scenario

1. MG creates the item "Shelving units" for Store 3 and uploads 3 supplier quotes.
2. MG builds the comparison and recommends one supplier. Progress of the item rises.
3. CG reviews the comparison against the budget and validates it.
4. DG approves (if above the threshold).
5. MG ticks "Ordered", then "Delivered", then "Installed".
6. DG opens the dashboard and sees that Store 3 is at 78% and on track.

---

## 7. Role of the AI

The AI (Claude) is the **builder of this application**. Its role is to:

1. **Design** the architecture, database schema and screens based on this README.
2. **Develop** the full web app: front end, back end, database, authentication and RBAC.
3. **Implement** the business rules described here (workflows, progress calculation, validation thresholds).
4. **Write clean, documented and maintainable code**, with tests on critical logic (permissions and progress).
5. **Propose improvements** and flag unclear points or risks instead of guessing silently.
6. **Document** the project: setup guide, user guide per role, and API documentation.
7. **Iterate** with the team: adjust features after each demo and feedback round.

### Rules for the AI
- Follow this README as the source of truth. If something is missing or ambiguous, **ask before assuming**.
- **Security first:** never hardcode secrets, always enforce permissions on the server side, validate every input.
- Keep the interface **simple**: users are business people, not technical staff.
- Build in **small, testable steps** (see roadmap) and show something usable at each step.
- Interface language: **French** by default, with English as an option (to be confirmed). Code and comments in English.

### Optional AI features inside the app (later phase)
- Automatic extraction of data from uploaded quotes (supplier, amounts, dates) to reduce manual typing.
- Smart summary of a comparison for CG and DG.
- Alerts on abnormal prices compared to previous quotes.

---

## 8. Suggested technical stack

> Suggestion only. It can be changed if the team prefers other tools.

| Layer | Suggestion |
|-------|------------|
| Front end | React (or Next.js) + Tailwind CSS |
| Back end | Node.js (NestJS / Express) or Python (FastAPI) |
| Database | PostgreSQL |
| File storage | S3-compatible storage (or local server storage) for quotes |
| Authentication | Email + password, with optional 2FA; JWT or session-based |
| Authorization | RBAC enforced on the back end |
| Charts | Recharts or Chart.js |
| Hosting | Cloud VPS or company server, with HTTPS and daily backups |

---

## 9. Data model (high level)

- **User** (id, name, email, role, active)
- **Store** (id, name, city, opening_date, status, budget)
- **Category** (id, name)
- **Item** (id, store_id, category_id, name, quantity, estimated_budget, status, owner_role)
- **Quote** (id, item_id, supplier_id, amount, currency, delivery_time, validity_date, file_url, uploaded_by, uploaded_at)
- **Supplier** (id, name, contact, notes)
- **Comparison** (id, item_id, selected_quote_id, justification, status, created_by)
- **Validation** (id, comparison_id, validator_role, decision, comment, decided_at)
- **AuditLog** (id, user_id, action, entity, entity_id, details, timestamp)
- **Notification** (id, user_id, message, read, created_at)

---

## 10. Non-functional requirements

- **Security:** HTTPS, hashed passwords, server-side RBAC, protected file access, regular backups.
- **Traceability:** full audit log, no silent deletion (archive instead).
- **Usability:** works on desktop and tablet, clear and simple screens, minimal training.
- **Performance:** dashboards load in under 3 seconds with the full project data.
- **Reliability:** daily backups and a documented restore procedure.
- **Scalability:** ready to handle more than 7 stores if the company continues to grow.

---

## 11. Roadmap

| Phase | Content | Result |
|-------|---------|--------|
| **1. Foundation** | Authentication, users, roles (RBAC), stores, categories, items | Secure base ready |
| **2. Quotes and comparison** | Quote upload, supplier management, comparison screen | IT and MG can work |
| **3. Workflow and progress** | Item statuses, checks, validation by CG and DG, progress calculation | Progress visible |
| **4. Dashboards** | Per-store and global dashboards, alerts, color signals | DG and CG can follow |
| **5. Reports and polish** | PDF/Excel exports, notifications, audit log screen, UI polish | Ready for rollout |
| **6. Go-live** | Tests with real users, training, deployment, support | App in production |
| **7. Smart features** | AI extraction of quotes, summaries, price alerts | Time savings |

---

## 12. Success criteria

- 100% of quotes and comparisons for the 7 stores are stored in the app.
- DG and CG can see the real progress of every store at any time without asking anyone.
- Every purchase decision has a visible comparison, a validator and a date.
- Reduced time to validate a purchase compared to the current process.
- Committee members use the app as their single source of truth.

---

## 13. Open questions (to confirm with the committee)

1. Amount threshold above which **DG approval** is required in addition to CG?
2. Are there other roles to add (e.g. store managers, purchasing, accounting)?
3. Should IT and MG see each other's items, or only their own?
4. What are the exact categories and item lists for a standard store?
5. Interface language: French only, or French and English?
6. Currency (MAD, EUR, other) and tax handling (HT / TTC)?
7. Hosting preference: company server or cloud?
8. Target opening dates for each store, to calculate delays and alerts?

---

## 14. Project team

| Role | Responsibility |
|------|----------------|
| DG | Sponsor and final decision maker |
| CG | Budget control and financial validation |
| MG | Furniture, equipment and general needs |
| IT | IT needs and technical support for the app |
| AI (Claude) | Design and development of the web app |

---

*Safari Import Export. Store Opening Project.*
