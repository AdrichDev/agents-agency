# Purga del catálogo de skills

> **Estado: ejecutado el 29/07/2026.** 118 skills de partida, 105 borradas, 13
> conservadas. Backup en `back/prisma/backups/skills-2026-07-28.json`, con la
> restauración probada contra la base real antes del borrado.
>
> Dos cifras de este documento quedaron desfasadas y se dejan como estaban para
> no reescribir la historia: se escribió contra 108 filas y 11 supervivientes.
> Al ejecutarlo, el criterio se había endurecido a 3 supervivientes importadas y
> `aa-skills-propias-tenant` había sembrado 10 propias, que también se conservan.
> Lo vigente son las cifras del recuadro.

## Intención

Que el catálogo de skills contenga sólo cosas que un cliente nuestro podría
querer. Hoy contiene 108 repositorios de GitHub y el 60% son herramientas de
programador.

## El problema, con datos de producción (28/07/2026)

```
skills en catálogo: 108
  con toolsProvider (dan tools ejecutables): 1   → rusq/slackdump
  con instructions (cuerpo curado):          0
  con mcpUrl (servidor MCP):                 0
  asignadas a algún agente (agente_skill):   0
```

**Ninguna skill se ha instalado nunca en ningún agente.** El catálogo es una
lista de estrellas de GitHub importada y jamás curada.

Muestra de lo que hay dentro: `chongdashu/unreal-mcp` (Unreal Engine),
`IvanMurzak/Unity-MCP`, `getsentry/XcodeBuildMCP`, `txn2/kubefwd` (Kubernetes),
`mrexodia/ida-pro-mcp` y `bethington/ghidra-mcp` (ingeniería inversa),
`FunnyWolf/Viper` (red teaming), `martin-ger/esp32_nat_router` (firmware de
router), `nukeop/nuclear` (reproductor de música), `chrisryugj/korean-law-mcp`
(legislación coreana), `ravitemer/mcphub.nvim` (plugin de Neovim),
`ruvnet/ruflo`, `google-gemini/gemini-cli`.

Recuento por uso: DESARROLLO 26 + IA 23 + DEVOPS 7 + SEGURIDAD 5 + NAVEGADOR 4 =
**65 de 108 son herramientas de desarrollador**.

Falta del catálogo, en cambio, todo lo que un negocio pediría: reservas
(Cal.com/Calendly), CRM, cobros, facturación, WhatsApp Business, Google My
Business, catálogo de producto.

## Por qué no es inofensivo dejarlo

Una skill sin `instructions` y sin `mcpUrl` **igualmente inyecta una línea en el
system prompt** del agente que la tenga instalada (`engine.ts:257-260`):

```
- ${name}: ${description}
```

Con este catálogo eso son descripciones en inglés copiadas de GitHub. Tokens
pagados en cada turno a cambio de confundir al modelo con facultades que no
existen. Hoy no duele porque hay 0 instaladas; duele el día que alguien instale.

Y el coste comercial: el operador abre la pestaña Skills, ve `unreal-mcp` y
`kubefwd`, y concluye que el producto no es para su negocio.

## Alcance

1. **Backup completo** de las 108 filas a un JSON versionado antes de tocar nada.
2. **Borrado** de las 97 filas no viables mediante script puntual.
3. **Documentar el criterio** de curación para que la próxima importación no
   repita el error.

## Qué se queda (11 filas)

| Skill | Uso | Por qué |
|---|---|---|
| `taylorwilsdon/google_workspace_mcp` | OFIMÁTICA | Gmail/Calendar/Drive. Redundante con nuestro OAuth propio (`oauth.ts:28-29`), pero es el único caso ya viable |
| `exa-labs/exa-mcp-server` | BÚSQUEDA | Búsqueda web para un agente que responde dudas |
| `deedy5/ddgs` | BÚSQUEDA | Búsqueda web sin coste por consulta |
| `firecrawl/firecrawl-mcp-server` | WEB SCRAPING | Ingerir la web del cliente como conocimiento |
| `brightdata/brightdata-mcp` | WEB SCRAPING | Igual, con proxy |
| `haris-musa/excel-mcp-server` | DOCUMENTOS | Leer/escribir el Excel del negocio |
| `Zipstack/unstract` | DOCUMENTOS | Extraer datos de PDFs (facturas, albaranes) |
| `antvis/mcp-server-chart` | ANALÍTICA | Gráficas en informes al cliente |
| `stickerdaniel/linkedin-mcp-server` | RRHH | Sólo para un vertical de selección |
| `punitarani/fli` | VIAJES | Sólo para un vertical de agencia de viajes |
| `rusq/slackdump` | MENSAJERÍA | **Única skill con `toolsProvider` (`slack`)**: el único ejemplo vivo del contrato skill→facultad. Sin ella no queda nada contra lo que probar ese camino |

Las diez primeras son la clasificación A+B del análisis del catálogo. La undécima
(`slackdump`) estaba en el grupo a borrar y se rescata por la razón de la tabla:
es la única fila que ejercita `TOOLS_BY_PROVIDER`.

## Fuera de alcance

- **Añadir** las skills que faltan (reservas, CRM, cobros). Es otro cambio: aquí
  sólo se quita.
- Curar `instructions` o `mcpUrl` de las 11 que se quedan. Siguen sin cuerpo
  curado; seguirán inyectando su línea de descripción. Se anota como deuda.
- Tocar el importador de GitHub que metió las 108. Se documenta el criterio; no
  se cambia el código de importación.
- Añadir un endpoint `DELETE /api/skills/:id`. No existe hoy y no se crea: una
  purga puntual no justifica una superficie de API destructiva permanente.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Borrado irreversible de datos de producción | Backup JSON completo de las 108 filas **antes** de borrar, versionado en el repo. El script no borra si el backup no se escribió |
| Borrar una skill instalada en un agente | `agente_skill = 0` verificado en producción. El script **aborta** si encuentra cualquier `AgentSkill` apuntando a una fila a borrar, en vez de arrastrarla en cascada |
| El criterio de curación es opinión mía | Va escrito en `design.md` y la lista de las 11 supervivientes está enumerada por nombre exacto en el script, no derivada de una heurística |
| Alguien vuelve a importar las 108 | Fuera de alcance arreglarlo, pero el criterio queda documentado |

## Dependencias

Ninguna. No hay migración: se borran filas, no se cambia el schema.

## Gate humano

Es un borrado en producción. **No se ejecuta sin OK explícito de Adrián.**
