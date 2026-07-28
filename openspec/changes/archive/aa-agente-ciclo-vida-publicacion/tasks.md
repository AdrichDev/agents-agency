# Tasks — `aa-agente-ciclo-vida-publicacion`

Regla del repo: **una tarea es DONE sólo con su test verde.**

Nivel 4. Orden de `design.md §F`: inventario → gate humano → migración → gate de tráfico →
endpoints → recuento → front. El front va **al final**: un botón de despublicar que no corta tráfico
es peor que no tener botón.

## T0 — Inventario previo (sólo lectura, antes de cualquier migración)

- [x] **T0.1** — `back/scripts/inventory-agent-status.ts` + `npm run inventory:agent-status`. Sólo
  lectura. Por cada agente: id, nombre, tenant, canal, nº de conversaciones con `isTest = false`,
  fecha de la primera, widget instalado, estado destino y precondiciones que le faltarían. Resumen
  por estado destino y dos avisos: candidatos a `published` que no cumplirían las precondiciones, y
  candidatos a `draft` con el widget instalado en alguna web.
  *Test:* no automatizable sin BD (mismo caso que `inventory:orphans` de H1 y `measure:cost` de H4);
  `npx tsc --noEmit` verde en `back/`. La verificación es la ejecución contra producción, hecha:

  ```
  Agentes en total: 14   →   published: 6 · draft: 8

  PUBLISHED (siguen sirviendo tras la migración):
    DorsIA              · DorsiaAgent              · 5 conv · publishedAt 2026-06-11
    CoderAI             · EuroFormacIA             · 1 conv · publishedAt 2026-06-11
    CaressIA            · Centro estético Caress   · 2 conv · publishedAt 2026-06-11
    SanBlasIA           · EDM San Blas             · 2 conv · publishedAt 2026-06-11
    VitalIA             · VitalDent                · 3 conv · publishedAt 2026-06-16
    Agente EDM San Blas · EDM San Blas             · 1 conv · publishedAt 2026-07-18

  DRAFT (dejan de responder): AiAs, 3× "CRM EUROFORMACIA" (sin tenant, huérfanos de H1),
    Agente Caress Centro Estético, Agente JorjotasBarber, Agente Wabiks, + 1 más sin tráfico
  ```

  **Ningún agente tiene el widget instalado** (`widgetInstalledAt` vacío en los 14), así que el
  backfill no deja ninguna web de cliente con un snippet muerto. Ese era el peor caso y no se da.
  Tras alinear el script con T0.1b, ningún candidato a `published` incumple las precondiciones
  bloqueantes (los 6 tienen tenant y prompt) ⇒ exit 0, sólo 3 avisos informativos de canal.
- [x] **T0.1b** — *(hallazgo del inventario, no previsto: corrige el diseño)* **3 de los 6 agentes
  que hoy sirven tráfico real tienen `channel = "whatsapp"` sin ninguna conexión de WhatsApp** y
  funcionan igual, por widget/API. La precondición "canal coherente" de la primera versión de
  `design.md §C.4` habría rechazado a la mitad de los agentes vendidos. Confirma empíricamente que
  `channel` es decorativo tras el alta, como dice el esquema. **Degradada de bloqueante a aviso** en
  `design.md §C.4`/§E, `validation.md` AC4, T3.1 y en el propio script (bloqueantes ⇒ exit 2; avisos
  ⇒ informativos).
