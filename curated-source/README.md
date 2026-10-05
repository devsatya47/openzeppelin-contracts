# curated-source.com

A full-stack, multi-vendor luxury marketplace for original art, collectible design and objects. It offers escrow-protected acquisitions, vendor onboarding, and a full admin control panel.

- **Frontend:** React 19 + TypeScript + Tailwind CSS v4, built by Vite into `./dist`
- **Backend:** Node.js / Express 5 REST API with role-based access control
- **Database:** SQLite through Drizzle ORM (versioned SQL migrations in `server/db/migrations`)
- **Media:** uploads are processed with `sharp`. Each upload gets a web-optimised master image (≤2400px) and an automatically generated thumbnail (≤720px).

## Quick start

```bash
npm install
cp .env.example .env      # edit JWT_SECRET etc.
npm run seed              # builds the database and renders demo artwork (~30s)
npm run dev               # API on :4000, web on :5173 (proxied)
```

Open http://localhost:5173. The login page has one-click buttons for each demo role.

### Demo accounts (created by `npm run seed`)

| Role        | Email                               | Password         |
|-------------|-------------------------------------|------------------|
| Super-Admin | `admin@curated-source.com`          | `Admin#2026`     |
| Sub-Admin   | `moderator@curated-source.com`      | `Moderator#2026` |
| Seller      | `lumiere@curated-source.com`        | `Seller#2026` (Atelier Lumière) |
| Seller      | `noir@curated-source.com`           | `Seller#2026` (Noir Gallery) |
| Seller      | `formvoid@curated-source.com`       | `Seller#2026` (Form & Void Studio) |
| Seller      | `pending.seller@curated-source.com` | `Seller#2026` (Maison Verre, awaiting approval) |
| Buyer       | `buyer@curated-source.com`          | `Buyer#2026`     |
| Buyer       | `collector@curated-source.com`      | `Buyer#2026`     |

The seed contains:
- 5 root categories and 11 subcategories, plus 1 pending user-suggested subcategory
- 3 approved galleries and 1 pending gallery
- 18 listings. Their high-resolution images are generated procedurally in varied aspect ratios, so the demo needs no external image hosting.
- Orders at every escrow stage, including an open dispute, plus reviews, Q&A threads and payouts

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | API (tsx watch) and Vite dev server together |
| `npm run build` | `vite build` → `./dist`, plus the API bundle → `./build/server.js` |
| `npm start` | Runs the production server (serves the API, `/uploads` and the SPA from `dist/`) |
| `npm run seed` | **Wipes** and reseeds the database and uploads. Refuses to run in production without `--force`. |
| `npm run db:generate` | Generates a new SQL migration after editing `server/db/schema.ts` |
| `npm run db:migrate` | Applies migrations. The server also applies them on boot. |
| `npm test` | API integration tests (`node:test`): full escrow lifecycle and RBAC |
| `npm run typecheck` | TypeScript checks for the client and the server |

## Features

**Catalog & discovery**
- Cinematic hero with an "Enter Gallery" CTA
- Mega-menu and a cascading sidebar for categories (root → subcategory)
- Faceted filters: price range and presets, medium, dimensions (small/medium/large by longest edge), gallery
- Global search with debounced, keyboard-navigable autocomplete across works, artists, galleries and categories
- Featured gallery showcases
- `ArtFrame` presents every aspect ratio and media type (image or video) inside a consistent gallery matte, without cropping

**Listing detail**
- Full-bleed media viewer with thumbnails and a fullscreen lightbox
- Gold price tag, provenance, edition and certificate of authenticity
- Public Q&A with the vendor
- Escrow guarantee badge and the "Acquire Piece" CTA
- Live shipping calculator: domestic or international flat rate, chosen by destination vs. origin country

