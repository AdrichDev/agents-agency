# Tasks

Order matters: the engine must be able to express a restaurant before a restaurant is seeded,
and the mocks are the acceptance harness for the engine.

## A. Schema and migration

- [x] **T1.1** Add `Resource` and `ServiceResource` to `prisma/schema.prisma`.
- [x] **T1.2** Add `Service.slotStepMin`, `bufferMin`, `maxPartySize`, `schedule`.
- [x] **T1.3** Add `Appointment.partySize`, `customerName`, `confirmationCode`;
      `TimeSlot.resourceId`.
- [x] **T1.4** Write the migration in the six ordered steps of `design.md` §E, including the
      backfill that gives every existing **service** one implicit resource.
      → `20260730000000_reservas_multirecurso`. Two corrections against the raw
      `prisma migrate diff` output: `franja_horaria.recurso_id` enters nullable and is hardened
      only after the backfill (the diff emitted `NOT NULL` outright, which fails on existing
      rows), and the unrelated `DROP INDEX "tenant_plan_id_idx"` — pre-existing drift — was
      excluded.
- [x] **T1.5** **HUMAN GATE** — approved by the user on 2026-07-29: apply directly to
      production. Backup taken first: `back/backups/aa-2026-07-29T22-35-30.dump` (4.86 MB).
- [x] **T1.6** Applied to `ciarfjnehqreaccykkjx` (schema `aa`) with `prisma migrate deploy`.
      `prisma migrate status` → "Database schema is up to date!", no drift. Postconditions:
      1 service → 1 resource → 1 link row; 9 slots, 0 without a resource, 0 pointing at a
      resource their service is not eligible for; 9 appointments, 0 without a confirmation code.

## B. Availability and assignment

- [x] **T2.1** `parseScheduleRange` and `getScheduleForDay` exported from `booking/slots.ts`;
      `computeAvailableSlots` now prefers `Service.schedule` and falls back to
      `AgentSchedule.schedule` through the same grammar.
- [x] **T2.2** `generateSlots` takes a 7th `stepMin` argument (default 30, so existing callers
      are byte-identical) and guards non-positive values — a step of 0 would never advance the
      loop. The grid and the duration are now separate concerns: a restaurant holds a table for
      105 min but accepts arrivals every 15.
- [x] **T2.3** `computeAvailableSlots(serviceId, rango, client, partySize)` rewritten as
      eligibility (linked resources, else every enabled agent resource) + capacity filter +
      half-open overlap `[arrival, arrival + duration + buffer)`, extending each *existing*
      booking by ITS OWN service buffer. Agents with zero resources keep the old exact-start
      path untouched (T5.6).
- [x] **T2.4** `pickBestFit` orders by `capacityMax asc, capacityMin asc, name asc` — the
      smallest table that fits, so a 2-guest booking does not burn the 8-seater. `P2002` on
      `(recurso_id, inicio)` still surfaces as `SlotUnavailableError`; `P2002` on
      `codigo_confirmacion` retries with a fresh code instead of failing the booking.
- [x] **T2.5** Cancellation deletes the `TimeSlot` inside a transaction with the status update,
      so the instant becomes bookable again. `Appointment.slotId` is nullable with
      `onDelete: SetNull`, and the appointment carries its own `inicio`/`fin` (migration
      `20260730010000`) so a cancelled booking keeps its date.
- [x] **T2.6** `GET /booking/slots` and `POST /booking/reserve` accept `partySize`
      (`z.coerce.number().int().positive().optional()`, default 1); `reserve` also accepts
      `customerName` and returns `partySize`, `confirmationCode` and `resource`.
      `freeResourceIds` is stripped before responding — inventory ids are internal.

## C. Agent tools

- [x] **T3.1** `consultar_disponibilidad` gains `comensales`; the description tells the model to
      ask for the party size BEFORE calling. `normalisePartySize` in `executor.ts` sanitises
      `"4"`, `0` and `2.5` down to a valid integer instead of letting the query blow up.