- [x] **T0.2** — **HUMAN GATE CERRADO** (propietario, 27/07/2026), y con un dato que cambia el
  backfill entero:

  > **Ninguno de los 14 agentes es de un cliente. Todos son pruebas.**

  Por tanto **el backfill es el default de columna y nada más: los 14 a `draft`,
  `publishedAt = NULL`.** El criterio de la v1 (tenant + conversación real ⇒ `published`) queda
  descartado: marcaría facturables y con historia fechada en junio a seis agentes que nadie compró.
  `isTest = false` no significa "un cliente lo usó", significa "se probó desde fuera de la consola",
  que es lo que hace el propio dueño al abrir la URL pública del widget.

  Efectos secundarios de este dato, todos a favor:
  - Desaparece el riesgo que hacía de T1.3 un gate: no hay servicio que interrumpir.
  - Los 3 `CRM EUROFORMACIA` sin tenant y los pares duplicados (Caress, EDM San Blas, Wabiks) dejan
    de ser un problema del backfill: van a `draft` como todo lo demás. Borrarlos sigue siendo una
    limpieza pendiente de H1, no un bloqueo de aquí.
  - **T1, T2 y T3 se despliegan juntos** (`design.md §D`): entre T1 y T3 los agentes quedarían mudos
    para el público y sin botón para reactivarlos. La consola de operador sigue funcionando en medio,
    así que el propietario nunca se queda sin probar.

## T1 — Estado en el esquema (migración aditiva)

- [x] **T1.1** — `Agent`: `status` (`String @default("draft")`), `publishedAt`, `statusChangedAt`.
  Modelo `AgentStatusEvent` nuevo. Sin borrar ni renombrar nada.
  Hecho: schema y migración **escritos**. Se marca aparte de T1.3 a propósito — escribir la
  migración y aplicarla en producción son dos cosas distintas, y juntarlas en una casilla haría
  imposible saber cuál de las dos falta. *Test:* revisión manual del `.sql` en V4.
- [x] **T1.2** — Backfill: **ninguno**. El default de columna (`draft`) es el backfill completo, por
  T0.2 (nada está vendido). Sin `UPDATE`, sin fechas inventadas. Se deja escrito en la migración por
  qué no hay backfill, para que dentro de tres meses nadie lo lea como un olvido.
  *Test:* migración aplicada sobre BD de test con agentes sembrados ⇒ los tres quedan `draft` con
  `publishedAt = NULL`, independientemente de tenant y de conversaciones.
  **Sigue sin marcar a propósito:** la decisión está tomada y escrita en el `.sql`, pero su prueba
  exige aplicar la migración, y aplicar es T1.3. Marcarla ahora diría que se verificó algo que no se
  ha ejecutado. — verificado: `back/prisma/migrations/20260727000000_agent_lifecycle_status/migration.sql:29` (`ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'draft'`, sin UPDATE de relleno); la migración está aplicada en producción según T1.3
- [x] **T1.3** — `prisma migrate deploy` **APLICADO en producción el 27/07/2026** con autorización
  explícita del propietario. Supabase `aws-0-eu-west-3.pooler.supabase.com:5432`, schema `aa`.
  `migrate status` antes: 7 de 9 aplicadas, sin drift, baseline ya resuelto. Después:
  *"Database schema is up to date!"*.
  Se aplicó **antes** del despliegue del código, no en el mismo, y es seguro en ese orden: Prisma
  selecciona columnas explícitas, así que el código que Render sirve hoy ignora `estado`,
  `publicado_en`, `estado_cambiado_en` y la tabla nueva. Los agentes siguen respondiendo. El corte de
  tráfico llega con el deploy del código, y entonces cada agente necesita su Publicar.
  Estado real verificado con `npm run inventory:agent-status` (sólo lectura): los 14 agentes en
  `draft` por el DEFAULT, `publicado_en` nulo en todos, `evento_estado_agente` vacía. Backfill
  NINGUNO, como se especificó.
  **Pendiente asociado (no es esta tarea)**: al desplegar, publicar a mano los 6 con tráfico real
  —DorsIA, CoderAI, CaressIA, SanBlasIA, VitalIA y Agente EDM San Blas— o dejarán de responder por
  su URL pública.

## T2 — Gate de tráfico (el corazón del change)

- [x] **T2.1** — Gate en `runAgent` (`engine.ts:537`), junto a `assertUsageAllowed` y antes de
  construir tools o llamar al LLM. **Publicación primero, saldo después**: un borrador sin cupo dice
  "no publicado", que es lo que hay que arreglar.
  *Test:* `draft` ⇒ error de publicación sin llamar al LLM; `draft` + cupo agotado ⇒ motivo de
  publicación, no de cupo.
