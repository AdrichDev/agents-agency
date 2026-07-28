# Tasks: aa-espejo-movil-operador-telegram

## Fase A — Reproducción
- [x] A.1 Smoke test `chatSend` ejecutado contra la sesión operador real (`agent:main:main`).
- [x] A.2 Confirmado: NO hay espejo automático. El turno del operador no lleva marca
      `openclawDeliveryMirror`/`telegram-final:*` y no hay actividad Telegram en logs del
      contenedor tras el turno.

## Fase B — Fix (espejo COMPLETO de la conversación web → Telegram)
- [x] B.1 El RPC hipotético `message send --channel telegram` **no existe**: leído el
      allowlist real del plugin `admin-http-rpc` dentro del contenedor
      (`/app/extensions/admin-http-rpc/src/methods.ts`) — grupo `channels` solo expone
      `status/start/stop/logout`. Además `config.get` redacta el `botToken`
      (`__OPENCLAW_REDACTED__`), así que tampoco es extraíble por ahí.
      Vía única: llamar **directo a la Bot API de Telegram** (helper
      `sendMessage` de `lib/channels/telegram.ts`), con credenciales propias de AA
      (`OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN` + `OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID`).
- [x] B.2 **Espejo de la conversación entera** (corrige el intento previo, que solo
      reflejaba el turno del operador con el prefijo textual "🖥️ Operador:", rechazado
      por el usuario). Implementado en `operator-chat.ts`, disparado SOLO desde
      `POST /send` (turnos de origen web):
      - **Turno del operador**: se espeja de inmediato (awaited, fail-soft) con un
        distintivo discreto `✍️` — SIN la palabra "Operador" ni clutter. Necesario
        porque ambos lados salen del mismo bot y Telegram no distingue remitentes.
      - **Respuesta del asistente**: también se espeja, en limpio (como la vería un
        usuario nativo de Telegram). Mecanismo: fast-path si el payload de
        `chat.completions` ya trae la respuesta (`choices[0].message.content`); si no,
        sondeo en background contra `chatHistory` (snapshot de ids assistant ANTES de
        enviar → se detecta el turno NUEVO), sin bloquear el 202. Parámetros de sondeo
        configurables por env (`OPENCLAW_OPERATOR_MIRROR_ATTEMPTS`/`_DELAY_MS`).
      - **Dedup (crítico)**: el espejo NO se dispara para turnos que entran POR Telegram
        (esos ya llegan nativos y nunca pasan por `/send`). No hace falta inspeccionar
        marcas `openclawDeliveryMirror`: al gatillar solo desde `/send`, es imposible
        duplicar un turno de origen Telegram.
      - **Fail-soft**: cualquier fallo de Telegram se loguea y se traga; nunca rompe la
        respuesta al operador ni el polling de `/history`.
- [x] B.3 Tests en `operator-chat.test.ts`: turno operador espejado sin "Operador",
      respuesta assistant espejada en limpio, dedup por id (no reenvía conocido),
      delivery-mirror nunca espejado (fixture `MIXED_ENTRIES`), fail-soft, y noop sin
      env. Suite completa: **60 archivos / 646 tests verdes / 3 skipped**.

## Fase C — Verificación
- [x] C.1 Smoke real (script temporal `scripts/_smoke-operator-mirror.ts`, ya borrado):
      contra el bot real `@Estudio3ABot` con las env de `.env`, entregó SIN excepción
      (a) el turno del operador `✍️ ...` (sin "Operador") y (b) la respuesta del
      asistente en limpio → confirmada la conversación completa en Telegram.
- [x] C.2 Marcado 5.5d en `aa-centro-mando-agenda-telegram/tasks.md`.

## Tras verde: gate Agentic Runtime (revisión) ANTES de cualquier commit/push.

**Pendiente para el usuario antes de producción:** añadir a `agents-agency/back/.env`
`OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN` y `OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID`
(valores ya confirmados en vivo durante el smoke, no impresos en este archivo).

**CERRADO y archivado el 28/07/2026, con una deuda que sale del change y no debe perderse.**

El cambio se archiva con su suite **entera en verde**, cosa que no era cierta hasta hoy. Los 3
rojos de `front/tests/telegram-widget.spec.ts` que arrastraba **no eran fallos de este cambio ni de
ningún otro**: eran expectativas caducas. Diagnóstico y arreglo en `b85c7ea`.

1. El chip flotante sólo se monta con el panel cerrado (`TelegramWidget.tsx:271`, decisión
   deliberada y comentada: el panel ya expone su X). Tres tests lo clicaban para **cerrar**,
   esperando 30 s un nodo desmontado. Reproducido con `--workers=1`: no era intermitencia.
2. Al arreglar lo anterior salió una segunda causa que nunca se había llegado a ejecutar: el
   polling nace apagado por el kill-switch de egress (`useTelegramInbox.ts:52`), así que la ruta
   re-registrada a mitad de test no llegaba jamás y el badge se quedaba en `1` esperando `2`.
   `NEXT_PUBLIC_*` se inlinea en build ⇒ se enciende en el `webServer` de `playwright.config.ts`.

Suite completa tras el arreglo: **119/119**, `tsc --noEmit` EXIT=0. Cero código de producto tocado.

**DEUDA VIVA — no la cierra este archivado.** Las dos variables de arriba siguen sin confirmar en el
entorno de producción (Render). Sin ellas el espejo es *fail-soft*: no rompe nada, simplemente **no
espeja**, y eso es indistinguible de "funciona" desde fuera. Verificar en Render antes de dar el
espejo por vivo en producción.
