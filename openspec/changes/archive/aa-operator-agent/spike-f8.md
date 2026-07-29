# Spike F8 — Chips nativos de Telegram + escrapeo del onboarding

> Investigación de solo lectura (F8-T1 spike + F8-T2 escrapeo). No se tocó config,
> ni el gateway, ni el generador. Evidencia recogida contra el contenedor
> `OpenClaw_Agents` (OpenClaw 2026.6.11) y el código del front `creador_CRM`.
> Fecha: 03/07/2026.

---

## Parte 1 — F8-T1: ¿OpenClaw soporta chips/botones nativos de Telegram?

### Conclusión: **(A) Chips nativos SOPORTADOS y, además, YA HABILITADOS para Adrian por defecto.**

No hace falta Bot API directa ni fallback numérico. El plugin de Telegram de OpenClaw
renderiza `inline_keyboard` nativo, y el agente los emite mediante la **message tool**
(bloques de `presentation`). Cuando Adrian pulsa un botón, la selección vuelve al agente.

### Evidencia

**1. El plugin construye y envía inline keyboards nativos.**
- `dist/send-C7dCVFUG.js:348` → `buildInlineKeyboard(buttons)` produce `{ inline_keyboard: rows }`.
- `reply_markup` está cableado en toda la ruta de entrega, tanto para texto como para media:
  `dist/delivery-CpWKd4cN.js:104,123,147,387` y `dist/send-C7dCVFUG.js:1146,1329`.
- Existen acciones nativas para editar los botones ya enviados:
  `editMessageReplyMarkupTelegram` (`dist/send-C7dCVFUG.js:1628`).

**2. Capabilities del canal (sondeo en vivo).**
`docker exec -u node OpenClaw_Agents openclaw channels capabilities --channel telegram`:
```
Support: chatTypes=direct,group,channel,thread polls reactions threads media nativeCommands blockStreaming
Actions: send, broadcast, poll, react, delete, edit, topic-create, topic-edit
Bot: @Estudio3ABot (8715628503)
Flags: joinGroups=true readAllGroupMessages=false inlineQueries=false
```
La acción `send` es la que transporta los botones. (`inlineQueries=false` es el modo
inline `@bot` de Telegram — NO son los inline keyboards; no confundir.)

**3. De dónde salen los botones (3 orígenes).** `dist/button-types-Bbh_0M7b.js:81`:
```js
resolveTelegramInlineButtons(params) =
  params.buttons                                   // botones explícitos (telegramData.buttons)
  ?? buildTelegramInteractiveButtons(interactive)  // bloques "interactive" (legacy)
  ?? buildTelegramPresentationButtons(presentation)// bloques "presentation" (recomendado)
```
Cada botón admite `url`, `callback` (valor opaco) o `command` (comando nativo)
(`toTelegramInlineButton`, `dist/button-types-Bbh_0M7b.js:11-40`). Un bloque `select`
de opciones también se convierte en botones. Filas de **3 botones** en Telegram
(`TELEGRAM_INTERACTIVE_ROW_SIZE = 3`); máx. 5 botones por action row
(`dist/components-Db2XSbIE.js:595`).

**4. El agente los emite con la message tool.** El `send` de la message-action-runner
acepta `presentation` con bloques de botones (`dist/message-action-runner-DlxXNJiv.js:904,956,970`).
Docs oficiales (`openclaw docs buttons` → canal Mattermost/Telegram):
> **"Interactive buttons (message tool) — Send messages with clickable buttons.
> When a user clicks a button, the agent receives the selection and can respond."**

CLI equivalente: `openclaw message send --presentation ...` envía bloques semánticos
(`text`, `context`, `divider`, `buttons`/`actions`, `select`) que el core renderiza
según las capabilities del canal.

**5. El gate de config YA está en verde para Adrian (sin tocar nada).**
- `dist/inline-buttons-Dm0_YWuQ.js:7` → `DEFAULT_INLINE_BUTTONS_SCOPE = "allowlist"`.
- Resolver: si `channels.telegram.capabilities` NO existe → devuelve el default `"allowlist"`
  (`resolveTelegramInlineButtonsScopeFromCapabilities`, línea 22).
