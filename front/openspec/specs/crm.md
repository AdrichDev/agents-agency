# CRM Contacts, Clients & Polish Specification

## Purpose

CRM layer for commercial contacts (leads/prospects) and clients, plus the
pricing-catalog coherence and favicon-persistence polish shipped in P11
(`crm-contacts-and-polish`). Documents the **as-built** contract (which diverges
in places from the original proposal — see notes).

---

## Domain: Prospect Contacts

### Purpose

A call-agenda of commercial contacts (leads captured automatically + prospects
added manually), with a contacted-state lifecycle and conversion to `Client`.

---

### Requirement: R1 — `ProspectContact` model

The `ProspectContact` model in `schema.prisma` MUST have: `id` (cuid),
`codigo` (String unique, sequential `pc-NN`, 2-digit zero-pad, grows past 99),
`type` (enum `ContactType` = `lead | prospecto`, default `prospecto`),
`name` (String), `phone`/`email`/`sector`/`direccion`/`peticion` (String?),
`contactado` (enum `ContactedStatus` = `si | no | nc`, default `no`),
`contactedAt` (DateTime?), `clientId` (String? FK → `Client`, `onDelete: SetNull`),
`createdAt` (DateTime default now), `deletedAt` (DateTime?, soft delete).
Indexes: `[type, contactado]`, `[createdAt]`, `[deletedAt]`.

> **As-built divergence from proposal**: enums are named `ContactType` /
> `ContactedStatus` (not `ProspectType` / `ContactadoStatus`); `contactado`
> defaults to `no` (not `nc`); the model adds `peticion`, soft-delete via
> `deletedAt`, and a `codigo` business code.

#### Scenario: Sequential code generation

- GIVEN existing contacts with codes `pc-01`, `pc-02`
- WHEN a new contact is created
- THEN it receives `codigo = "pc-03"` (computed from the max existing number),
  with `withCodeRetry` recovering from a unique-collision race (Prisma `P2002`).

---

### Requirement: R2 — Contacts CRUD API

The `/api/contacts` router MUST expose:
- `GET /api/contacts` — list, filterable by `type` and `contactado`, ordered by
  `createdAt desc`, excluding soft-deleted rows (`deletedAt = null`), each row
  including the linked `client` (`id, name, codCliente`).
- `POST /api/contacts` — Zod-validated create; `type ∈ {lead, prospecto}`,
  `contactado ∈ {si, no, nc}`, `name` required; defaults `contactado = "no"`;
  seals `contactedAt` when created already `si`; returns 201.
- `PATCH /api/contacts/:id` — partial update; `contactedAt` is sealed when
  `contactado` transitions to `si` (only if not already sealed) and cleared when
  it transitions to `no`/`nc`; returns 404 if missing or soft-deleted.
- `DELETE /api/contacts/:id` — **soft delete** (seals `deletedAt`; row preserved);
  idempotent via `updateMany` with `deletedAt: null` filter; 404 when count 0.
- `GET /api/contacts/pending-count` — `{ count }` of rows with
  `contactado != "si"` AND `deletedAt = null`.
- `POST /api/contacts/convert-to-clients` — `{ ids: string[] }`; per contact
  creates a `Client` (copying name/email/phone/sector/direccion, sequential
  `cli-NN`), links the contact (`clientId`) and soft-deletes it; best-effort,
  accumulating `created[]` / `failed[]` without aborting the batch.

> **As-built divergence**: `DELETE` is a soft delete returning `{ ok: true }`
> (not a hard delete / 204). `convert-to-clients` is an added capability not in
> the original task list.

---

### Requirement: R3 — Automatic lead capture + admin notification

GIVEN a new `Lead` is persisted from the chat engine or the public landing,
WHEN the lead is created (chat: only on first creation, detected via prior
`findUnique`),
THEN `processNewLead()` runs best-effort (never throws into the caller):
1. creates a `ProspectContact(type = "lead")` (`createLeadContact`), and
2. fires the n8n webhook (`N8N_WEBHOOK_LEAD_URL`) which sends the admin email.

