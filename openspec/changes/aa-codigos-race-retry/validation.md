# Validación — aa-codigos-race-retry

Historia: como sistema que crea agentes/clientes/presupuestos en paralelo, quiero que dos
peticiones concurrentes nunca fallen por código duplicado: el reintento debe recalcular el
siguiente código, no reutilizar el que ya chocó.

## Criterios de aceptación (AC)

- **AC1**: En `createAgent`, el cálculo de `codCliente` ocurre dentro del closure de `withCodeRetry`
  que envuelve `prisma.agent.create`. Un P2002 recalcula y reintenta el create completo.
- **AC2**: En `createAgent`, el `quoteNumber` del presupuesto se calcula dentro del closure que
  envuelve `prisma.budget.create`.
- **AC3**: En `createLandingQrBudget`, el `quoteNumber` se calcula dentro del closure del create.
- **AC4**: Happy path sin cambios: crear un agente con clientName nuevo produce agente + tenant
  (codigo cli-NN) + presupuesto borrador (AD-año-NNN), igual que antes.
- **AC5**: tsc limpio; AA back suite verde.

## Por tarea (Given-When-Then + test)

### T.1 — codes.test.ts (regresión)
- **Given** un closure que computa el código con `nextCode()` y choca con P2002 en el primer valor,
  **When** `withCodeRetry(closure)`, **Then** `nextCode` se invoca de nuevo (recalcula) y el segundo
  intento resuelve. _Test: unit `tests/codes.test.ts` "recalcula el código dentro del retry tras P2002"._
- **Given** withCodeRetry ya existente, **When** los tests previos (primer intento OK / P2002→reintento /
  no-P2002 propaga / agota intentos), **Then** siguen verdes. _Test: unit (sin cambios)._

### T.2 — service.ts / landing/budget.ts (estructura)
- **Given** el código revisado, **When** se inspecciona, **Then** los 3 call-sites usan
  `withCodeRetry(async () => prisma.X.create({ data: { codigo|quoteNumber: await nextCode(), ... }}))`.
  _Test: cubierto indirectamente por la suite AA back (creación de agente/landing) + typecheck._

### V — Verificación
- **Given** el cambio aplicado, **When** `npx tsc --noEmit` y `npm test`, **Then** tsc limpio y suite verde.
  _Test: AA back (vitest)._