- [x] **T2.2** — Exención de la consola de pruebas con el mismo `isTest` de H1, y con la misma
  defensa: sólo se honra con sesión de operador.
  *Test:* `draft` + `isTest` + sesión ⇒ responde. `draft` + `test:true` **sin** sesión ⇒ 403
  (regresión de la defensa documentada en `ai.ts:70-75`).
- [x] **T2.3** — `GET /api/widget/config` de un agente no publicado ⇒ 404. Hoy filtra nombre,
  colores y avatar de cualquier borrador a quien adivine la clave.
  *Test:* `draft` ⇒ 404; `published` ⇒ 200 con la config.
- [x] **T2.4** — `POST /api/widget/ping` **no** cambia: sigue 204 siempre. Es telemetría
  best-effort y ya está diseñado para no confirmar ni negar existencia.
  *Test:* `draft` ⇒ 204 y no lanza.
- [x] **T2.5** — Cortar las vías de servicio sin LLM para agentes no publicados
  (`/api/leads/kickoff`, `/api/booking/reserve`, `/api/booking/slots`). Cierra, **sólo para el estado
  del agente**, el agujero que H1 dejó abierto y H4 anotó como deuda; que el impago del tenant corte
  esas mismas rutas sigue siendo de H4.
  **Corrección sobre la spec inicial:** `/api/public/leads` **no** entra. Se leyó
  `routes/public.ts` y crea un `LandingLead` del formulario de la landing de 3A Estudio: no recibe
  `agentId` ni el modelo lo tiene, así que no hay estado de agente que comprobar. En su lugar entra
  `/api/booking/slots`, que la spec no listaba y sí revela servicios y horarios del negocio.
  *Test:* un `draft` no acepta reserva, ni expone slots, ni acepta kickoff; un `published` sí.
- [x] **T2.6** — *(añadida en V5, no estaba en la spec)* `POST /service/telegram/send`, el respondedor
  manual del CRM, también pasa por el gate. T2.5 cerró las vías sin LLM que **meten** datos y dejó
  abierta una que **saca** mensajes: esta ruta manda un Telegram real a una persona en nombre del
  agente, así que un agente suspendido por impago seguía teniendo voz. Se usa la exención acotada de
  la consola (`isTest`: hay un humano del CRM escribiendo, no el agente atendiendo solo) ⇒ `draft`
  pasa, `suspended` y `archived` no. Y el `catch` genérico de la ruta deja pasar el `HttpError`: sin
  eso el corte por estado llegaría al CRM como un 500 "No se pudo enviar el mensaje".
  *Test:* `service-telegram-publication-gate.test.ts` — `suspended` ⇒ 402 sin llamar a `sendMessage`,
  `archived` ⇒ 403, estado desconocido ⇒ 403 (fail-closed), `draft`/`published` ⇒ 200, y un test
  específico de que el corte **no** se presenta como 500.

## T3 — Acciones de publicación

- [x] **T3.1** — `POST /api/agents/:id/publish` con las precondiciones de `design.md §C.4`.
  Bloqueantes: tenant y prompt no vacío ⇒ 400 enumerando lo que falta. Canal de mensajería sin
  conexión: **aviso en la respuesta, no bloqueo** (T0.1b: 3 agentes en producción lo incumplen y
  sirven igual).
  *Test:* sin tenant ⇒ 400; sin prompt ⇒ 400; `channel = "whatsapp"` sin conexión ⇒ **200 con aviso**
  y `status = published`; completo ⇒ 200 sin avisos.
- [x] **T3.2** — `POST /api/agents/:id/unpublish` ⇒ vuelve a `draft`. No a `suspended`: eso es de la
  plataforma, no del propietario.
  *Test:* `published` ⇒ `draft`, y deja de atender tráfico real.
- [x] **T3.3** — Idempotencia: publicar dos veces no duplica evento ni pisa `publishedAt`.
  *Test:* dos POST seguidos ⇒ un solo evento nuevo, `publishedAt` intacto.