The webhook payload includes the resolved admin recipient: `resolveAdminEmail()`
returns `SystemConfig.adminEmail`, falling back to the first `User` with role
`admin`, else `null`. Each step catches its own error (`console.error`) so a
notification failure never blocks the HTTP response nor reverts the lead.

> **As-built divergence from proposal**: admin notification is delivered via an
> **n8n webhook** (`notifyLeadViaWebhook`), not direct Gmail OAuth.

---

## Domain: Clients (enrichment)

### Requirement: R4 — Enriched clients API

`GET /api/clients` and `GET /api/clients/:id` MUST include `codCliente`
(String unique, `cli-NN`), `direccion` (String?), and `hasInvoices` (boolean,
`true` when the client has ≥ 1 `Budget`). The list computes `hasInvoices` from
`_count.budgets > 0`; the detail from `budgets.length > 0`. New clients receive a
sequential `codCliente` (`nextClientCode`, race-safe via `withCodeRetry`).

The additive migration `back/prisma/migrate-crm-contacts.sql` is idempotent
(only `ADD`/`CREATE`, no `DROP`; re-runnable): creates the enums, adds
`Client.codCliente` + `Client.direccion`, backfills `codCliente` sequentially by
`createdAt` for existing null rows, and creates the `ProspectContact` table with
its indexes and FK. (DB was already migrated via `db push`; the SQL remains as a
reproducible artifact.)

---

## Domain: Front CRM UI

### Requirement: R5 — Clients table

The `/clientes` table MUST show a `codCliente` column, a `Dirección` column, and
an `Facturas` column rendered as a document icon (colored by `hasInvoices`) that
links to `/facturacion?clientId={id}`. The facturación page reads `clientId` via
`useSearchParams` (inside a Suspense boundary) and filters by that client.

### Requirement: R6 — Contacts page

The `/contactos` page MUST show a sortable table of `ProspectContact` with
filters by Tipo and Contactado, a `Contactado` badge (green `Sí` / red `No` /
orange `NC`), an inline action to cycle `contactado` (optimistic PATCH), a Tipo
column (Lead/Prospecto), a Fecha de alta column formatted `es-ES`
(`dd/mm/aaaa hh:mm`), and a yellow `"N"` badge on same-calendar-day entries that
are still `contactado != "si"`. Selected contacts can be converted to clients via
the convert-to-clients endpoint.

### Requirement: R7 — Pending badge in nav

The Sidebar MUST fetch `GET /api/contacts/pending-count` (refreshed on navigation
via `useEffect`) and show a badge with the count on the `/contactos` nav item,
hidden when the count is 0.

### Requirement: R8 — Favicon persistence

`ThemeInitializer` MUST apply favicon precedence **localStorage > DB
(`SystemConfig`) > default**. It writes `localStorage.favicon` only when the DB
returns a non-null value; when the DB has none, the prior local value is kept
(fixing the prior bug where each session reset the configured favicon). The
default favicon is `/3A_sin_fondo.png`.

---

## Domain: Service Catalog (pricing coherence)

### Requirement: R9 — Catalog synchronization

The service catalog MUST be numerically identical across
`back/src/lib/service-catalog.ts`, `front/app/facturacion/page.tsx`
(`SERVICE_CATALOG`) and `front/app/tarifas/page.tsx` for every `serviceId`
(Spain-2026 pricing). A budget line computes its price directly from the catalog
value with no extra margin or rounding.

---

## Known Technical Debt

1. **Supertest coverage** — Contacts handlers are unit-tested with a mocked
   Prisma (`tests/contacts.test.ts`, 25); end-to-end router exercise via
   supertest is deferred.
2. **Proposal vs as-built drift** — The original spec referenced Gmail OAuth
   notification, `nc` default, and hard delete; the shipped code uses n8n
   webhook, `no` default, and soft delete. This spec documents the as-built
   contract.
