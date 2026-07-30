# Design — multi-resource bookings

## A. How the industry actually models this

Reservation systems for restaurants (CoverManager, TheFork, OpenTable, Resy) all converge on
the same five primitives. Barbershops (Booksy, Treatwell) and beauty centres use the same
ones with different vocabulary. The vocabulary difference is why these look like three
products; they are one.

| Primitive | Restaurant | Barbershop | Beauty centre |
|---|---|---|---|
| **Resource** — the finite unit being consumed | Table, with a seat range and a zone | Barber | Cabin, sometimes cabin + therapist |
| **Sitting / turno** — when arrivals are accepted | Lunch 13:30–15:45, dinner 20:00–22:45 | Continuous day with a break | Continuous day |
| **Occupancy** — how long the unit is held | Table turn time, grows with party size | Service duration | Treatment duration |
| **Party size** | Covers, drives which tables fit | Always 1 | Always 1 |
| **Eligibility** — which units can serve this | Any table whose range contains the party | Any barber offering the service | Only cabins equipped for the treatment |

The domain statement that unifies them:

> A booking reserves **one eligible resource** for the **half-open interval**
> `[arrival, arrival + duration + buffer)`, where eligibility is the intersection of
> *"this resource can perform this service"* and *"this resource fits this party"*.

Everything else — zones, professional preference, treatment equipment — is a filter on
eligibility. Nothing else in the model has to change per vertical.

### What the reference restaurant tells us

`brasserielafayette.es` (Calle Recaredo 2, Madrid) publishes:

- Monday to Saturday: `13:30–15:45` and `20:00–22:45` — two discrete sittings, not a
  continuous day. The published window is the **arrival** window; the table is held longer.
