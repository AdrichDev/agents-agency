# Proposal — Upgrade Next 14 → 15 en AA front (aa-front-next-15)

**Nivel Gru: 3 — Grande.** Major framework, App Router, build de producción. Reversible (deps).
**Estado: APROBADO (2026-06-28) — F3 del plan de alineación de versiones (#7).**

## Contexto

AA front en Next ^14.2.5 + React ^18.3.1. CRM front (referencia alineada) en Next 15.5 + React 19.
Para alinear, AA front sube Next 14→15 (F3) y luego React 18→19 (F4).

Breaking surface de Next 15 en AA front (dimensionado):
- NO usa `cookies()/headers()/draftMode()` (no afecta el cambio a APIs async).
- `searchParams/params` se usan solo vía `useSearchParams()` (client hook) en pages `"use client"`
  (agents/new, dashboard, facturacion) → el cambio de props async de Server Components NO aplica.
- Cambios de caché por defecto (fetch no cacheado, GET handlers no cacheados) → comportamiento, se
  valida con `next build`.
- Acoplamiento React: Next 15 App Router prefiere React 19. Si el build exige React 19, se combina F4.

## Intención

Subir Next a ^15 manteniendo React 18 si el build lo permite; validar con typecheck + `next build`.

## Decisiones técnicas

- `next` → `^15`. Mantener `react`/`react-dom` en ^18.3.1 (F4 sube a 19).
- Ejecutar codemod oficial si hace falta (`npx @next/codemod@canary upgrade`) — pero solo si el build lo pide.
- Validación: `npm run typecheck` + `npm run build` (no hay unit suite; e2e playwright aparte).

## Alcance

1. `front/package.json`: `next` → `^15`.
2. Ajustes mínimos si el build de Next 15 reporta breaking (config, eslint, etc.).

## Fuera de alcance

- React 18→19 (F4), salvo que Next 15 lo exija para buildear (entonces se combina y se documenta).
- Cambios funcionales no forzados.

## Riesgos

- Next 15 puede requerir React 19 → build falla con React 18. Mitigación: combinar F4 si ocurre.
- `next.config` / eslint flat config cambios. Validar build.
