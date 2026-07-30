# Validation

## User story

As the owner of a restaurant, a barbershop or a beauty centre, I want the agent to take and
cancel bookings against my real inventory — my tables, my barbers, my cabins — and to answer
what my guests actually ask before booking, so that the bot replaces the phone instead of
adding a step before it.

## Acceptance criteria

- **AC1** A service with more than one eligible resource accepts more than one booking at the
  same instant, up to the number of eligible resources.
- **AC2** A booking carries a party size, and only resources whose capacity range contains it
  are offered or assigned.
- **AC3** Assignment is best fit: with a free two-top and a free eight-top, a party of two
  takes the two-top.
- **AC4** Sittings are per service. Lafayette's Sunday has brunch and lunch and no dinner.
- **AC5** A party above the service maximum is routed to the groups channel by name, not
  refused generically.
- **AC6** The guest receives a confirmation code and can cancel with it plus the email or
  phone used to book.
- **AC7** A cancellation attempt with a valid code and a non-matching contact fails, with the
  same message as an unknown code.
- **AC8** A confirmation code cannot resolve inside another agent's bookings.
- **AC9** A cancelled slot can be booked again.
- **AC10** Menu and allergen questions are answered from indexed knowledge; asking for the
  carta returns the URL. What is not published is not invented.
- **AC11** An agent with no resources configured behaves exactly as before the migration.
- **AC12** Each mock exists as a client of the platform the same way every other client does:
  a sequential `cli-NN` code produced by the platform's own generator, not a hand-written one.
- **AC13** Each mock client owns a CRM project linked to it, visible to the platform owner in
  the projects panel, with the same catalogue the agent books against (services, resources,
  opening hours).
- **AC14** Confirming, listing and cancelling report the same wall clock the guest was
  offered: the hour the assistant says out loud never drifts from the hour that was booked.

## Scenarios

**AC1 — concurrency of resources**
> **Given** Lafayette has twelve tables and no bookings on 12/08 at 21:00
> **When** twelve parties of two book that instant in sequence
> **Then** all twelve succeed, and the thirteenth is told there is no availability
> *Test:* `tests/booking-resources.test.ts` → `"acepta tantas reservas simultáneas como recursos elegibles"`

**AC2 — capacity filter**
> **Given** the only free table at 21:00 seats two
> **When** a party of six asks for 21:00
> **Then** 21:00 is not offered
> *Test:* `tests/booking-resources.test.ts` → `"no ofrece un instante cuyo único recurso libre no admite el grupo"`

**AC3 — best fit**
> **Given** a free two-top and a free eight-top at 13:30
> **When** a party of two books 13:30
> **Then** the two-top is assigned and the eight-top stays free
> *Test:* `tests/booking-resources.test.ts` → `"asigna el recurso más pequeño que admite el grupo"`

**AC4 — per-service sittings**
> **Given** Lafayette's dinner service runs Monday to Saturday
> **When** availability is requested for a Sunday evening
> **Then** no dinner slot is returned and the lunch and brunch windows are
> *Test:* `tests/booking-service-schedule.test.ts` → `"el horario del servicio manda sobre el del agente"`

**AC5 — large party**
> **Given** the lunch service caps online parties at eight
> **When** a party of fourteen is requested
> **Then** the tool returns the groups-and-events referral rather than a generic failure
> *Test:* `tests/booking-resources.test.ts` → `"deriva a grupos los grupos por encima del máximo"`

**AC6 — cancel with code and contact**
> **Given** a booking made with `ana@example.com` and code `LAF-7K2Q`
> **When** cancellation is requested with that code and that email
> **Then** the booking becomes `cancelled` and its resource is released
> *Test:* `tests/booking-cancel-tool.test.ts` → `"cancela con código y contacto coincidentes"`

**AC7 — wrong contact**
> **Given** the same booking
> **When** cancellation is requested with `LAF-7K2Q` and `otro@example.com`
> **Then** it fails with the same message as an unknown code and the booking stays scheduled
> *Test:* `tests/booking-cancel-tool.test.ts` → `"no cancela con contacto que no coincide, y no revela que el código existe"`

**AC8 — cross-tenant code**
> **Given** the same code string exists on the barbershop agent
> **When** Lafayette's agent is asked to cancel it
> **Then** it is not found
> *Test:* `tests/booking-cancel-tool.test.ts` → `"un código de otro agente no resuelve"`

**AC9 — rebooking**
> **Given** a booking at 21:00 that is then cancelled
> **When** another guest books 21:00
> **Then** it succeeds
> *Test:* `tests/booking-appointments.test.ts` → `"un hueco cancelado vuelve a ser reservable"`

**AC10 — allergens from knowledge**
> **Given** Lafayette's carta is indexed
> **When** the agent is asked whether the steak tartare contains egg, and separately for a
> vegan dish
> **Then** the first is answered from the indexed allergen list, and the second states that
> nothing on the carta is labelled vegan instead of inventing one
> *Test:* casuistry matrix run, `T5.4`, rows *allergens of a named dish* and *vegetarian
> request*

**AC11 — no regression**
> **Given** an agent with services but no resources configured
> **When** availability and booking run
> **Then** results are identical to the pre-migration behaviour
> *Test:* `tests/booking-slots.test.ts` and `tests/booking-appointments.test.ts` pass
> unchanged except for the new `partySize` default

**AC12 — a mock is a client like any other**
> **Given** the four mocks seeded in production
> **When** the clients panel is listed
> **Then** each one carries a `cli-NN` code taken from the same sequence as the real clients,
> and re-running the seed does not mint a second code for a mock that already has one
> *Test:* `tests/seed-mock-clients.test.ts` → `"reutiliza el codigo cli-NN ya asignado"`

**AC13 — the client owns a CRM project**
> **Given** a mock client with services and resources in AA
> **When** the CRM provisioning script runs for it
> **Then** a `crm.negocio` exists linked by `tenant_id`, the owner holds an `ADMIN` membership,
> and the project's services, resources and opening hours match the agent's catalogue; running
> it twice does not duplicate the project
> *Test:* `creador_CRM/back/tests/provision-mock-projects.test.ts` →
> `"no duplica el negocio si ya existe para ese tenant"`

**AC14 — the assistant speaks the business's clock**
> **Given** a booking stored as `2026-08-05T20:30:00.000Z` for an agent in `Europe/Madrid`
> **When** the guest asks for their bookings, and then cancels
> **Then** both tool results say `2026-08-05T22:30:00.000+02:00` — the hour the guest agreed,
> not the UTC instant underneath it
> *Test:* `tests/booking-cancelacion-cliente.test.ts` → `"devuelve la hora en la zona del
> agente, no en UTC"`, `"un agente sin horario configurado cae a Europe/Madrid, no a UTC"`,
> `"respeta una zona distinta de la del servidor"`; `tests/managed-db-adapter.test.ts` →
> `"mapea el resultado del helper a Reserva y pasa el serviceId correcto"`

## Out of scope for these criteria

Table combining, pacing limits, deposits, waiting lists, and the Google Calendar token defect
(`booking/sync.ts` reads a field that OAuth never writes). None of them are exercised here.