- [x] **T3.2** `crear_reserva` gains `comensales` (`nombre` was already required); the tool
      returns `codigo` and the description plus the system prompt order the model to read it
      back — a code the guest never hears cannot be used to cancel. The code alphabet excludes
      `0/O`, `1/I/L` and `5/S` because it is read over the phone.
- [x] **T3.3** New `consultar_mis_reservas(email?, telefono?)`. Neither field is required in the
      JSON Schema (`anyOf` is ignored by several providers), so
      `assertContactoIdentificacion` enforces "at least one" in the executor.
- [x] **T3.4** New `cancelar_reserva(codigo, email?, telefono?)`. `cancelAppointmentByCode`
      checks code + agent + matching contact and answers unknown code, wrong contact and
      another agent's code with ONE identical `BookingNotFoundError`, so the tool is not an
      oracle for guessing whose reservation a code belongs to.
- [x] **T3.5** Wired through `AgentBackendAdapter`, `managed-db.ts` and `executor.ts`.
      `external-api.ts` throws `ExternalApiNotSupportedError` rather than returning `[]` — an
      empty list would read as "you have no reservation". Beyond that, `ToolDefinition.modes`
      was added so the two tools are NOT even mounted under `external_api`: exposing a tool
      that always fails burns prompt and makes the bot promise something impossible.
- [x] **T3.6** `GroupTooLargeError` carries a structured refusal naming the groups-and-events
      channel and explicitly telling the model NOT to try other times; the agentic loop feeds
      it back as `{ error }`, and `routes/booking.ts` maps it to HTTP 422.

## D. Mock tenants

- [x] **T4.1** Idempotent seed script `scripts/seed-mock-tenants.ts`, one function per tenant,
      safe to re-run, with a documented teardown by tenant code.
      Idempotency proven by re-running the seed and getting byte-identical ids. Teardown proven
      on `mock-casa-mendieta`: `borrado (tenant + 1 agentes + 5 citas)`, then re-seeded, then
      `huerfanos-plataforma=0`. Two non-obvious things had to be handled and are commented in
      the script: `Appointment.service` is `onDelete: Restrict`, so appointments must be deleted
      by hand before the agent (everything else cascades), and `duplicatePolicy: "overwrite"`
      only dedupes identical content — it never clears a source — so re-ingestion purges the
      agent's chunks first or edited fixtures answer with the old text forever.
- [x] **T4.2** **Lafayette** — tenant, agent, 12 tables across Sala and Terraza (2/4/6/8
      seats), the three services of `design.md` §F with their real windows, system prompt
      carrying the carta URL, phone and the groups channel.
      In production: tenant `cms6pnubd0000ccfxl9w1j1nz`, agent `cms6pnui80001ccfx207scazc`,
      12 resources, 3 services. Service windows are copied verbatim from the site's own
      `HORARIO DE RESERVAS` block, because inventing them here would let the RAG answer and
      `consultar_disponibilidad` contradict each other inside one conversation. The prompt points
      at `/carta-lafayette-2/`: `/carta/` answers 200 but with `content-type: image/jpeg`.
- [x] **T4.3** Lafayette knowledge: ingest `brasserielafayette.es` through the existing web
      pipeline. Verify the carta, hours, groups and contact pages are all present in
      `fragmento_conocimiento`.
      78 chunks over 25 URLs. The four required pages are all there: `/carta-lafayette-2/` (5),
      `/carta-lafayette/` (4), `/contacto/` (2, and it carries the hours block), and
      `/grupos-y-eventos/` (7). Retrieval probed with three phrasings of the hours question — the
      hours chunk comes back every time (`d=0.59–0.70`), though only at rank 3 for two of them.
      Noted for the record: the single largest source is `/privacy-policy/` at 16 chunks, 21% of
      the index and pure legal boilerplate. It is not filtered here — a real tenant onboarding
      should exclude it, and that belongs to the ingestion pipeline, not to this seed.