- Config actual del canal (`openclaw config get channels.telegram`):
  ```json
  { "enabled": true, "dmPolicy": "allowlist", "allowFrom": ["1293809129"], "groupPolicy": "allowlist" }
  ```
  No hay clave `capabilities` → scope efectivo `"allowlist"` → botones permitidos para los
  chat-id de la allowlist. **1293809129 es Adrian** → habilitado en su DM out-of-the-box.
- Si `capabilities.inlineButtons` fuese `"off"`, el runtime lanzaría:
  *"Telegram inline buttons are disabled. Set channels.telegram.capabilities.inlineButtons
  to dm/group/all/allowlist"* (`dist/action-runtime-DnWwxFsZ.js:282`). No es el caso.

### Recomendación de implementación (para F8-T3)

- **Usar la message tool con `presentation`**, no Bot API directa. El operator ya envía por
  Telegram; añadir botones es emitir un bloque `actions`/`buttons` (o `select`) en la
  presentación de la respuesta.
- **Forma del payload** (semántica portable, resumida): un bloque
  `{ type: "actions", buttons: [{ label, value }] }`. `value` (o `action.value`) es lo que
  vuelve al agente al pulsar. Filas de 3 → agrupar verticales/módulos en tandas.
- **Callback:** los botones `callback` mandan un valor opaco de vuelta; el `callback_data`
  de Telegram está limitado a 64 bytes y el plugin lo sanea (`sanitizeTelegramCallbackData`).
  Usar ids cortos (`v:peluqueria`, `m:citas`), no labels largos.
- **TTL de los botones:** `channels.telegram.accounts.*.agentComponents.ttlMs` controla cuánto
  siguen siendo pulsables. Para un wizard multipaso conviene un TTL holgado o re-emitir la
  botonera en cada turno (más simple y robusto).
- **Multi-selección de módulos:** Telegram inline keyboards no tienen estado de "checkbox"
  nativo; para el paso de módulos, o bien se re-pinta la botonera marcando lo elegido
  (✓/○ en el label) y un botón "Confirmar", o se hace toggle turno a turno. Los `select`
  de opción única mapean 1:1 a botones; la multi-selección hay que emularla.
- **Opcional (no bloqueante):** fijar explícitamente
  `channels.telegram.capabilities.inlineButtons = "dm"` para dejar la intención documentada
  y no depender del default. Requiere aprobación humana (toca config del gateway) → NO lo hice.

Descartadas (B) Bot API directa y (C) fallback numérico: innecesarias, hay soporte nativo
y ya activo.

### Contraste con la Telegram Bot API oficial (Context7)

Consultado Context7 (`/yagop/node-telegram-bot-api`, wrapper Node — el runtime de OpenClaw
es Node/grammY) para respaldar el veredicto con la API, no solo con los .js del contenedor:
- **Estructura:** `sendMessage` acepta `reply_markup` = objeto JSON-serializado con
  `inline_keyboard` (array de filas de botones `{ text, callback_data|url|web_app }`).
  Coincide exactamente con lo que produce el plugin (`buildInlineKeyboard → { inline_keyboard: rows }`,
  botones `{ text, callback_data }`). El veredicto no depende de una lectura del bundle: es la
  forma canónica de la API.
- **Callback handling:** al pulsar un botón, la API emite un update `callback_query`; el bot debe
  responder con `answerCallbackQuery` para cerrar el spinner del cliente. OpenClaw ya gestiona
  esto internamente (native-command-callback-data + el ciclo de la message tool) — el agente solo
  recibe la selección. Para F8-T3 no hay que implementar el ack a mano.
- **Modo polling:** los inline keyboards funcionan en polling (el `callback_query` llega como un
  update más; el ejemplo del wrapper usa `{polling: true}` y emite el evento `callback_query`).
  Esto **confirma y precisa** la nota anterior: el flag `inlineQueries=false` del canal es el modo
  "inline @bot" (respuestas inline en cualquier chat) y es **ortogonal** a los inline keyboards —
  no los bloquea. Nuestro bot en polling puede emitir chips sin tocar ese flag.

Conclusión reforzada: el soporte nativo de chips es coherente con la API oficial; (A) se sostiene
tanto por el código del plugin como por la doc de la Bot API.

---

## Parte 2 — F8-T2: onboarding real del generador (escrapeo)

