# Propuesta — HTTP Caching

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 8 (caché)

## Intención

Pilar 8: evitar recomputar y reenviar respuestas que cambian poco, para mantener
la app rápida y reducir carga. Hoy **ninguna respuesta lleva `Cache-Control`**;
endpoints de solo lectura que se piden muy a menudo (p. ej. la config del widget,
cargada en cada visita donde está embebido) se recalculan y reenvían siempre.

Se añade una utilidad reutilizable de caché HTTP y se aplica a lecturas seguras:

1. **`setCache(res, opts)` + `cacheControl(opts)`** (`lib/cache.ts`): helper para
   fijar `Cache-Control` (maxAge, public/private, `stale-while-revalidate`) en una
   respuesta concreta o como middleware de ruta.
2. **`GET /api/widget/config`**: `Cache-Control: public, max-age=60,
   stale-while-revalidate=300` (solo en éxito) — es público y muy pedido.
3. **`GET /api/sectors`**: `Cache-Control: private, max-age=30` (va tras auth).

Express ya emite **ETag** por defecto en respuestas JSON → con `Cache-Control`
presente, el cliente revalida con `If-None-Match` y obtiene `304` cuando no hay
cambios (menos ancho de banda).

**Éxito**: las lecturas seguras llevan `Cache-Control` apropiado; las respuestas
de error NO se cachean; revalidación `304` funcional.

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| Caché distribuida (Redis) | Prematuro en single-org/local (pilar 9) |
| Cachear datos CRM mutables (clients/contacts) | Riesgo de stale tras mutaciones; no se cachea |
| CDN / edge caching | Requiere deploy en nube (diferido) |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/cache.ts` | Nuevo | `setCache` + `cacheControl` |
| `back/src/routes/ai.ts` | Modificado | `setCache` en `GET /widget/config` (éxito) |
| `back/src/routes/sectors.ts` | Modificado | `cacheControl` middleware en `GET /` |
| `back/tests/cache.test.ts` | Nuevo | Unit test del helper |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Cachear una respuesta de error (4xx/5xx) | Media | `setCache` se llama solo en la rama de éxito del handler |
| Servir datos obsoletos del widget | Baja | `max-age` corto (60s) + `stale-while-revalidate`; cambios visibles en <1 min |
| Cachear datos privados como public | Media | `sectors` usa `private`; solo `widget/config` (público) usa `public` |

## Criterios de éxito

- [x] `lib/cache.ts` expone `setCache` y `cacheControl` con unit test (7).
- [x] `GET /api/widget/config` (éxito) fija `Cache-Control: public, max-age=60, stale-while-revalidate=300` (+ `ETag` por defecto de Express).
- [x] Respuesta de error de `widget/config` (400) NO lleva `Cache-Control` (verificado en vivo).
- [x] `GET /api/sectors` fija `Cache-Control: private, max-age=30`.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes.
