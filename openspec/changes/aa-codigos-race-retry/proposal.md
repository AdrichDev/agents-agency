# Proposal — Fix carrera en generación de códigos secuenciales (aa-codigos-race-retry)

**Nivel Gru: 2 — Medio.** 3 ficheros, 1 dominio (generación de códigos), reversible, sin migración.
**Estado: APROBADO (2026-06-28) — redo bajo SDD tras revert previo.**

## Contexto

`withCodeRetry(create, maxAttempts=3)` (`back/src/lib/codes.ts`) reintenta `create()` ante
violación de unique P2002, para resolver carreras al generar códigos secuenciales
(cli-NN, pc-NN, AD-año-NNN). El patrón SOLO funciona si el **cálculo del código** ocurre
DENTRO del closure reintentado: si va fuera, tras un P2002 se reutiliza el código viejo y
el reintento vuelve a chocar (o ni reintenta, porque `withCodeRetry` ya retornó).

3 call-sites calculan el código FUERA del retry → en carrera real petan por unique sin
reintentar de verdad:
- `lib/agent/service.ts:83` — `withCodeRetry(() => nextClientCode())`, y el `agent.create`
  (con `tenant.codigo`) va después, fuera.
- `lib/agent/service.ts:123` — `nextQuoteNumber` fuera, `budget.create` después.
- `lib/landing/budget.ts:14` — igual con `nextQuoteNumber`.

El patrón CORRECTO ya se usa en `routes/clients.ts`, `routes/contacts.ts` (x2),
`lib/notifications.ts`: `withCodeRetry(async () => prisma.X.create({ data: { codigo: await nextCode(), ... }}))`.

## Intención

Alinear los 3 call-sites buggy al patrón correcto: cálculo + create dentro del mismo closure
reintentado. Sin cambiar el contrato público ni el happy path.

## Decisiones técnicas

- Envolver `prisma.agent.create` completo (con `tenant.create` anidado) en `withCodeRetry`,
  computando `nextClientCode()` dentro. El create anidado es atómico → en P2002 no persiste
  nada y el reintento recalcula.
- Igual para `budget.create` (quoteNumber dentro del closure) en service.ts y landing/budget.ts.
- NO migrar a secuencia/contador en DB (suficiente el retry para el volumen actual).

## Alcance

1. `back/src/lib/agent/service.ts` — `createAgent`: 2 closures (codCliente, quoteNumber).
2. `back/src/lib/landing/budget.ts` — `createLandingQrBudget`: 1 closure.
3. `back/tests/codes.test.ts` — test de regresión: el código se recalcula dentro del retry tras P2002.

## Fuera de alcance

- Secuencia/contador en DB.
- Tocar los call-sites ya correctos (clients/contacts/notifications).

## Riesgos

- Envolver agent.create en retry: si P2002 viene de OTRO unique (no codigo), reintentaría en vano
  hasta agotar (3) y relanzar — comportamiento aceptable (igual que antes acababa lanzando).
