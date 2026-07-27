# Design — `aa-agente-ciclo-vida-publicacion`

## §A. Principio

**Un agente no se despliega: se activa.** No hay artefacto que subir, no hay runtime que arrancar,
no hay Cloudflare. Un agente es una fila en la BD del único `aa-back` de Render. Por eso "publicar"
no puede ser un proceso de infraestructura: tiene que ser **un cambio de estado con consecuencias
verificables**.

Y de ahí el criterio que gobierna todo el diseño: **si el estado no cambia el comportamiento
observable, no es un estado, es una etiqueta.** Un `isPublished` que nadie comprueba es peor que no
tener nada, porque da la falsa sensación de control y encima se factura.

Corolario del lado del cobro, heredado de H1 (*"lo que no es cobrable, no es servible"*): aquí la
recíproca. **Lo que no está publicado, no se sirve; y lo que no se sirve, no se factura.** Las dos
direcciones tienen que ser ciertas, o el estado miente en una de ellas.

## §B. Lo que hay hoy (verificado, no supuesto)

| Hecho | Evidencia |
|---|---|
| La clave pública nace con el agente | `schema.prisma:154` — `@unique @default(cuid())` |
| No hay campo de estado | `schema.prisma:133-165`, modelo `Agent` completo |
| `channel` no es estado | mismo fichero: *"INFORMATIVO tras la creación"*, `widget` vs `api` sin ramas |
| Lo más parecido a "activo" es telemetría | `widgetInstalledAt`/`widgetLastSeenAt`, sellados por un ping best-effort del widget (`ai.ts:141-163`, 204 incluso para claves desconocidas) |
| El cuello único de tráfico ya existe | `engine.ts:537`, `assertUsageAllowed(agent.tenantId, { isTest })` |
| El chat público resuelve el agente por clave y responde | `ai.ts:59-64` |
| La config del widget se sirve sin comprobar nada | `ai.ts:99-111` |
| El único apagado existente es del tenant | `TokenSwitch` → `PATCH /api/clients/:id/credits` |

**Por qué `widgetInstalledAt` no sirve como "activo":** es un ping best-effort desde el navegador
del visitante. Se puede falsear con un `curl`, no llega si el cliente instala el snippet y nadie
visita la web, y no distingue "instalado" de "quiero pagar por esto". Facturar contra telemetría de
terceros es facturar contra algo que no controlas.

## §C. Diseño

### C.1 Estado del agente *(con migración)*

```prisma
status        String    @default("draft") @map("estado")
// draft | published | suspended | archived
publishedAt   DateTime? @map("publicado_en")     // primera publicación (no se pisa)
statusChangedAt DateTime? @map("estado_cambiado_en")
```

Cuatro estados, y cada uno se justifica por un comportamiento distinto — no por gusto de taxonomía:

| Estado | Sirve tráfico | Se factura | Quién lo pone |
|---|---|---|---|
| `draft` | no (salvo consola de pruebas) | no | al crear, o el propietario al despublicar |
| `published` | sí | sí | el propietario, con acción explícita |
| `suspended` | no | **sí** | la plataforma (impago) |
| `archived` | no | no | el propietario, en vez de borrar |

**Por qué enum y no un booleano.** `suspended` y `draft` apagan igual el agente pero significan lo
contrario para la factura: al suspendido se le sigue cobrando el periodo (o se le corta el servicio
por no pagar, que es lo mismo visto del revés), al borrador no. Un booleano obliga a inferir la
causa desde otro sitio, y ese es exactamente el error que `aa-planes-y-cuotas` T1 tuvo que deshacer:
`Tenant.isActive` significaba a la vez "paga" y "tiene cupo", y agotar el cupo suspendía al cliente
de rebote — con el efecto colateral de que no se le podía dar de baja.

**Por qué `archived` y no borrar.** El hard delete de un agente facturado destruye la base de la
factura. `deleteAgent` (`service.ts:729`) existe y se queda para borradores; un agente que estuvo
publicado se archiva.

**Dos desvíos respecto al boceto del eje** (`aa-agentes-entrega-monetizacion/tasks.md`), a propósito:

1. **Se cae el estado `probado`.** El boceto proponía `borrador → probado → publicado → suspendido`.
   "Probado" no es un estado: es un hecho, y además ya está registrado —`Conversation.isTest`
   contesta "¿ha tenido conversaciones de prueba?" sin necesidad de una columna. Por §A, un estado
   que no cambia el comportamiento observable es una etiqueta.
