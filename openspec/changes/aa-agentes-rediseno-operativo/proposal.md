# Proposal — aa-agentes-rediseno-operativo

## Intent

Bajar a tierra la creación de agentes de AA. Hoy el producto tiene todas las piezas
de un bot (canales, cerebro, tools, RAG, notificaciones, handoff) **sueltas**, sin una
columna vertebral operativa y sin el bucle de prueba-antes-de-publicar que todo
producto profesional tiene. Este documento es el **plan maestro**: mapea la anatomía
de un bot operativo de referencia, contrasta el estado actual (auditoría con evidencia
`file:line`), prioriza los arreglos en un backbone P0/P1/P2, y define el roadmap de
ejecución. NO toca código — de aquí salen los openspec hijos que sí lo tocarán.

## Problema (auditoría con evidencia)

Ocho puntos verificados contra el código (detalle en `design.md §Gap`):

1. **Canal ambiguo** — el wizard ofrece los 4 canales siempre; el Widget Web no
   espeja Telegram, es artefacto independiente (`ChannelStep.tsx:61`). Ruido de UX.
2. **"Solo API" sin explicar** — agente accesible solo por REST; nombre confuso
   (`ChannelStep.tsx:34-39`).
3. **Backend de datos con capa muerta** — "Estado de pedidos" (URL+key) VIVO y
   consumido (`executor.ts:87-95`); pero el adapter `external_api` está completo en
   backend y **sin UI** que lo configure (`external-api.ts:77`, sin formulario).
4. **Integraciones a medias** — Google/Slack/Notion reales; Jira/Instagram placeholder
   "Próximamente" (`IntegrationsPanel.tsx:25-26`).
5. **Chat id del dueño a pelo** — funciona (`notify-dispatcher.ts:113`) pero se pide
   manual en vez de auto-capturarlo cuando el dueño escribe al bot.
6. **RAG que miente** — estado se marca `"indexed"` aunque `chunks:0`
   (`service.ts:233-234`); el scraper no ejecuta JS (`web.ts:20-25`) → sitios SPA
   (fpeuroformac.com) dan 0 chunks; filtro `<50 chars` (`embeddings.ts:48`) remata.
   **Fundamento roto: un bot sin conocimiento no sabe nada.**
7. **Skills/Agentes/MCP mezclados** — una sola lista, tipo solo como texto; filtros por
   `use`, nunca por `type` (`SkillsTab.tsx:314`).
8. **Automatización NL floja** — 3 triggers (email/slack/schedule); import JSON existe
   pero la ejecución depende de instancia n8n configurada (`AutomationImportForm.tsx`,
   `AutomationForm.tsx:141`).

**El agujero grande (transversal):** no existe **consola de pruebas**. Se crea el
agente a ciegas y se publica sin haberle hablado, sin ver qué tools dispara ni qué
chunks recupera. Ningún profesional publica así.

## Scope de este documento

- Definir la **anatomía de referencia** de un bot operativo (design §A).
- **Auditoría gap** actual vs ideal, los 8 puntos + el agujero de la consola (design §B).
- **Backbone priorizado** P0/P1/P2 con justificación de impacto (design §C).
- **Roadmap** de openspec hijos y orden de ejecución (tasks.md).
- Fuera de scope: escribir código, migraciones, o los specs hijos en detalle (eso es
  la ejecución posterior, un openspec por pieza).

## Backbone (resumen; detalle en design §C)

- **P0 (columna vertebral):**
  - Consola de pruebas del agente (hablarle + ver tools + ver chunks, pre-publicar).
  - RAG real: render JS + estado honesto + retrieval visible.
- **P1 (limpieza que desatasca):**
  - Wizard canal-aware + quitar campos inertes (`skillIds []`) + auto-captura chat_id.
  - Skills/Agentes/MCP separados por tipo.
- **P2 (cerrar features a medias):**
  - UI para `external_api` (el adapter ya existe).
  - Integraciones Jira/Instagram o retirarlas del catálogo hasta cablearlas.
  - Automatización NL: honestidad de estado n8n + más triggers o recorte de alcance.

## Risks

- **Alcance-elefante**: intentar todo a la vez hunde el producto. Mitigación: backbone
  priorizado, un openspec hijo por pieza, P0 primero.
- **RAG con render JS**: añade dependencia headless (playwright/puppeteer) — coste de
  build/infra. Evaluar en el spec hijo (alternativa: API de scraping gestionada).
- **Consola de pruebas**: no debe consumir cuota LLM del tenant en producción sin
  control; definir gating y coste en su spec.

## Dependencies

- Auditoría base: este documento (evidencia ya recogida).
- Openspec hijos futuros (uno por pieza del backbone).
- Sin dependencias de despliegue: es documentación.