Fuente: `creador_CRM/front`. El wizard son **5 pasos** (no 4), definidos en
`app/onboarding/page.tsx:25`:
```
STEPS = ['Tipo de negocio', 'Módulos', 'Marca', 'Base de datos', 'Datos']
```
En modo alta se arranca en el paso 0; en modo edición (`?projectId=`) se entra en el paso 1
y el paso 0 queda bloqueado (`page.tsx:39-41`). Para el Minion (alta nueva) el flujo es
paso 0 → 4.

### Paso 0 — "Tipo de negocio" (cliente + vertical)
`page.tsx:178-187`. El usuario:
1. **Elige un cliente/tenant** existente de agents-agency (`ClientCombobox`). Al elegirlo se
   pre-rellenan nombre/email/teléfono/dirección del negocio (`pickClient`, `page.tsx:64-76`).
   Los tenants se leen de `GET /tenants` del back CRM (`page.tsx:59`).
2. **Elige un vertical** (`VerticalPicker`, una card por vertical). Al elegirlo se carga el
   preset (`configFromVertical`): módulos por defecto, terminología y branding del vertical
   (`pickVertical`, `page.tsx:78-97`). Re-clicar la card seleccionada la deselecciona → cae a
   `custom`.

**Obligatorio para crear (modo API/CRM):** un **cliente (tenant)** seleccionado. Si falta,
`finish()` bloquea y manda al paso 0 con error *"Selecciona un cliente…"* (`page.tsx:131-135`).
El vertical siempre tiene valor (default `peluqueria`).

#### Verticales disponibles (id → label) — `lib/config/verticals.ts:24-113`
| id | label | emoji | módulos por defecto |
|----|-------|-------|---------------------|
| `peluqueria` | Peluquería | 💈 | clientes, citas, servicios, empleados, vacaciones, productos, ventas, facturas, marketing, estadisticas |
| `estetica` | Centro de estética | 💅 | clientes, citas, servicios, empleados, vacaciones, productos, ventas, facturas, marketing, estadisticas |
| `hosteleria` | Restaurante / Bar | 🍽️ | clientes, citas, productos, ventas, facturas, empleados, fichaje, vacaciones, marketing, estadisticas |
| `fitness` | Gimnasio / Box | 🏋️ | clientes, citas, servicios, empleados, fichaje, vacaciones, productos, ventas, facturas, marketing, estadisticas |
| `escalada` | Sala de escalada | 🧗 | clientes, citas, servicios, empleados, productos, ventas, facturas |
| `clinica` | Clínica | 🩺 | clientes, citas, servicios, empleados, vacaciones, productos, ventas, facturas, marketing, estadisticas |
| `taller` | Taller mecánico | 🔧 | clientes, citas, servicios, empleados, fichaje, vacaciones, productos, ventas, facturas |
| `veterinario` | Centro veterinario | 🐾 | clientes, citas, servicios, empleados, vacaciones, productos, ventas, facturas, marketing, estadisticas |
| `abogados` | Bufete de abogados | ⚖️ | clientes, citas, servicios, empleados, vacaciones, fichaje, ventas, facturas, marketing, estadisticas |
| `centro-deportivo` | Centro / Club deportivo | 🏟️ | clientes, citas, servicios, empleados, fichaje, vacaciones, productos, ventas, facturas, marketing, estadisticas, categorias |
| `comerciales` | Equipo comercial | 💼 | clientes, comercial, citas |
| `custom` | Personalizado | ⚙️ | clientes |

(`BASE_PERSONAS = ['empleados','vacaciones']` — `verticals.ts:22` — se expande en los presets
que lo usan.)

### Paso 1 — "Módulos" (activar/desactivar)
`page.tsx:189-201` (`ModuleToggleGrid`). Parte del preset del vertical y el usuario togglea.
Los módulos `mandatory` no se pueden apagar (`toggle`, `page.tsx:98-101`). Además hay un
control de **vistas** (`BusinessViews`): al apagar la vista "Trabajador" (`worker`) se
auto-desactivan los módulos con `requiresWorkerView` (`changeViews`, `page.tsx:102-111`).
`DEFAULT_VIEWS = { worker: true, client: false }` (`tenant-config.ts:36`).