**Vendor onboarding & listing**
- `/sell` creates the account and the gallery in a single form, then goes straight to the first listing
- Drag-and-drop uploader (images and video), with reorder, choose cover and remove; thumbnails are generated server-side
- Cascading category selection with a **"Suggest a new subcategory"** fallback. The suggestion is created as `pending` for admin review. Until it is approved, the work is still discoverable under the parent category. If the suggestion is rejected, its works move to the parent.
- Flat-rate domestic and international shipping fields

**Escrow, orders & dashboards**
- Escrow state machine (`server/lib/escrow.ts`): `pending → in_escrow → dispatched → delivered → released`, with off-ramps:
  - `cancelled`: unpaid reservations expire automatically after 30 minutes
  - `refunded`: the seller declines, or an admin refunds
  - `disputed`: an admin resolves it by releasing or refunding
- Every transition is validated for actor and source state, runs in a single transaction, and writes an order event. Money movements (hold, release, commission, refund) are written to the `escrow_transactions` ledger.
- Vendor portal: analytics (gross, net, 12-month chart, conversion), inventory management, orders needing dispatch, Q&A inbox, balance and payout withdrawal requests, gallery profile
- Admin control panel:
  - Vendor approvals and featuring
  - Taxonomy moderation of user-suggested categories
  - Dispute resolution
  - All orders
  - Payout processing (super-admin only)
  - User role and suspension management (super-admin only)
  - Paginated audit log and escrow ledger

## RBAC

Permissions are declared in one matrix (`server/lib/rbac.ts`) and enforced by `requirePermission()` on every route. The client hides UI the same way, but the server is the source of truth.

| | Buyer | Seller | Sub-Admin | Super-Admin |
|---|:-:|:-:|:-:|:-:|
| Buy, ask questions, review | ✓ | ✓ | ✓ | ✓ |
| Open a gallery | ✓ | | | |
| Manage listings, request payouts | | ✓ | | |
| Approve vendors, moderate taxonomy and listings, resolve disputes, read audit | | | ✓ | ✓ |
| Process payouts, manage users and roles | | | | ✓ |

Order actions are also checked against the actor's relationship to the order: buyer, owning seller, or admin.

## Data model

`users`, `galleries` (vendors), `categories` (self-referencing tree with an approval status), `listings`, `listing_media`, `questions`, `orders`, `order_events`, `escrow_transactions`, `disputes`, `reviews`, `payouts`, `audit_logs`. See `server/db/schema.ts`.

## Deployment

### Option A: single Node server (VPS, Hostinger VPS, Render, Fly…)

```bash
npm ci && npm run build
NODE_ENV=production JWT_SECRET=<64+ random chars> npm start
```

The server serves the SPA, `/api` and `/uploads` on one port. Put it behind a reverse proxy with TLS. Persist `data/` and `uploads/`.

### Option B: static frontend on shared hosting (Hostinger `public_html`), API elsewhere

1. Deploy the API (option A) on a Node-capable host, e.g. `https://api.curated-source.com`. Set `CORS_ORIGINS=https://curated-source.com`.
2. Build the frontend against it:
   ```bash
   VITE_API_URL=https://api.curated-source.com npm run build:web
   ```
3. Upload the **contents** of `dist/` into `public_html/`. The bundled `.htaccess` rewrites deep links such as `/listing/...` to `index.html` for client-side routing, and sets long-lived caching for hashed assets.

To serve from a sub-folder, build with `VITE_BASE=/subfolder/` and adjust `RewriteBase` in `client/public/.htaccess`.

### Production checklist

- **Payments:** `POST /api/orders/:id/actions/pay` is where a payment provider capture belongs. In demo mode, the checkout shows a test card and no money moves. Wire Stripe or similar there, preferably confirmed by webhook, before going live.
- Set a strong `JWT_SECRET`. The server refuses to boot in production without one.
- Back up `data/curated-source.db*` and `uploads/`. Uploads can move to object storage by swapping `server/lib/images.ts`.
- SQLite in WAL mode is fine for a single instance. To scale horizontally, move to PostgreSQL by switching the Drizzle dialect.