2. **Publicar no exige haber pasado por la consola de pruebas.** El boceto lo pedía. Se cae porque un
   "hola" en la consola lo satisface: sería fricción real a cambio de garantía falsa. Las
   precondiciones que se mantienen (§C.4) son las que **rompen algo** si faltan: sin tenant no hay a
   quién cobrar y sin prompt no hay agente. La coherencia de canal se quedó fuera de las bloqueantes
   al medirla contra producción (T0.1b): es aviso, no muro.

**Por qué `String` y no `enum` de Prisma.** El repo ya usa `String` con comentario para
`runtime`, `channel` y `reasoningEffort`. Un `enum` nativo obliga a migración de tipo para cada
estado nuevo en Postgres. Se valida con Zod en el borde, que es donde importa.

### C.2 El gate, en el cuello que ya existe

`runAgent` (`engine.ts:537`) es el único punto por el que pasa todo el tráfico de todos los canales
— H1 lo estableció y esa decisión se reutiliza tal cual. El gate de publicación va **junto** al de
saldo, en la misma query que ya lee el agente, y **antes** de construir tools o llamar al LLM.

Orden de comprobación y por qué importa: **primero publicación, después saldo.** Un borrador que
además tiene el cupo agotado debe decir "no publicado", porque es lo que el operador tiene que
arreglar; decirle "sin cupo" le manda a recargar crédito que no necesita.

**Exención de la consola de pruebas.** El mismo `isTest` que ya exime del gate de saldo exime del de
publicación, y con la misma cautela de seguridad que documenta `ai.ts:70-75`: `isTest` **sólo** se
honra con sesión de operador (`Boolean(test) && Boolean(req.user)`), porque `/api/chat` es ruta
pública. Sin ese filtro, cualquiera mandaría `test:true` con una clave pública y hablaría con
borradores ajenos. La exención no es una comodidad: sin ella el estado sería un estorbo — no podrías
probar un agente antes de publicarlo, y publicarías a ciegas.

### C.3 Qué más calla, y qué no

El gate en `runAgent` cubre el LLM. Pero hay superficie pública que no pasa por ahí, y hay que
decidir explícitamente en vez de heredar el agujero de H1:

| Superficie | Con el agente no publicado | Por qué |
|---|---|---|
| `POST /api/chat` | 403 con motivo claro | es el tráfico |
| `GET /api/widget/config` | 404 | hoy filtra nombre, colores y avatar de un borrador a cualquiera que adivine la clave |
| `POST /api/widget/ping` | sigue 204 | telemetría best-effort; ya devuelve 204 para claves desconocidas y no debe confirmar ni negar existencia |
| `/api/leads/kickoff`, `/api/booking/reserve`, `/api/booking/slots` | **se decide aquí: sí cortan** | son servicio del agente. Un borrador que acepta reservas es un borrador en producción |
| `POST /api/public/leads` | **no cambia** | corregido al implementar T2.5: es el formulario de la landing de 3A Estudio (`routes/public.ts`), no recibe `agentId` y `LandingLead` no lo tiene. No hay estado de agente que comprobar. Su hueco lo ocupa `/api/booking/slots`, que sí filtra servicios y horarios |
| Consola de pruebas del operador | funciona | C.2 |

El tercer bloque es el que H1 dejó abierto para el kill switch de tenant y H4 anotó como deuda. Se
cierra aquí para el estado del agente. Que el **impago** del tenant corte esas mismas vías sigue
siendo deuda de H4: son dos gates distintos sobre el mismo tramo, y este change no puede resolver el
otro sin el modelo `Plan`.

### C.4 Acciones, no efectos colaterales

`POST /api/agents/:id/publish` y `POST /api/agents/:id/unpublish`, no un campo más en el `PATCH`
general (`agents.ts:138`). Razón: publicar tiene precondiciones y consecuencia económica; guardar un
formulario no. Meterlo en el `PATCH` hace que cualquier guardado pueda facturar sin querer.

**Precondiciones BLOQUEANTES para publicar** (fail-closed: si falta, 400 con lo que falta):

1. `tenantId` presente. Sin tenant no hay a quién cobrar — y es la fase 2 de H1 vista desde otro
   ángulo: en vez de un `NOT NULL` global que rompe los huérfanos, la publicación lo exige donde
   importa.
