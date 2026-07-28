# Spec (delta): Agenda del owner vía service-token

## ADDED — GET /service/operator/agenda
Auth: `x-service-token` (`requireOperatorToken`). Solo lectura.

**Query**: `desde?`, `hasta?` (YYYY-MM-DD, hora de pared). Defaults: `desde`=hoy,
`hasta`=`desde`.

**UC**: listar las citas de la agenda de plataforma (`PlatformAppointment`) en el
rango, excluyendo `estado = "Cancelada"`, ordenadas por inicio.

- Given rango válido → 200 `{ desde, hasta, total, citas[] }` con
  `{ id, fecha, hora, cliente, servicio, estado }`.
- Given `desde`/`hasta` con formato inválido o `hasta < desde` → 400.

## ADDED — GET /service/operator/agenda/huecos
Auth y query idénticos. Solo lectura.

**UC**: por cada día del rango, número de huecos de 30 min libres en 09:00–19:00
(20 slots/día) descontando los ocupados por citas.

- Given un día con N slots ocupados → `huecos_libres = 20 − N` (0 = completo).
- Given rango inválido → 400.

## ADDED — Tools MCP (mcp-plataforma)
- `agencia_listar_citas(desde?, hasta?)` → GET /agenda. readOnly.
- `agencia_dias_libres(desde?, hasta?)` → GET /agenda/huecos. readOnly.
Fail-closed sin token; nunca filtran el token en el mensaje de error.