- Sunday: brunch `11:30–13:30` and carta `13:30–16:00`. **No Sunday dinner.**
- A carta with per-dish allergens ("los alérgenos quedan recogidos en rojo bajo cada
  elaboración") and optional ingredients marked with `*`.
- A separate *Grupos y Eventos* channel — the escape hatch for parties the online system
  should not take.
- Gluten-free bread and couvert as a paid extra, i.e. dietary handling is a real question
  guests ask before booking.

Three facts fall out of this and drive the model: sittings are per **service**, not per day;
the arrival window is not the occupancy window; and large parties leave the automated flow.

## B. Model

### New: `Resource`

```prisma
model Resource {
  id          String   @id @default(cuid())
  agent       Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  agentId     String   @map("agente_id")
  name        String   @map("nombre")        // "Mesa 4", "Javi", "Cabina Láser"
  kind        String   @map("tipo")          // table | staff | room — informativo, no ramifica lógica
  capacityMin Int      @default(1) @map("capacidad_min")
  capacityMax Int      @default(1) @map("capacidad_max")
  zone        String?  @map("zona")          // "Sala", "Terraza", "Planta 1"
  enabled     Boolean  @default(true) @map("activo")
  services    ServiceResource[]
  slots       TimeSlot[]
  createdAt   DateTime @default(now()) @map("creado_en")

  @@unique([agentId, name])
  @@index([agentId, enabled])
  @@map("recurso")
}
```

`kind` is a label for the UI and for the agent's wording ("mesa" vs "cabina"). It must not
branch the availability algorithm — the moment it does, the three verticals fork again.

### New: `ServiceResource` (m:n)

Which resources can serve which service. A barber who does not do beard trims, a cabin
without a laser, the terrace that is closed for brunch — all the same edge.

An empty set means **every** enabled resource of the agent is eligible. That is what keeps
the migration behaviour-preserving for existing single-service agents.

### Changed: `Service`

```
+ slotStepMin  Int     @default(30)   // arrival granularity; 15 for restaurants
+ bufferMin    Int     @default(0)    // turnaround: cleaning, cabin reset
+ maxPartySize Int     @default(1)    // above this → groups channel
+ schedule     Json?                  // per-service turno; overrides AgentSchedule when set
```

`slotStepMin` replaces the `minute += 30` literal in `generateSlots`. `schedule` uses the
exact same shape and parser as `AgentSchedule.schedule`, including the `|` split that already
expresses `13:30-15:45|20:00-22:45`. Reusing the parser is deliberate: one grammar, one
day-key normaliser, one place where the `mon` / `monday` bug can ever live again.

### Changed: `TimeSlot`

```
+ resourceId  String  @map("recurso_id")
- @@unique([serviceId, startTime])
+ @@unique([resourceId, startTime])
+ @@index([resourceId, startTime, endTime])
```

The unique moves from service to resource. That single swap is what turns "one booking per
instant" into "one booking per table per instant", which is the whole point.

### Changed: `Appointment`

```
+ partySize        Int     @default(1) @map("comensales")
+ customerName     String? @map("nombre_cliente")
+ confirmationCode String  @unique @map("codigo_confirmacion")   // "LAF-7K2Q"
```

`confirmationCode` is what makes bot-side cancellation possible at all: the guest has no
account and does not know the cuid. Generated from a 4-char Crockford-base32 alphabet with a
tenant prefix, retried on collision the same way `lib/codes.ts` already handles
`Tenant.codigo`.

## C. Availability algorithm

Replaces "generate the grid, subtract taken instants".

```
availability(service, from, to, partySize):
  1. windows   ← parseSchedule(service.schedule ?? agent.schedule)     # turnos
  2. arrivals  ← every service.slotStepMin from each window start,
                 while arrival + service.duration <= window end,
                 excluding blocked days and anything already in the past
  3. eligible  ← resources of the service (or all agent resources if unlinked)
                 where enabled and capacityMin <= partySize <= capacityMax
  4. for each arrival a:
       hold ← [a, a + service.duration + service.bufferMin)
       free ← eligible minus resources with a non-cancelled slot overlapping hold
       emit a if free is non-empty
```

Overlap is the standard half-open test — `existing.start < hold.end AND existing.end >
hold.start` — so a booking ending exactly at 15:00 does not block one starting at 15:00.

Note step 2 ends the sitting on `arrival + duration <= window end`, not on occupancy end. A
21:00 dinner arrival is legitimate even though the table is held past the 22:45 window close;
the window governs arrivals, which is what the restaurant publishes.

### Assignment on booking

Inside the existing `Serializable` transaction, after re-computing `free`:

```
chosen ← argmin(free, by capacityMax, tie-broken by name)
```

Best fit, not first fit. A party of two must not consume the eight-top while a two-top sits
empty — that is the single most visible difference between a real system and a naive one, and
it shows up as phantom "no availability" for large parties later in the evening.

The unique index on `(resourceId, startTime)` remains the last line of defence: two
concurrent transactions that both pick the same table collide on `P2002` and the loser is
translated to `SlotUnavailableError`, exactly as today.

## D. Cancellation from the bot

Two new tools under the `reservas` capability.

**`consultar_mis_reservas(email? , telefono?)`** — at least one required. Returns upcoming,
non-cancelled bookings of **this agent** matching that contact, with the confirmation code,
date, service, party size and resource zone.

**`cancelar_reserva(codigo, email? , telefono?)`** — requires the code **and** a matching
contact on the same booking.

The threat is a bot that cancels strangers' reservations. Three rules, all testable:

1. The code alone is never sufficient. A four-character code is guessable at scale; the
   contact match is what binds the request to the holder.
2. The lookup is always scoped to `service.agentId`. A code from Lafayette must not resolve
   inside the barbershop's agent even if the strings collide.
3. A mismatch returns the same neutral "no encuentro esa reserva" as a non-existent code.
   Distinguishing them turns the tool into an oracle for testing whether a code is real.

Cancellation reuses `cancelAppointment`, which already frees the slot and unsyncs the
calendar. It gains the fix below.

### The rebooking defect

`cancelAppointment` sets `available = true` and keeps the `TimeSlot` row;
`createAppointment` calls `timeSlot.create`. The cancelled instant is offered again and the
insert collides with the unique index, so **a cancelled slot can never be rebooked**. With
`(resourceId, startTime)` the collision would persist unchanged.

Fix: delete the `TimeSlot` inside the cancellation transaction rather than flagging it. The
row carries no history — `Appointment` keeps `status = "cancelled"`, the timestamps and the
`gcalEventId`, which is where the audit trail belongs. `Appointment.slotId` is
`onDelete: Restrict`, so the relation is severed first; that makes `slotId` nullable, and
that nullability is the honest representation of "this booking no longer holds inventory".

## E. Migration

Additive except for one index swap. Ordered so that no step leaves the table unusable:

1. Create `recurso` and `servicio_recurso`.
2. Add the nullable columns to `cita` and `franja_horaria`.
3. **Backfill**: for every **service**, insert one resource named after it
   `{ kind: "room", capacityMin: 1, capacityMax: 1 }`, link it through `servicio_recurso`, and
   point every existing `franja_horaria` row at its service's resource. Every existing service
   therefore keeps exactly one bookable unit — current behaviour to the row.

   Per service, not per agent. The old unique was `(servicio_id, inicio)`, so two services of
   the same agent could each hold a slot at the same instant. One shared resource per agent
   would collapse those into a collision against the new `(recurso_id, inicio)` unique and
   silently remove capacity. Production has no agent with more than one service today, so the
   difference is currently theoretical — which is exactly why it is worth getting right now,
   while it costs nothing.
4. Backfill `cita.comensales = 1` and generate a confirmation code per existing booking,
   derived from the id (`'LEG-' || upper(substr(md5(id), 1, 6))`) so it is stable and
   collision-free.
5. Make `franja_horaria.recurso_id` `NOT NULL`. `cita.codigo_confirmacion` stays nullable:
   it is unique, and a `NOT NULL` unique column would force a code onto rows that legitimately
   have none (staff-created bookings). Postgres allows many `NULL`s under a unique index.
6. Drop `franja_horaria_servicio_id_inicio_key`, create the unique on
   `(recurso_id, inicio)`.

Step 6 is the only irreversible one and the reason this needs approval before it runs against
the shared production Supabase.

**Applied** on 2026-07-29 as `20260730000000_reservas_multirecurso`, after a `pg_dump` to
`back/backups/aa-2026-07-29T22-35-30.dump`. `prisma migrate status` reports no drift; all 9
pre-existing slots resolve to exactly one resource that their service is eligible for, and all
9 pre-existing bookings carry a code.

## F. Mock tenants

Four tenants, each a complete configuration a client could be handed. They differ by
**delivery mode**, which is the axis actually being proven.

| Tenant | Vertical | Resources | Knowledge source |
|---|---|---|---|
| **Lafayette** | Brasserie, Madrid | 12 tables across Sala and Terraza, 2–8 seats | Web ingestion of `brasserielafayette.es` |
| **Barbería Núñez** | Barbershop | 3 barbers | Web-style content authored as pages |
| **Estética Aurea** | Beauty centre | 4 cabins, one laser-only | Web-style content authored as pages |
| **Casa Mendieta** | Restaurant, no website | 8 tables | **Files only**: FAQ, carta with allergens, policies |

Lafayette's services encode the published reality:

| Service | Days | Window | Duration | Buffer | Step | Max party |
|---|---|---|---|---|---|---|
| Comida | Mon–Sun | 13:30–15:45 (Sun 13:30–16:00) | 105 | 15 | 15 | 8 |
| Cena | Mon–Sat | 20:00–22:45 | 120 | 15 | 15 | 8 |
| Brunch | Sun | 11:30–13:30 | 90 | 15 | 15 | 6 |

Sunday has no dinner service, so "mesa para el domingo a las 21:00" must be answered with the
closure and an alternative — one of the casuistries below, and one that a naive
implementation gets wrong by silently offering Saturday.

The menu is not a tool. It is knowledge: the carta page chunks carry dish, price and
allergens, so *"¿el steak tartare lleva huevo?"* is a retrieval question. What the agent gets
in its prompt is the carta **URL**, so *"mándame la carta"* returns a link rather than a wall
of text.

## G. Casuistry matrix

Every row is an acceptance test against the live agent, not a unit test.

**Booking** — availability for a date and party size · party above `maxPartySize` routed to
groups and events · arrival outside the sitting (16:30) answered with the dinner window ·
Sunday dinner answered as closed · full house at a given hour · a date in the past · booking
for a party that only fits the eight-top when smaller tables are free (best fit) · terrace
requested explicitly.

**Cancellation** — cancel with a valid code and matching contact · valid code with the wrong
contact · non-existent code · a code belonging to another tenant's agent · listing one's own
bookings by phone · cancelling an already-cancelled booking · rebooking the freed slot.

**Menu and allergens** — price of a named dish · allergens of a named dish · gluten-free
options · a vegetarian request when nothing is labelled vegetarian, which must be answered
honestly rather than invented · asking for the carta, answered with the URL.

**Hours** — opening times · Sunday · brunch versus carta on Sunday · closing time of the
kitchen, which the site does not publish and which the agent must therefore not fabricate.

The two "must not invent" rows are deliberate. They are the difference between a demo and a
product, and they are the cases a retrieval-backed agent fails silently.