2. `systemPrompt` no vacío. Sin prompt no hay agente.

**Aviso NO bloqueante:** `channel` es `telegram`/`whatsapp` y no hay conexión de mensajería.

> **Esta regla era bloqueante en la primera versión de este diseño, y el inventario de T0.1 la
> tumbó.** De los 6 agentes que hoy sirven tráfico real en producción, **3 tienen
> `channel = "whatsapp"` sin ninguna conexión de WhatsApp** (DorsIA, CoderAI y Agente EDM San Blas), y
> funcionan perfectamente: atienden por widget/API con su clave pública. Es la confirmación empírica
> de lo que el propio esquema documenta —`channel` es *informativo* tras el alta y sólo gatea la
> visibilidad de `ChannelConnectPanel`—, así que bloquear la publicación por ese campo sería inventar
> una regla que el código no tiene y rechazar a la mitad de los agentes que ya están vendidos.
> Se queda como aviso porque sí hay un riesgo real de negocio distinto: si vendes un "agente de
> WhatsApp" sin conexión, el cliente no recibe lo que compró. Eso se dice, no se impide.

La lección del método, que vale más que la regla: **el inventario iba primero por el backfill, y ha
servido para corregir el diseño antes de escribir una línea de código.**

`suspended` y `archived` no se ponen por estos endpoints: `suspended` es de la plataforma (H4/H6, al
resolver impago) y `archived` es una acción de retirada aparte.

### C.5 Rastro de cambios de estado

```prisma
model AgentStatusEvent {
  id        String   @id @default(cuid())
  agentId   String   @map("agente_id")
  from      String?  @map("desde")
  to        String   @map("hasta")
  actor     String?  // userId, o "system"
  createdAt DateTime @default(now()) @map("creado_en")
  @@map("evento_estado_agente")
}
```

No es auditoría por completismo: es la **base de la factura**. Cuando H4 cobre por agente publicado,
la pregunta "¿este agente estuvo publicado en junio?" tiene que tener respuesta, y el campo `status`
sólo sabe el ahora. También es lo que permitirá cerrar con datos el hueco de "despublicar antes del
corte" (`proposal.md`, Riesgos) en vez de inventar una regla anti-abuso a ciegas.

### C.6 Recuento facturable (lo que H4 consumirá)

Una función, un contrato, sin lógica de precio:

```ts
countBillableAgents(tenantId: string): Promise<number>   // status in (published, suspended)
```

Se **deriva** de `status`; no hay contador materializado en `Tenant`. Un contador se desincroniza y
entonces la factura y la realidad discrepan sin que nadie se entere. `uso_tokens` tiene la misma
regla en H4: la fuente de verdad no se duplica.

`suspended` cuenta como facturable a propósito: suspender por impago no perdona el periodo. Si
resulta que el negocio lo quiere de otra forma, se cambia en H4 — la decisión de precio es de allí,
lo de aquí es que el dato exista con la distinción hecha.

### C.7 Front

- **Ficha del agente** (`DeployPanel.tsx`): banda de estado arriba, botón Publicar / Despublicar, y
  las precondiciones que faltan escritas en claro. El snippet y el `curl` de la API se muestran
  siempre —son informativos— pero con aviso de que no responderán hasta publicar. Ocultarlos
  confundiría más: el operador creería que el snippet no existe.
- **Tarjeta** (`AgentsGrid.tsx`): chip de estado del **agente**. Y se arregla el bug de
  `proposal.md`: el campo es `tenant`, no `client`. El `TokenSwitch` sale de la tarjeta de agente:
  apaga el tenant entero, no el agente, y ponerlo donde se gestiona un agente invita a confundir
  las dos cosas — que es exactamente el problema que este change existe para separar.
- **Corrección sobre la v1 de este §C.7**, que decía que el `TokenSwitch` «se queda en `/clients`».
  Falso, y verificado: no existe `/clients` (la ruta es `/clientes`) y `front/components/TokenSwitch.tsx`
  no estaba importado en ninguna otra parte, así que quitarlo de la tarjeta lo dejó huérfano. La
  capacidad **no se pierde**: apagar un tenant se hace con la casilla `isActive` de
  `components/clientes/ClientModal.tsx:121`, que guarda por el mismo `PATCH /api/clients/:id/credits`
  (`app/clientes/page.tsx:108`). Se borra el componente huérfano en vez de dejarlo: un control muerto
  que apaga un tenant es una invitación a volver a montarlo en una pantalla de agente.

