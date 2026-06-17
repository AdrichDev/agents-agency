# Propuesta — Rate Limit Reinforce

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 7 (rate limiting)

## Intención

El rate limiting YA está activo (commit d826d01): `apiLimiter` 300/min global,
`loginLimiter` 10/15min (anti brute-force), `leadsLimiter` 5/min (anti-spam),
`aiLimiter` 20/min en chat/prompt. Hueco real: los **endpoints más caros** (que
queman saldo de IA y APIs externas) solo tienen el límite global 300/min, que es
demasiado laxo para operaciones de coste alto.

Se refuerza:
1. **`heavyLimiter`** (default 10/min) para operaciones costosas:
   - `skills` POST (discover/discover-google/addRepo/addWebsite → scraping masivo).
   - `market-studies` POST `/`, `/:id/generate`, `/:id/sections/:key/regenerate` (IA + Places).
   - `landing` generate (IA).
2. **Límites configurables por entorno** (`RATE_LIMIT_*`) con los defaults actuales,
   para tunear sin tocar código.

**Éxito**: ninguna operación cara queda solo bajo el límite global; los límites se
ajustan por env.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/limiters.ts` | Modificado | `heavyLimiter` + límites por env |
| `back/src/routes/skills.ts` | Modificado | `heavyLimiter` en POST |
| `back/src/routes/market-studies.ts` | Modificado | `heavyLimiter` en generate/create/regenerate |
| `back/src/routes/landing.ts` | Modificado | `heavyLimiter` en generate |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Límite demasiado bajo molesta en uso normal | Media | 10/min razonable; configurable por env |
| Middleware rompe tests de handler directo | Baja | El limiter es middleware previo; los tests llaman al handler directo (lo saltan) |

## Notas

- In-memory (single-instance), suficiente en local/single deploy. Redis/distribuido
  (multi-instancia) sigue diferido hasta ir a nube.

## Criterios de éxito

- [x] `heavyLimiter` aplicado a skills/market-studies/landing costosos.
- [x] Límites leídos de env con defaults actuales.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes; server arranca limpio.
