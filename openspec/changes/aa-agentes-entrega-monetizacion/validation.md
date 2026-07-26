# Validation — aa-agentes-entrega-monetizacion

Este change es un **plan maestro documental**: no produce código, así que su validación es
sobre la **calidad del plan**, no sobre comportamiento en runtime. Los escenarios
ejecutables y los tests reales pertenecen a cada openspec hijo (H1-H6), donde la regla del
repo aplica sin excepción: *tarea DONE sólo con test verde*.

## Historia de usuario

> Como responsable de AA, quiero un plan maestro verificado del eje entrega + monetización,
> para poder empezar a **vender** los agentes que ya sé fabricar sin exponerme a coste no
> acotado y sin rehacer lo que ya funciona.

## Criterios de aceptación (del plan)

- **AC1** — Cada afirmación del diagnóstico está respaldada por evidencia `file:line`
  verificada contra el código real, no por suposición.
- **AC2** — El plan distingue explícitamente lo que **ya funciona** (para no rehacerlo) de
  lo que **falta**. En particular deja registrado que el metering existe y corta con 402.
- **AC3** — El falso problema ("hace falta Cloudflare / hosting por agente") queda descartado
  por escrito con su razón, para cerrar la duda recurrente.
- **AC4** — La decisión de negocio del humano (`platform` **y** `byok` coexistiendo, con
  Anthropic incluido) gobierna el backbone y es rastreable en Engram.
- **AC5** — Los hijos están priorizados por impacto con dependencias explícitas, e
  identifican cuáles bloquean vender de verdad (H1 y H4).
- **AC6** — Los riesgos destructivos están declarados con su mitigación, en concreto que el
  fail-closed de H1 puede tumbar agentes huérfanos existentes en producción.
- **AC7** — El plan no contiene código, migraciones ni cambios en `back/` o `front/`.

## Escenario de validación (documental)

```gherkin
Escenario: el plan maestro es accionable y no se contradice con el código
  Dado el openspec "aa-agentes-entrega-monetizacion" cerrado
  Cuando se revisa cada punto de la auditoría de design.md §B contra el repositorio
  Entonces cada referencia file:line existe y dice lo que el documento afirma
    Y ningún hijo propone reimplementar checkClientBalance, uso_tokens,
      Tenant.isActive, encryptToken, getClientForAgent, widget.js ni la consola de pruebas
    Y el árbol de dependencias entre H1-H6 no tiene ciclos
    Y no hay ficheros modificados bajo back/ ni front/ en este change
```

## Verificación por tarea del plan maestro

| Tarea | Verificación | Estado |
|---|---|---|
| T0.1 Decisión de negocio | Observaciones Engram 994 + 995 existen; 995 corrige 994 en el punto del metering | ✅ |
| T0.2 Auditoría | 6 puntos en `design.md §B`, todos con `file:line` comprobado | ✅ |
| T0.3 Anatomía | 7 capas en `design.md §A`, con la capa cubierta o el hijo que la cubre | ✅ |
| T0.4 Backbone | P0/P1/P2 en `design.md §C` con impacto, coste, riesgo y dependencias | ✅ |
| T0.5 Aprobación humana | El humano confirma el orden y el hijo de arranque | ⬜ pendiente |
| T9 Engram | Decisión + auditoría persistidas | ✅ |
| T10 Confirmación de arranque | Hijo elegido y su openspec creado | ⬜ pendiente |

## Evidencia recogida (índice rápido)

Referencias que los hijos heredan y **no deben volver a investigar**:

| Hecho | Ubicación |
|---|---|
| Fail-open de metering | `back/src/routes/ai.ts:69` |
| `tenantId` opcional al crear | `back/src/routes/agents.ts:86` |
| `Agent.tenantId` nullable | `back/prisma/schema.prisma` (modelo `Agent`) |
| Metering que sí corta (402) | `back/src/lib/token-metering.ts:18-27` |
| Cupo y kill switch del tenant | `back/prisma/schema.prisma` (modelo `Tenant`: `saldo_tokens`, `tokens_usados`, `activo`) |
| Clientes LLM singleton por env | `back/src/lib/openai.ts:16-22` |
| Punto de extensión para BYOK | `back/src/lib/openai.ts:145` (`getClientForAgent`) |
| Routing por prefijo, sin `claude*` | `back/src/lib/openai.ts:25-26` |
| Patrón capa OpenAI-compatible (Gemini) | `back/src/lib/openai.ts:11` |
| Capacidades por familia de modelo | `back/src/lib/openai.ts:91` |
| Helper de cifrado reutilizable | `back/src/lib/integrations/oauth.ts:52` (`encryptToken`) |
| Embed del widget | `back/public/widget.js:3` |
| Resolución pública por `publicKey` | `back/src/routes/ai.ts:57-64` |
| Roles sin `tenantId` | `back/prisma/schema.prisma:23` |
| Middleware de autorización existente | `back/src/lib/auth.ts:107` (`requireRole`) |

## Fuera de alcance de esta validación

- Tests unitarios / de integración: pertenecen a H1-H6.
- Migraciones de base de datos: las declaran H1, H3, H4 y H5 en sus specs.
- Validación de precio o margen: es la primera tarea de H4 (medir coste real antes de
  proponer precio).