## §D. Migración y backfill *(GATE HUMANO)*

Migración **aditiva**: dos columnas nuevas con default, una tabla nueva. No borra ni renombra nada.

**El backfill es el default de columna y nada más: los 14 agentes van a `draft`, `publishedAt = NULL`.**

Esto no era el plan. La v1 de este §D llevaba un `UPDATE` con criterio (tenant + conversaciones
reales ⇒ `published`, `publishedAt` = fecha de la primera conversación) para no callar a nadie. El
gate T0.2 lo eliminó con un dato que no está en el código:

> **Ninguno de los 14 agentes es de un cliente. Todos son pruebas** (propietario, T0.2).

Con eso, el criterio de la v1 pasa de prudente a **falso**: marcaría `published` — y por tanto
facturable, y con historia de publicación fechada en junio — a seis agentes que nadie compró. El
`isTest = false` de sus conversaciones no significa "un cliente lo usó"; significa "se probó desde
fuera de la consola de operador", que es exactamente lo que hace el propio dueño cuando abre la URL
pública del widget para ver si funciona. La señal era más débil de lo que parecía.

| Situación del agente hoy | Estado tras el backfill | Por qué |
|---|---|---|
| Todos, sin excepción | `draft` | nada está vendido; nada debe estar publicado ni facturable |

Y el riesgo que hacía de esto un gate desaparece: no hay servicio que interrumpir. `widgetInstalledAt`
está vacío en los 14 (T0.1), así que tampoco hay una web ajena con el snippet puesto.

**Consecuencia de orden, no menor:** entre T1 y T3 todos los agentes quedan mudos para tráfico
público **y sin botón para reactivarlos**. Con cero clientes es asumible, pero no hay razón para
pasar por ese estado en producción: **T1, T2 y T3 se despliegan juntos.** La consola de operador
sigue funcionando en medio (§C.3), así que el propietario nunca se queda sin poder probar.

**Procedimiento obligatorio, en este orden:**

1. `npm run inventory:agent-status` — sólo lectura, imprime la foto previa. Ya no decide el backfill,
   pero deja constancia de qué había antes de tocar. Mismo patrón que `inventory:orphans` en H1.
2. El propietario aprueba. **Hecho:** todos a `draft`.
3. `prisma migrate deploy`, junto con el despliegue de T2 y T3.
4. Comprobación posterior: los agentes responden desde la consola, y responden por URL pública
   **después** de pulsar Publicar. Ésa es la prueba de que el estado hace algo.

## §E. Tests

| Qué | Cómo |
|---|---|
| Borrador no atiende | `runAgent` sobre agente `draft` ⇒ error de publicación, sin llamar al LLM |
| Orden de motivos | `draft` + cupo agotado ⇒ motivo "no publicado", no "sin cupo" |
| Consola sí atiende | `draft` + `isTest` ⇒ responde |
| `isTest` sin sesión no exime | `test:true` sin `req.user` sobre un `draft` ⇒ 403 (regresión de la defensa de `ai.ts:70-75`) |
| Config del widget | `GET /widget/config` de un `draft` ⇒ 404 |
| Ping sigue mudo | `POST /widget/ping` de un `draft` ⇒ 204 |
| Precondiciones bloqueantes | publicar sin `tenantId` / sin prompt ⇒ 400 con el motivo |
| Canal sin conexión avisa, no bloquea | publicar con `channel = "whatsapp"` y sin conexión ⇒ 200, `status = published`, con aviso en la respuesta |
| Publicar es idempotente | publicar dos veces no duplica evento ni pisa `publishedAt` |
| Recuento | `countBillableAgents` cuenta `published` + `suspended`, no `draft` ni `archived` |
| Rastro | cada transición escribe un `AgentStatusEvent` con `from`/`to` |
| Regresión H1 | los tres suites de metering verdes sin cambiar expectativas |

## §F. Orden

```
inventario (sólo lectura) → [GATE: aprobación del backfill] → migración
   → gate en runAgent + superficies de C.3 → endpoints publish/unpublish
   → countBillableAgents → front
   → desbloquea H4/T4
```

El gate va **antes** que el front a propósito: si se pinta el botón antes de que el estado corte
tráfico, el operador cree que ha despublicado algo que sigue respondiendo. Ese es el peor fallo
posible de este change, y el orden lo previene.
