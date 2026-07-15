# Proposal — aa-agent-backend-foundation

## Intent

Dar a cada agente de Agents Agency un **backend de datos propio** contra el que
operar (reservas, leads, pedidos), reestructurar el panel del agente en torno a
esa realidad y notificar al dueño del negocio cuando ocurren eventos relevantes.
Hoy ningún agente declara dónde vive su data: conversa, hace RAG y usa
integraciones OAuth genéricas, pero no puede reservar, guardar un lead
estructurado ni consultar un pedido contra una fuente propia
(design.md §Contexto, §A). Esta v1 pone los cimientos.

## Problemas que resuelve

1. **No hay backend de datos por agente.** No existe modelo Prisma, campo del
   wizard ni tab que declare la fuente de datos del negocio; lo más cercano es
   `ecommerceConfig.orderStatusUrl` (solo lectura de pedidos, design.md §A, §B.1).
2. **El motor de reservas interno no está cableado al agente.** `Service` /
   `AgentSchedule` / `Appointment`, `booking/slots.ts:generateSlots` y
   `/api/booking` existen, pero su único consumidor es la agenda del front; el
   agente no puede reservar (design.md §B.1.3).
3. **Panel confuso (9 tabs, 3 de dudoso valor).** Skills re-expresa lo que
   Integraciones ya da, Logs queda vacía sin automatizaciones, Leads no aporta
   como tab, Ajustes es parcialmente decorativo (design.md §A, §C).
4. **Sin aviso proactivo al cliente final.** Los avisos existentes notifican a
   la agencia, no al dueño del agente; no hay config de notificaciones
   per-agente (design.md §D).
5. **Selectores decorativos.** `reasoning_effort` nunca se envía con tools; el
   `model` de BD se ignora en runtime openclaw (design.md §A Ajustes).

## Scope

### Sí — v1

- Nuevo modelo `AgentDataBackend` (1:1 con Agent) + migración retrocompatible.
- **Backend por defecto `managed_db`**: aprovisionamos la BD, el executor pega
  directo. Adapter `managed_db` con cliente `pg` y plantillas por capability.
- **Esquema estándar único por vertical** (reservas/leads/pedidos fijos, cero
  mapeo de columnas).
- Tools nuevas cableadas al backend del agente: `crear_reserva`,
  `consultar_disponibilidad`, `guardar_lead` (reutilizan el motor de reservas
  interno ya existente) + `consultar_pedido` (absorbe `get_order_status`).
- Migración **retrocompatible** de `get_order_status` /
  `ecommerceConfig.orderStatusUrl` al contrato nuevo (agentes en prod con
  `orderStatusUrl` no se rompen).
- Paso obligatorio del wizard **"Datos del negocio"** (sustituye a Skills), sin
  default silencioso; "solo información" (`none_yet`) es elección explícita.
- Reestructura del panel a las tabs de design.md §C: **Datos del negocio**
  (nueva), Canales e integraciones (fusión + notificaciones), Conocimiento
  (fuente web con estado + re-ingesta), Automatizaciones (import n8n +
  historial embebido), Implementación (renombra Deploy), Ajustes (avisos
  honestos).
- **Skills**: solo OCULTAR wizard + panel (se conservan motor, datos y
  marketplace `/skills`).
- **Leads**: quitar tab; la captura sigue en el engine; visibilidad = contador
  en el dashboard. Relajar el lead-flow: pedir nombre solo ante intención real,
  no bloqueante antes de responder.
- **Adjuntos**: guardar el archivo ORIGINAL en bucket privado nuevo
  (`kb-files/<agentId>/`) además de los chunks; GC al borrar la fuente.
- **Automatizaciones**: import de workflow n8n como camino principal (pegar JSON
  o elegir de nuestra instancia por API); NL solo como azúcar. Instancia n8n
  NUESTRA, multi-tenant, con scoping estricto por agente. Nota: es
  workflow-como-**automatización** (trigger), NO workflow-como-tool (eso es v2).
- **Selector de modelo**: OCULTAR para runtime `openclaw` con aviso.
- **reasoning_effort**: QUITAR el selector del panel de agente (no aplica con
  tools); se queda solo donde sí aplica.
- **Notificaciones**: canal v1 = Telegram (lib ya existe); eventos v1 =
  `nueva_reserva` + `nuevo_lead` + `handoff`.
- **Implementación/entrega**: guía self-serve para el cliente +
  auto-verificación de instalación del widget (ping `widget.js` → "instalado ✓"
  en el panel). Canales TG/WA los conecta la agencia.

### No — backlog v2

- Adapter `external_api` y plantilla de API desplegable para clientes sin API.
- Mapeo tabla/columna por cliente (`dbSchema`) para BDs preexistentes.
- Propagar el modelo elegido a la config del agente en OpenClaw.
- Notificaciones por WhatsApp / email.
- Borrado total de Skills (modelos `Skill`/`AgentSkill` + marketplace).
- Capa **workflow-as-tool** (workflow importado invocable por el LLM en la
  conversación, design.md §F).

## Risks

- **Retrocompatibilidad `get_order_status`.** Hay agentes en prod con
  `orderStatusUrl` configurado; la migración al contrato `consultar_pedido` debe
  ser aditiva y no romperlos (design.md §Riesgos).
- **Ocultar Skills** afecta a `useWizardSkills` / `SkillsStep` / `ReviewStep`
  (muestran skillIds) y al schema zod de `POST /api/agents` (acepta `skillIds`):
  limpieza coordinada front + schema, pero **sin borrar** motor/datos/marketplace.
- **Credenciales de BD per-agente (`managed_db`).** Mismo cifrado que tokens
  OAuth (`encryptToken`), pero conviene usuario Postgres de mínimo privilegio por
  agente (no service-role). Nada de SQL libre generado por LLM: solo plantillas
  parametrizadas.
- **Instancia n8n multi-tenant.** El import de workflows exige scoping estricto
  por agente; deuda conocida (`OPERATOR_SERVICE_TOKEN` único opera cualquier
  negocio) que debe respetarse para no cruzar tenants.
- **Paso obligatorio alarga el wizard.** Prever "solo información" como salida
  rápida para no frenar demos.
- **Relajar el lead-flow** no debe romper la captura existente (`record_lead_intent`).
- **Bucket privado `kb-files`.** GC al borrar la fuente para evitar huérfanos y
  coste de storage creciente.

## Dependencies

- `encryptToken` / `decryptToken` (`back/src/lib/integrations/oauth.ts`) — cifrado
  de credenciales, ya en uso.
- Motor de reservas: `booking/slots.ts:generateSlots`, modelos
  `Service`/`AgentSchedule`/`Appointment`, `/api/booking` — reutilizado, no se
  reescribe.
- Executor server-side + tools condicionales (`back/src/lib/agent/executor.ts`,
  `engine.ts:69-108`) — punto de integración existente para los handlers.
- Supabase Storage (`back/src/lib/storage.ts`) — se añade bucket privado nuevo
  `kb-files`.
- `channels/telegram.ts:sendMessage` — reutilizado por el dispatcher de
  notificaciones.
- `n8n/client.ts` — ya habla con la instancia; base del import de workflows.
- `widget.js` (`back/public/widget.js`) servido estático — base del ping de
  auto-verificación.
- aa-openclaw-provision-hardening (chip de provisioning) — ya integrado, se
  mantiene.