- [x] **T4.4** **Barbería Núñez** — 3 barbers as resources, services of 30/45/60 min with
      per-service eligibility (one barber does not do beard work), continuous schedule with a
      break.
      Tenant `cms6pnv6e000kccfx1b76mtyu`, agent `cms6pnv87000lccfx0v0xm7h0`, 3 resources,
      3 services, 4 chunks from `servicios-precios.md` and `politicas.md`.
- [x] **T4.5** **Estética Aurea** — 4 cabins, one laser-only, treatments of 30–90 min with
      `bufferMin` for cabin reset, eligibility restricted by equipment.
      Tenant `cms6pnvoj000vccfx0uobr6np`, agent `cms6pnvqd000wccfxdxrnvcp1`, 4 resources,
      4 services, 6 chunks from `tratamientos.md` and `politicas.md`.
- [x] **T4.6** **Casa Mendieta** — no website. Author `faq.md`, `carta-alergenos.md`,
      `politicas.md` under `openspec/changes/.../fixtures/casa-mendieta/` and ingest them
      through the multipart file endpoint.
      Tenant `cms6qd2k20000i8fxuuczv7n8`, agent `cms6qd2pn0001i8fxu7macz2v`, 6 tables,
      2 services, 11 chunks. A fourth fixture, `horarios.md`, was split out of `faq.md`: while
      the hours lived inside the FAQ, two of the three hours questions retrieved no chunk
      containing a time at all (`d≈0.70`). With its own file all three land at rank 1
      (`d=0.43–0.58`). The fixture is written in arrival-window language — "the times in the
      table are when you can come **in**, not when we close" — because that is what
      `Service.schedule` actually means, and the earlier draft's "last dinner 21:30" contradicted
      a 2 h table against a 22:30 close.
- [x] **T4.7** All four tenants created inactive or test-flagged so they never bill, with the
      teardown documented alongside the seed.
      Verified in production for all four: `plan=null stripe=null status=draft`, balance
      10 000 000 tokens. `plan=null` is what keeps them out of billing; `status=draft` is what
      makes their public endpoints answer 403 instead of serving traffic.

## E. Verification

- [ ] **T5.1** Unit tests for the availability algorithm: eligibility by capacity, overlap
      boundaries (a booking ending at 15:00 does not block 15:00), buffer, best fit,
      per-service schedule overriding the agent schedule, `slotStepMin`.
- [ ] **T5.2** Unit tests for cancellation: valid, wrong contact, unknown code, cross-agent
      code, already cancelled, and rebooking the freed slot.
- [ ] **T5.3** Concurrency test: two simultaneous bookings for the last eligible resource —
      one succeeds, one gets `SlotUnavailableError`.
- [ ] **T5.4** Run the full casuistry matrix (`design.md` §G) against the four live agents and
      record the transcript of every row.
- [ ] **T5.5** `npx tsc --noEmit` clean and the full vitest suite green.
- [ ] **T5.6** Regression: an agent with no resources configured behaves exactly as before the
      migration.

## F. The mock is a client first, then a CRM, then a bot

The seed built the four mocks bottom-up: tenant, agent, catalogue, knowledge. That is the wrong
order for this platform. A business becomes a **client** first (`aa.tenant` with a `cli-NN` code
from `nextClientCode()`), the client gets a **CRM project** (`crm.negocio`, linked by
`tenant_id`, listed by membership), and only then does it get a **bot**. The four mocks skipped
the first step's convention — they carry hand-written codes (`mock-lafayette`) instead of the
sequence every real client uses — and never got the second at all: `crm.negocio` has seven rows
and none of them is a mock. In production they exist as agents with no client identity and no
CRM behind them.

