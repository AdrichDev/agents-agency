# Skills propias: que instalar una skill cambie lo que el agente dice

## Intención

Hoy el catálogo de skills es decorativo. El operador puede instalar una skill en un agente,
hablar con ese agente y no notar absolutamente nada. Esto arregla eso: skills escritas por
nosotros, para el negocio del cliente, que al instalarse cambian de verdad la conversación.

## El problema, con evidencia

Producción, medido:

| Señal | Valor |
|---|---|
| Skills en el catálogo | 108 (105 en cola de purga, ver `aa-catalogo-skills-purga`) |
| Instalaciones en agentes (`AgentSkill`) | **0** |
| Skills con `instructions` | **0** |
| Skills con `mcpUrl` | **0** |
| Skills con `source: "builtin"` | **0** |
| Integraciones físicas conectadas | **0** |

El mecanismo de inyección **está bien construido y no hace falta tocarlo**. `usar_skill`
(`lib/agent/executor.ts:112-156`) comprueba que la skill esté instalada en ESE agente,
prefiere `skill.instructions`, envuelve el cuerpo en un bloque `[SKILL-<nonce>]` con marco
anti-inyección y devuelve `curated: false` cuando no hay instrucciones curadas.

Ese `curated: false` es el bug de producto: sin `instructions`, lo que recibe el modelo es la
descripción de una línea sacada de GitHub. Por eso instalar una skill no se nota.

## Por qué `instructions` y no `toolsProvider` ni MCP

Se descartaron las otras dos vías por razones verificadas, no por comodidad:

1. **`toolsProvider`** sólo admite claves de `TOOLS_BY_PROVIDER` — `gmail`, `slack`, `jira`,
   `calendar`, `ecommerce` (`routes/skills.ts:97`). Las facultades de negocio de verdad
   (`reservas`, `leads`, `pedidos`) viven en `BACKEND_TOOLS_BY_CAPABILITY` y las enciende
   `AgentDataBackend.mode="managed_db"`, no el catálogo. Una skill no puede alcanzarlas.
2. Y aunque pudiera: `capabilitiesForSkills` (`skill-capabilities.ts:57`) sólo marca
   `executable` si la integración **física** está conectada. Con 0 conexiones en producción,
   cualquier skill con `toolsProvider` saldría `requires_connection` — es decir, seguiría sin
   notarse.
3. **MCP** (`mcpUrl` + secreto per-agente) exige un servidor por skill y credenciales del
   cliente. Es la capa de después, no la de ahora.

`instructions` es la única vía que produce un cambio visible en la conversación **sin
depender de que el cliente conecte nada**. Que es justo la situación de todos los agentes
que hay hoy en producción.

## Alcance

**Dentro:**
- 10 skills propias con `source: "builtin"` e `instructions` escritas: 6 transversales
  (valen para cualquier negocio) y 4 por vertical (los que ya vendemos, según
  `front/lib/promptTemplates.ts`: E-commerce, Inmobiliaria, Salud, Legal).
- Script de seed idempotente (`upsert` por `name`) para crearlas y actualizarlas.
- Prueba de que instalar una skill cambia la salida de `usar_skill` de `curated: false` a
  `curated: true` con el cuerpo curado dentro.

**Fuera:**
- No se toca `executor.ts` ni `engine.ts`: el mecanismo funciona.
- No se conectan integraciones ni se declara `toolsProvider` en las nuevas skills. Todas
  nacen informativas a propósito — ver el punto 2 de arriba.
- No se escriben servidores MCP.
- La purga del catálogo es otro change (`aa-catalogo-skills-purga`) y su `--apply` sigue
  retenido.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Las `instructions` son texto que acaba en el prompt del sistema del agente | El marco anti-inyección de `usar_skill` ya trata el cuerpo como contenido no confiable. Además estas skills las escribimos nosotros, no vienen de un repo ajeno. |
| Coste de tokens: cada skill instalada añade una línea al índice del prompt, y su cuerpo entra entero al invocarse | El índice es una línea por skill (`engine.ts:251-266`), y el cuerpo sólo entra si el modelo la invoca (divulgación progresiva). El tope `SKILL_INSTRUCTIONS_MAX` ya recorta. |
| Dar consejo sensible (salud, legal) por boca de un bot | Es precisamente lo que las `instructions` de esos dos verticales prohíben de forma explícita. Sin ellas el agente improvisa, que es peor. |
| Seed que pise skills existentes | `upsert` por `name` y sólo sobre filas con `source: "builtin"`. Nunca toca las importadas de GitHub. |

## Dependencias

Ninguna bloqueante. Se puede ejecutar antes o después de la purga: las 10 nacen con nombres
propios (prefijo `3a/`) que no colisionan con los identificadores de GitHub.