- [x] **T3.4** — El `PATCH /:id` general **no** toca `status`. Guardar un formulario no puede
  facturar.
  *Test:* `PATCH` con `status` en el body ⇒ se ignora o 400; el estado no cambia.
- [x] **T3.5** — `AgentStatusEvent` en cada transición, con `from`, `to` y actor.
  *Test:* publicar → despublicar → publicar deja tres eventos con las transiciones correctas.
- [x] **T3.6** — `archived`: retirada de un agente que estuvo publicado, en vez de hard delete.
  `deleteAgent` (`service.ts:729`) se queda para borradores.
  *Test:* borrar un agente que estuvo publicado ⇒ rechazado con indicación de archivar; borrar un
  `draft` ⇒ sigue funcionando igual que hoy.

## T4 — Recuento facturable (contrato para H4)

- [x] **T4.1** — `countBillableAgents(tenantId)` ⇒ `published` + `suspended`. **Derivado**, sin
  contador materializado en `Tenant`.
  *Test:* tenant con 1 published + 1 suspended + 2 draft + 1 archived ⇒ 2.

## T5 — Front

- [x] **T5.1** — `DeployPanel`: banda de estado (primera tarjeta: lo de abajo sólo responde si está
  publicado, así que enterarse al final sería enterarse tarde), botón Publicar/Despublicar con
  confirmación, y las precondiciones que faltan escritas en claro. Snippet y `curl` siguen visibles,
  con aviso de que no responden hasta publicar — ocultarlos impediría preparar la instalación antes
  de vender.
  **Añadido al alcance, y es lo que evita el bug de verdad:** las precondiciones las calcula el
  **back** y viajan en `GET /api/agents/:id` (`publishPreconditions`), con la MISMA función que
  decide el 400 de `POST /:id/publish`. Reimplementar la regla en el front serían dos copias de una
  regla, y dos copias discrepan: la interfaz diría "puedes publicar" y el back lo rechazaría.
  Sólo `draft` ⇄ `published` se cambia desde aquí: `suspended` lo pone la plataforma y `archived` es
  una retirada.
  *Test:* `tests/agent-detail-publish-preconditions.test.ts` (5) — completo ⇒ sin bloqueantes;
  sin tenant y sin prompt ⇒ los dos enumerados; `whatsapp` sin conexión ⇒ aviso y **no** bloqueo;
  con conexión ⇒ limpio; y la query pide `channelConnections` (sin ese select el aviso sería siempre
  falso).
- [x] **T5.2** — `AgentsGrid`: chip de estado del agente. **Y el bug**: el campo que devuelve el back
  es `tenant` (`service.ts:53`), no `client` — `AgentRow.client` (`:24`) es siempre `undefined`, así
  que el switch nunca se pintó, "Cliente: X" nunca se pintó y la búsqueda por nombre de cliente
  (`:93`) nunca casó. Se corrige el nombre **y** se saca el `TokenSwitch` de la tarjeta de agente:
  apaga el tenant, no el agente, y ahora hay un apagado propio del agente que es el que corresponde
  aquí.
  **Corrección: «el kill switch del tenant se queda en `/clients`» era falso.** No existe `/clients`
  (la ruta es `/clientes`) y `TokenSwitch.tsx` no estaba importado en ninguna otra parte, así que
  sacarlo de la tarjeta lo dejó huérfano. La capacidad no se pierde —apagar un tenant es la casilla
  `isActive` de `components/clientes/ClientModal.tsx:121`, que guarda por el mismo
  `PATCH /api/clients/:id/credits`— y se **borra** el componente huérfano: un control muerto que
  apaga un tenant es una invitación a volver a montarlo en una pantalla de agente.
  *Test:* front `npx tsc --noEmit` EXIT=0 y `npm run build` OK — que es lo único automatizable aquí:
  el front no tiene infraestructura de test de componentes (no hay `@testing-library`, ni runner de
  front). Que la tarjeta muestre estado + nombre de cliente y que no quede switch de tenant se
  comprueba a ojo en **V6**, y así queda dicho en vez de dar el typecheck por prueba de la UI.
