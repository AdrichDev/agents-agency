# Tasks

Critical order: T1 before T2 (T2 consumes `parseIsoInZone`). T3 and T4 independent.
T5 only after deploy.

## A. Zone-aware parsing

- [x] **T1.1** `lib/booking/timezone.ts`: export `parseIsoInZone(value, timezone)`.
      Offset/`Z` respected verbatim; naive read in `timezone`; invalid ⇒ invalid `DateTime`
      for the caller to reject.
- [x] **T1.2** `tests/booking-timezone.test.ts` :: `un ISO naive se lee en la zona del negocio`,
      `un ISO con offset se respeta tal cual`, `un ISO invalido no se da por bueno` (AC1).

## B. Booking tools

- [x] **T2.1** `executor.ts`: `withBackendAdapter` hands `agentId` to its callback.
- [x] **T2.2** `executor.ts`: `consultar_disponibilidad` resolves `desde`/`hasta` with
      `parseIsoInZone` + `getAgentTimezone(agentId)`.
- [x] **T2.3** `executor.ts`: `crear_reserva` normalises `startIso`/`endIso` to zoned ISO
      before `assertValidRange` and before the adapter call.
- [x] **T2.4** `tests/agent-backend-tools.test.ts` :: `consultar_disponibilidad lee un ISO naive en la zona del negocio (AC2)`
      and `crear_reserva normaliza un startIso naive a la zona del negocio (AC3)`.

## C. Date anchor

- [x] **T3.1** `engine.ts`: `buildSystemPrompt` accepts `fechaActual?: { instante; timezone }`
      and appends the anchor last in `systemParts`. Day granularity, weekday in `es`.
- [x] **T3.2** `engine.ts`: the caller supplies `new Date()` + `getAgentTimezone(agentId)`.
- [x] **T3.3** `tests/agent-backend-tools.test.ts` :: `el prompt ancla la fecha de hoy en la zona del negocio (AC4)`
      and `sin fechaActual el prompt no cambia (AC4)`.

## D. Availability floor

- [x] **T4.1** `slots.ts`: `generateSlots` takes `now: Date = new Date()` and filters
      `slotStart >= max(rangeStart, now)`.
- [x] **T4.2** `tests/booking-slots.test.ts` :: `no ofrece huecos de un año pasado (AC5)`.

## E. Verification

- [x] **T5.1** `npx tsc --noEmit` clean; booking + agent test files green.
- [ ] **T5.2** Deploy to `master`, confirm the SHA on `/health`.
- [ ] **T5.3** Real conversation against production, Lafayette, anonymous `POST /api/chat`:
      a booking is created, and the row's stored instant matches the hour the bot spoke.
      Record the confirmation code and the row in `validation.md` (V1).