#### Módulos seleccionables (id → label · categoría) — `lib/config/modules.ts:42-59`
| id | label | categoría | obligatorio | notas |
|----|-------|-----------|-------------|-------|
| `dashboard` | Inicio | core | **sí** | siempre presente |
| `clientes` | Clientes | core | no | activo en todos los presets |
| `citas` | Citas | operativa | no | recomienda `servicios` |
| `servicios` | Servicios | operativa | no | |
| `empleados` | Empleados | personas | no | requiere vista Trabajador |
| `fichaje` | Fichaje | personas | no | requiere vista Trabajador; recomienda `empleados` |
| `vacaciones` | Vacaciones | personas | no | requiere vista Trabajador; recomienda `empleados` |
| `productos` | Productos | retail | no | |
| `ventas` | Ventas / TPV | retail | no | recomienda `productos` |
| `facturas` | Facturas | retail | no | recomienda `clientes` |
| `marketing` | Marketing | marketing | no | recomienda `clientes` |
| `estadisticas` | Estadísticas | marketing | no | recomienda `clientes` |
| `categorias` | Categorías | personas | no | equipos/staff (deportivo) |
| `comercial` | Comercial de campo | operativa | no | recomienda `clientes` |
| `configuracion` | Configuración | core | **sí** | siempre presente |
| `mi-cuenta` | Mi Cuenta | core | **sí** | siempre presente |

Obligatorios (nunca se ofrecen para desactivar): **dashboard, configuracion, mi-cuenta**.
`recommends` es aviso, no bloqueo. Etiquetas de categoría: core=Esencial, operativa=Operativa,
personas=Personas, retail=Retail/Caja, marketing=Marketing y Web (`modules.ts:65-71`).

### Paso 2 — "Marca" (branding, OPCIONAL)
`page.tsx:203-217` (`BrandingForm` + `AiBrandingSuggest`). Color primario/secundario, texto de
logo, imagen de logo, importar diseño de landing y sugerencia con IA. Todo tiene defaults del
vertical → **opcional**. Para un formulario conversacional se puede omitir y quedarse con los
colores del preset.

### Paso 3 — "Base de datos" (OPCIONAL)
`page.tsx:219-246`. Campos `host`, `port`, `name`, `user`, `password` o una `url` de conexión.
Texto literal: *"Todo manual y opcional: si lo dejas vacío, no pasa nada"*. **Omitible.**

### Paso 4 — "Datos" (contacto + resumen)
`page.tsx:248-264`. `phone`, `email`, `address` del negocio (se pre-rellenan desde el tenant en
el paso 0) + un resumen (negocio, vertical, nº módulos activos). **Opcional** (editable a futuro).

### Creación del proyecto (qué se manda al back)
`finish()` (`page.tsx:118-145`) marca `setupComplete: true` y llama `createProject(cfg)`.
En modo API (`tenant-config-context.tsx:203-215`):
```
POST /projects   body: { tenantId: cfg.business.clienteId, config: <TenantConfig completo> }
```
El back valida que el tenant existe; si `clienteId` falta, lanza. `config` es el `TenantConfig`
(`tenant-config.ts:38-103`): `business{name,vertical,phone?,email?,address?,clienteId}`,
`modules` (mapa id→bool), `views`, `terminology`, `branding`, `database?`, etc.

> Nota para F8-T3: el operator NO usa `POST /projects` (ruta del front). Escribe por
> `/service/operator` del back CRM, hoy **solo lectura** — habrá que abrir un endpoint de
> escritura equivalente (`crm_crear_proyecto`) que construya el mismo `TenantConfig` y lo
> vincule al `tenantId`. El shape de arriba es la referencia de qué debe producir.

### Datos mínimos que el Minion debe recabar
1. **Cliente/tenant** (obligatorio, id de `aa.tenant`) — sin él no se crea.
2. **Vertical** (obligatorio; default `peluqueria`) — fija módulos/terminología/branding base.
3. **Módulos** (opcional; parte del preset del vertical, togglear los no obligatorios).
4. Nombre del negocio (por defecto = label del vertical o nombre del tenant), y opcionalmente
   teléfono/email/dirección (heredados del tenant), branding y base de datos → todos con default,
   **omitibles**.

Con esto el formulario conversacional puede ofrecer EXACTAMENTE las mismas 12 verticales y 16
módulos que el wizard, sin volver a leer el front.