- [x] **T5.3** — Wizard: al terminar, el agente queda en `draft` (`schema.prisma:165`,
  `@default("draft")` — el alta no lo escribe) y se dice explícitamente que aún no está publicado,
  con el enlace a publicarlo.
  **Corrección de la premisa al implementarlo:** el wizard tiene DOS salidas, no una. Sólo la de
  `runtime = "openclaw"` termina en pantalla final (`PostCreatePanel`); la salida normal redirige
  directo a `/agents/:id?tab=integraciones`, así que "la pantalla final" no existía para la mayoría
  de las altas. Se cubren las dos:
  - `PostCreatePanel`: aviso de "aún no está publicado" + botón **Publicarlo →** a
    `?tab=implementacion` (donde vive la banda de T5.1).
  - Página del agente: `AgentStatusChip` en la cabecera —el estado no puede vivir dentro de una
    pestaña— y aviso de borrador con botón a Implementación, para cualquier borrador y no sólo
    justo tras crearlo.
  - Fuera el `&nuevo=1` del redirect: nadie leía ese flag (era el único intento previo de decir
    "esto acaba de nacer"), verificado por búsqueda en todo el front.
  **Y el mismo bug de T5.2, en la página de detalle:** `agent.client` (línea 108) también era
  siempre `undefined` — el back devuelve `tenant`. "Cliente: X" nunca se pintó tampoco aquí.
  *Test:* front `npx tsc --noEmit` EXIT=0 y `npm run build` OK (V3). La comprobación visual va en V6.

## Deuda anotada, fuera de alcance

- **Hueco de despublicar antes del corte**: contar por foto al cierre permite despublicar el día
  antes y republicar después. Se acepta en v1; `AgentStatusEvent` (T3.5) es lo que permitirá cerrarlo
  con datos en vez de con una regla inventada. Decisión de H4/H6.
- **El impago del tenant sigue sin cortar las vías sin LLM**: T2.5 lo cierra para el estado del
  agente, no para el kill switch de tenant. Sigue siendo deuda de H4.
- **Fase 2 de H1** (`Agent.tenantId` → `NOT NULL`): T3.1 exige tenant para publicar, que cubre el
  caso que importa, pero la columna sigue siendo opcional. Change aparte.
- **`suspended` no tiene todavía quién lo ponga**: el estado existe y el recuento lo cuenta, pero
  quien lo escribe es H4/H6 al resolver impago. Aquí sólo se deja el hueco, igual que H4 dejó el
  hueco de BYOK.
- **Un borrador sigue emitiendo mensajes de cortesía por los webhooks.** Se revisó
  `whatsapp-webhook.ts:88-132` y `telegram-webhook.ts`: con el agente no publicado, el gate corta
  ANTES del LLM, pero la rama de error responde al usuario con `channelErrorMessage(e)`. O sea: no
  hay llamada al modelo, no se filtran datos del negocio y no se compromete nada — pero el número
  del bot contesta. Gatearlo cambiaría **qué frase** manda, no si manda; por eso no se toca aquí. Lo
  correcto sería silencio del canal mientras el agente no esté publicado, y eso es decisión de
  producto (un visitante que escribe y no recibe NADA también es una experiencia) que no cabe en este
  change. El emparejamiento `/start` de Telegram sí debe seguir funcionando en `draft`: el canal se
  conecta ANTES de publicar, y exigir publicación para emparejar invertiría el orden del flujo.
- **`POST /api/widget/ping` sella `widgetInstalledAt` de un borrador.** T2.4 decidió a propósito que
  el ping no cambia (sigue 204 siempre, no confirma ni niega existencia), pero el efecto colateral es
  que un borrador queda marcado como «instalado» en una web. No rompe nada —el chat sí está cortado—
  y de hecho el inventario usa esa fecha como señal útil; queda anotado para que nadie lea
  `widgetInstalledAt` como prueba de que un agente estuvo sirviendo.
