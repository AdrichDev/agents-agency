# Tasks: aa-bot-agenda-citas-tool

## Back AA
- [x] T1 `agendaListarHandler` + `GET /service/operator/agenda` (rango, exclusión
      de canceladas, 400 en formato inválido). Test: service-operator-agenda (AC1/AC3).
- [x] T2 `agendaHuecosHandler` + `GET /service/operator/agenda/huecos` (huecos de
      30 min por día, 09:00–19:00). Test: service-operator-agenda (AC2).

## mcp-plataforma
- [x] T3 Schemas `listarCitasSchema` / `diasLibresSchema` (rango opcional).
- [x] T4 Handlers `agenciaListarCitas` / `agenciaDiasLibres` + registro de tools
      `agencia_listar_citas` / `agencia_dias_libres` (readOnly). Test: agencia (AC4/AC5).
- [x] T5 Rebuild imagen `mcp-plataforma` + `up -d`. Health OK.

## OpenClaw
- [x] T6 `setup.sh`: `alsoAllow` += `plataforma__agencia_listar_citas`,
      `plataforma__agencia_dias_libres`. Restart gateway. Persistencia verificada.

## Limpieza (enfoque previo equivocado)
- [x] T7 Retirar workflows n8n `listar-citas`/`dias-libres` y los 2 nodos añadidos
      a `mcp-citas`. Borrar cita de prueba en `openclaw_db.citas`.

## Verificación
- [x] T8 tsc limpio (back + mcp). Tests verdes (back 5/5, mcp 30/30).
- [x] T9 Smoke end-to-end vía cadena MCP real (4 citas reales devueltas).
- [ ] T10 Gate de revisión ANTES de commit/push. (Pendiente)
- [ ] T11 Smoke manual del usuario en Telegram ("qué citas tengo esta semana").
