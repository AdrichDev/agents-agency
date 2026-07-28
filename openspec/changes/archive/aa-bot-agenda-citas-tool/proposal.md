# Proposal: aa-bot-agenda-citas-tool

## Intent
Permitir que el bot de Telegram (agente `main` de OpenClaw, vía `mcp-plataforma`)
consulte la agenda real del owner: listar las citas de un rango (hoy/semana/mes)
y saber qué días tienen huecos libres.

## Problem
Las tools de citas del bot (`citas__*`, n8n) apuntaban a `openclaw_db.citas`, una
BD **local** del contenedor n8n (demo dental), siempre vacía. Las citas reales del
owner viven en Supabase `aa.cita_agenda_plataforma` (modelo Prisma
`PlatformAppointment`, espejo de Google Calendar sincronizado por
`aa-agenda-google-import`). Resultado: el bot respondía "lista vacía" / "no tengo
acceso".

## Scope
- **Back AA** (`service-operator.ts`, ya tras `requireOperatorToken`):
  - `GET /service/operator/agenda?desde&hasta` → citas del rango.
  - `GET /service/operator/agenda/huecos?desde&hasta` → huecos libres de 30 min
    por día (09:00–19:00).
  - Solo lectura, sin auditoría (mismo criterio que `/estado`).
- **mcp-plataforma**: tools `agencia_listar_citas` y `agencia_dias_libres`
  (patrón `agencia_*`, readOnly).
- **OpenClaw** (`setup.sh`): `tools.alsoAllow` += `plataforma__agencia_listar_citas`,
  `plataforma__agencia_dias_libres`.

## Out of scope
- No se consulta Google Calendar directamente: ya está espejado en Supabase.
- No hay escritura de citas desde esta vía (crear/editar sigue en su flujo).
- Multi-tenant real: hoy la agenda es single-tenant (owner de plataforma). El
  patrón (endpoint service-token + tool MCP) es lo reutilizable para bots de
  otros tenants; cada uno apuntará a su propia fuente de agenda.

## Risks
- Bajo. Cambio aditivo, solo lectura. El back corre con `tsx watch` (hot-reload).
- `mcp-plataforma` es contenedor → requiere `docker compose build` + `up`.
- `setup.sh` re-aplica `alsoAllow` en cada boot; editar el `openclaw.json` runtime
  no persiste (editar el script fuente).

## Dependencies
- `AGENCIA_SERVICE_TOKEN` / `AGENCIA_BASE_URL` (ya configurados en mcp-plataforma).
- Modelo `PlatformAppointment` (`aa.cita_agenda_plataforma`) ya existente.
