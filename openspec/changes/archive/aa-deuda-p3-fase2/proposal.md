# Propuesta — aa-deuda-p3-fase2 (refactor mantenibilidad, SIN cambio de comportamiento)

## Intención
Continuar la deuda P3 de AA detectada por Agentic Runtime. Refactor PURO: contratos REST, UI y
comportamiento NO cambian. Solo estructura. (Fase 1 ya hizo configuracion/clientes y
landing/market-studies.)

## Alcance
- **#7 back — rutas finas restantes:** `routes/agents.ts` (358 LOC) y `routes/contacts.ts`
  (272). Mover lógica de negocio inline a `lib/`. Handlers finos. Sin cambiar rutas/
  payloads/status. (booking/automations solo si hay lógica claramente inline; opcional.)
- **#6 front — páginas mantenibles:** `app/landing-builder/[id]/page.tsx` (480),
  `app/contactos/page.tsx` (440), `components/AutomationsPanel.tsx` (430),
  `app/skills/page.tsx` (428), `app/agents/[id]/page.tsx` (357). Extraer fetch+estado a
  hooks (patrón `hooks/useResource`) y filas/modales/secciones a subcomponentes. UI y
  comportamiento idénticos. Tipar `any` de shape conocido (no inventar tipos).

## Fuera de alcance
- Lógica nueva, auth, esquema DB. n8n. Nada funcional nuevo.

## Riesgo
Back cubierto por vitest. Front AA SIN unit tests → validación = tsc + next build. El
builder preserva comportamiento EXACTO; ante duda, para y reporta.
