# Validation — aa-automatizacion-nl-estado-n8n

## User story

Como operador, quiero que la sección de automatizaciones me diga la verdad sobre qué se
ejecuta y qué no cuando n8n está apagado, y que no pierda en silencio un workflow importado,
para no creer que algo funciona cuando no va.

## Acceptance criteria

- **AC1**: Con n8n apagado, importar un workflow JSON **falla honesto** (503 con mensaje
  claro) y **no** crea una fila de automatización inerte ni pierde el JSON en silencio
  (paridad con el import por ID). El front bloquea el submit del import.
- **AC2**: El banner/nota deja de sugerir "todo bien por motor interno": dice qué corre
  (email/Slack/programadas vía motor interno, sondeo ~5 min, requiere integración conectada)
  y qué no (workflows importados requieren n8n).
- **AC3**: Cada automatización muestra un estado honesto: importada con n8n off →
  "requiere n8n (apagado)" (no se ejecutará); NL pendiente → "motor interno" con estado real
  por `lastRunAt`. Distinta una que corre de una guardada-sin-ejecutar.
- **AC4**: Donde se elige el intervalo, se aclara que el motor interno revisa ~cada 5 min y
  que el intervalo exacto solo aplica con n8n.
- **AC5 (regresión cero)**: el cron interno sigue ejecutando las automatizaciones NL
  (email/slack/schedule) con n8n off; la creación NL y las automatizaciones existentes no
  cambian de comportamiento.

## Given-When-Then

**Escenario 1 (AC1 — no pérdida silenciosa):**
Given n8n apagado
When intento importar un workflow pegando su JSON
Then recibo un 503 claro y NO se crea ninguna automatización (no se pierde nada en una fila
inerte); el botón de importar está deshabilitado con el motivo.

**Escenario 2 (AC3 — estado honesto):**
Given una automatización NL (schedule) guardada con n8n off que aún no ha corrido
When abro la lista
Then veo "motor interno · sin ejecutar aún" (no un "OK" que sugiera que ya funcionó); y una
importada previa se ve como "requiere n8n (apagado)".

**Escenario 3 (AC5 — regresión):**
Given una automatización NL de email con la integración conectada y n8n off
When corre el cron interno
Then se ejecuta vía runAgent como hoy (sin cambios).

## Test por tarea
- T1.1 → JSON import con n8n off → 503, create NO llamado; n8n on → regresión.
- T1.2/T2.*/T3.1/T4.1 → `front tsc` verde; import bloqueado; banner/nota/badges honestos.

Regla del repo: DONE con test verde (+ HITL visual en el front sin harness de componentes).