- **Superficies de operador de reservas** (`booking.ts:137-367`): están detrás de sesión, así que no
  son tráfico público, pero `reschedule` escribe en Google Calendar de un agente no publicado. Es
  gestión del negocio, no servicio del agente, y por eso quedó fuera de T2.5; si algún día el portal
  de cliente (H5) expone esas rutas al tenant, hay que revisarlo.

## Verificaciones finales

- [x] **V1** — `npx tsc --noEmit` verde en `back/` (ejecutar **dentro** de `back/`; desde la raíz
  falla). EXIT=0.
- [x] **V2** — `npm test` verde en `back/`, sin skips nuevos. Línea base de partida: 104 ficheros,
  1072 pasan, 3 skipped. **Resultado final: 111 ficheros, 1156 pasan, 3 skipped, 0 fallos** (+7
  ficheros y +84 tests de H3; los 3 skips son los mismos de antes). La medición intermedia de V5
  daba 110/1148: los +1 fichero y +8 tests son los arreglos que salieron de esa propia revisión
  (`service-telegram-publication-gate.test.ts`, 6 tests, más 2 en `agent-publish-routes.test.ts`).
  Las 35 caídas intermedias fueron fixtures viejas que servían tráfico sin declarar estado: se
  arreglaron **declarando el estado en la fixture**, nunca debilitando el gate. Una fixture que cae
  es la prueba de que el gate funciona.
- [x] **V3** — Typecheck y build del front. `npx tsc --noEmit` EXIT=0 y `npm run build` completo
  (30 rutas, `/agents/[id]` dinámica como antes).
- [x] **V4** — Migración revisada a mano antes de aplicar: aditiva, **sin backfill** (T0.2) y sin
  `DROP`. La ausencia de `UPDATE` es parte de lo que se revisa, no un olvido: está justificada en el
  propio `.sql`.
  Revisado `back/prisma/migrations/20260727000000_agent_lifecycle_status/migration.sql`:
  - 3 `ADD COLUMN` sobre `agente`, 1 `CREATE TABLE evento_estado_agente`, 1 índice
    `(agente_id, creado_en)`, 1 FK. **Cero `DROP`, cero `UPDATE`, cero cambios en columnas
    existentes.** Nada que reescribir: `ADD COLUMN NOT NULL DEFAULT` es metadata-only en Postgres 11+.
  - Nombres físicos cuadran con los `@map` del schema (`estado`, `publicado_en`,
    `estado_cambiado_en`, `evento_estado_agente` con `desde`/`hasta`/`actor`/`motivo`/`creado_en`) y
    el `@@index([agentId, createdAt])` coincide con el índice creado ⇒ no deja drift.
  - Anotado y aceptado: la FK es `ON DELETE CASCADE`, así que borrar un agente se lleva sus eventos.
    No abre agujero: T3.6 prohíbe borrar un agente que estuvo publicado (mira `publishedAt`), que es
    el único caso en que el rastro hace falta para una factura.
  - **Sigue SIN aplicar**: eso es T1.3, gate humano, y en el mismo despliegue que T2 y T3.
