# Validation: aa-bot-agenda-citas-tool

## User story
Como owner de 3A Estudio, quiero preguntarle al bot de Telegram "qué citas tengo
esta semana" o "qué días tengo libres este mes" y que responda con mi agenda real
(las citas de Google Calendar ya sincronizadas), para organizarme sin abrir la web.

## Acceptance criteria
- AC1: `GET /service/operator/agenda` devuelve las citas del rango con
  `fecha/hora/cliente/servicio/estado`, excluyendo las canceladas.
- AC2: `GET /service/operator/agenda/huecos` devuelve, por cada día del rango,
  el número de huecos de 30 min libres (0 = día completo).
- AC3: Fechas con formato inválido → 400 sin tocar la BD.
- AC4: Las tools MCP `agencia_listar_citas` / `agencia_dias_libres` son de solo
  lectura y propagan el rango como query string al back.
- AC5: Sin token, la tool falla cerrada sin filtrar el token.

## Scenario (Given-When-Then)
- **Given** 4 citas en `PlatformAppointment` en la semana del 2026-07-06,
  **When** el bot llama `agencia_listar_citas(desde=2026-07-06, hasta=2026-07-12)`,
  **Then** recibe las 4 citas con su fecha/hora/cliente y las muestra al owner.

## Tests (1+ por tarea)
- Back `tests/service-operator-agenda.test.ts` (5 tests, verdes):
  - listar mapea citas (AC1) · 400 en formato inválido (AC3) · filtro `status != Cancelada` (AC1)
  - huecos: 19 libres con 1 cita · 20 libres sin citas (AC2)
- mcp-plataforma `src/tools/agencia.test.ts` (5 tests nuevos, verdes):
  - listar_citas pasa el rango en query string y muestra citas (AC4)
  - listar_citas vacío → mensaje, no error · sin rango → sin query string
  - dias_libres muestra disponibilidad ("completo" en 0)
  - red caída → error claro (AC5-adyacente)

## Definition of done
- tsc limpio en back y mcp-plataforma. Tests verdes (back 5/5, mcp 30/30).
- Verificado end-to-end vía cadena MCP real (`agencia_listar_citas` devuelve las
  4 citas reales de Google Calendar).
- Pendiente: revisión (gate) + smoke manual del usuario en Telegram.