- [x] **T6.1** Re-key the four mocks onto the client code sequence with `nextClientCode()`,
      preserving their ids so agents, services, resources and the indexed knowledge survive
      untouched. `seed-mock-tenants.ts` stops writing literal codes and keeps the code already
      assigned when re-run.
      *Done.* The lookup moved from `upsert` by `codigo` to `findFirst` by `name`, and the code
      is minted inside `withCodeRetry` only when the client does not already carry one from the
      sequence. Production: `cli-16` Brasserie Lafayette, `cli-17` Barbería Núñez, `cli-18`
      Estética Aurea, `cli-19` Casa Mendieta, continuing after `cli-15`.
- [x] **T6.2** Complete the client record of each mock the way the alta form does
      (`direccion`, `contactPerson`). `nif` and `razonSocial` stay empty: Brasserie Lafayette is
      a real business used as a knowledge source, and inventing fiscal identifiers for a real
      company in a production client list is not a mock, it is a forgery.
      *Done.* Address and contact written for the four; `nif` and `razonSocial` left null.
- [x] **T6.3** CRM provisioning script that creates one project per mock client through
      `createProjectService` — the same path as `POST /projects` and the operator — so it gets
      Business + sede + config + `ADMIN` membership + visit states in one transaction, and
      refuses to run for a tenant that does not exist in AA.
      *Done* — `creador_CRM/back/src/scripts/provision-mock-projects.ts`. It reuses the route's
      own deps (`tenantExists` + `prisma.$transaction`), so a tenant missing from `aa.tenant`
      returns `tenant_not_found` and the project is not created. The stored config carries only
      `business` (name, vertical, `clienteId`): omitting `modules` makes `deserialize()` return
      null and the front derive the preset from `configFromVertical(vertical)`, instead of
      freezing a copy of the module catalogue in the seed.
- [x] **T6.4** Mirror the catalogue into the CRM project: services, resources
      (tables / barbers / cabins) and opening hours, matching what the agent books against.
      One source of truth is out of scope here — see the note below.
      *Done by reading `aa.*`, not by re-declaring the catalogue.* The script pulls resources,
      services, their links and the schedule over `$queryRaw` and mirrors them: `kind: "table"`
      → `TABLE`, `"room"` → `CABIN`, and `"staff"` → `crm.empleado`, because a barber is a
      person and not inventory. A service with no explicit links is mirrored against the whole
      inventory, matching what `appointments.ts` actually does — mirroring the empty list as
      "no resources" would have turned Lafayette's dinner from twelve tables into none.
      Production result: Lafayette 3 services / 12 tables / 13 opening windows, Barbería 3
      services / 3 employees / 11 windows, Estética 4 services / 4 cabins / 6 windows, Mendieta
      2 services / 6 tables / 11 windows. Prices stay at 0: `aa.servicio_agente` has no price,
      and an empty price beats a fabricated tariff.
- [x] **T6.5** Idempotence and teardown: running the provisioning twice leaves one project per
      client, and the teardown removes the CRM side together with the AA side.
      *Done.* Second and third runs reported `SYNC` on the same four `negocio` ids with
      identical counts — the catalogue is re-synced, not duplicated. `--teardown` deletes the
      businesses of those four tenants only, and cascades take the rest.
- [x] **T6.6** Verify in production: the four appear in the clients panel with their `cli-NN`
      code, and in `/proyectos` for the owner's account.
      *Verified against the production database.* Each of the four has exactly one live
      `crm.negocio` (`eliminadoEn` null) with one `ADMIN` membership for the owner, which is
      the condition `/proyectos` lists on, and one sede carrying the client's address and
      phone. The AA clients panel lists tenants unfiltered, so the `cli-NN` codes are visible
      there by construction.

**Deliberately not done here.** The bot keeps booking into `aa.appointment`; the CRM project
receives the catalogue, not the bookings. Making the CRM the booking backend means finishing
`ExternalApiAdapter` (`listarServicios` is still unsupported), which is a change of its own.
Until then the occupancy shown in the CRM is not the occupancy the bot enforces, and that
limitation is stated rather than hidden.