- [x] **V5** — `sdd-verify` antes de proponer commit. **Veredicto: PASS-WITH-WARNINGS** — 0 CRITICAL,
  7 WARNING, 5 SUGGESTION. Confirmó por su cuenta los números de V2 y, lo que más importa,
  `git diff --stat back/tests/` = **+65 / −0**: ni una línea de test borrada, así que el verde no se
  compró debilitando pruebas.
  Lo que salió de ahí y se arregló (con test cada uno):
  - **Un hueco real de gate**: `POST /service/telegram/send`, el respondedor manual del CRM, mandaba
    un Telegram en nombre del agente sin mirar su estado. T2.5 cerró las vías que METEN datos y se
    dejó una que SACA mensajes. Ahora pasa por `assertAgentServableById` con la misma exención
    acotada que la consola (`isTest`: hay un humano detrás), y el `catch` genérico deja pasar el
    `HttpError` — si no, el 402 llegaría al CRM como un 500 "No se pudo enviar" y quien lo lea
    buscaría un fallo de red en vez de leer "agente suspendido".
  - **`POST /:id/archive` sobre un `suspended` ⇒ 409**: archivar saca al agente de
    `countBillableAgents`, así que sin este guardarraíl archivar era la salida de emergencia de la
    factura. `suspended` factura a propósito (está vendido y sólo callado por impago).
  - **`POST /:id/publish` sobre un `archived` pasa, y ahora está escrito por qué**: publicar ES la
    restauración. Rechazarlo dejaría `archived` sin salida que no fuera editar la BD a mano. Las
    precondiciones se comprueban igual y el evento queda fechado `archived→published`.
  Lo que se revisó y se **rechazó** con el código delante, no por pereza: gatear la respuesta de
  cortesía de los webhooks (cambia qué frase manda, no si manda ⇒ deuda anotada) y gatear el
  emparejamiento `/start` de Telegram (el canal se conecta antes de publicar; exigirlo invertiría el
  flujo). Las contradicciones de artefacto que señaló están corregidas arriba: el criterio muerto en
  `inventory-agent-status.ts`, "con backfill" en `validation.md`, `/api/public/leads` en T2.5,
  `/api/ai/widget/*` por `/api/widget/*`, y el falso "se queda en `/clients`" de T5.2.
- [ ] **V6** — Comprobación posterior al despliegue: los 14 agentes quedan `draft`, responden desde
  la consola de operador, y responden por URL pública **sólo** tras pulsar Publicar. Ésa es la prueba
  de que el estado hace algo y no es una etiqueta.

  **PARCIAL (27/07/2026, tras desplegar `25299eb` en Render).** La mitad que no necesita decidir nada
  ya está comprobada contra producción, no contra un mock. `prisma migrate status` → 14/14, esquema al
  día, así que no hay desfase código↔BD. Inventario real: **14 agentes, los 14 `draft`** (3 de ellos
  sin tenant), tal como quedó T0.2. Contra `POST /api/chat` en producción:

  | Caso | Esperado | Real |
  |---|---|---|
  | `draft` con tenant sano (`cmq9m0o4k0001n8fxmave9sr4`, AiAs) | 403 no publicado | **403** `Este asistente todavía no está publicado.` |
  | `draft` sin tenant (`cmr5cu05700006gfxv96nde6a`) | 403 | **403** — el gate de ciclo de vida corta **antes** que el fail-closed de H1 |
  | `test: true` **sin** sesión de operador | 403, sin eximir | **403** — el filtro `Boolean(test) && Boolean(req.user)` de `ai.ts:76` aguanta en producción |

  El tercer caso es el que importaba de verdad: si `test` eximiera sin sesión, cualquiera con una
  `publicKey` consumiría saltándose cupo y kill switch. No exime.

  **Lo que falta y por qué no lo he hecho solo:** las dos mitades restantes ("responde desde la
  consola" y "responde por URL pública tras Publicar") exigen (a) decidir **qué** agentes se publican
  —es una decisión de negocio, no técnica— y (b) una sesión de operador de AA. Además el smoke gasta
  tokens de la clave de plataforma. Pendiente de gate humano. — ⏳ GATE HUMANO: decidir qué agentes se publican (decisión de negocio) y hacerlo desde una sesión de operador de AA

## Orden crítico

```
T0.1 ✅ → T0.2 ✅ (todos a draft) → T1.1/T1.2 → T2 (gate de tráfico) → T3 (acciones)
  → [T1.3 HUMAN GATE: migrar + desplegar T1+T2+T3 JUNTOS] → T4 (recuento) → T5 (front)
  → desbloquea H4/T4 (modelo Plan)
```

T2 antes de T5, sin excepción: el botón se pinta cuando el estado ya corta de verdad.

T1+T2+T3 en un solo despliegue: migrar sin las acciones de publicación deja 14 agentes mudos y sin
botón para revivirlos. Con cero clientes no es un incidente, pero no hay razón para pasar por ahí.

## Cierre — 28/07/2026

Cierre con una única decisión humana pendiente (V6: qué agentes publicar). El código del ciclo de vida y su migración están verificados y aplicados.
