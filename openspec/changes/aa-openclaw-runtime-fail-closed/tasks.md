# Tareas — aa-openclaw-runtime-fail-closed

Nivel 2. Un fichero de código en el camino de servicio, más una escritura en producción sobre 3
filas. Todo reversible. Una tarea está hecha sólo cuando su prueba está verde.

## T1 — El runtime openclaw falla diciendo qué falta

- [x] **T1.1** Helper `openclawGatewayMissing()` en `openai.ts`: exige `OPENCLAW_BASE_URL` y
      `OPENCLAW_GATEWAY_TOKEN`. Local, sin importar `admin-rpc.ts` (ver §D3).
      *Test:* E1 ✅, E2 ✅.
- [x] **T1.2** `HttpError(503, …)` nombrando las variables ausentes, siguiendo el precedente de
      `automations/import.ts:129`. Fuera el `?? "http://localhost:18791/v1"`.
      *Test:* E3 ✅.
- [x] **T1.3** El camino configurado no cambia: mismo `baseURL`, mismo `model` efectivo,
      `isOpenclaw: true`. Un agente `openai` ni se entera.
      *Test:* E4 ✅, E6 ✅.

**Nota de implementación:** las pruebas viven en `tests/openai-agent-client.test.ts`, no en un
fichero nuevo como decía §Ficheros del diseño. Es el fichero de esta factory, comparte el mock del
SDK, y ahí estaban ya los casos de no-regresión (E4, E6) que había que conservar intactos.

## T2 — Los tres agentes de cliente dejan de estar mudos

- [x] **T2.1** `runtime` de `"openclaw"` a `"openai"` en producción. `status`, `model` y
      `ecommerceConfig.openclawProvisioning` no se tocan (§D5).

      Ids para revertir:

      | Agente | id | publicKey |
      |---|---|---|
      | Agente EDM San Blas | `cmrplc5di00070ucfn31es9lm` | `cmrplc5di00080ucfdfo2on6e` |
      | Agente Caress Centro Estético | `cmr9l2ohv0000b8fxmjy33gp7` | `cmr9l2ohv0001b8fxjddwnbd7` |
      | Agente JorjotasBarber | `cmr9msm7i0000fkfx23vpmao6` | `cmr9msm7i0001fkfxzrym1s9z` |

      Revertir: `UPDATE` de `runtime` a `"openclaw"` sobre esos tres ids.
      *Verificación:* ✅ aplicado el 27/07/2026 con un `updateMany` acotado por
      `{ id: { in: [...] }, runtime: "openclaw" }`. `filas actualizadas: 3`. Lectura posterior:

      | runtime | status | model | agente |
      |---|---|---|---|
      | `openai` | `draft` | `gpt-4.1-nano` | Agente Caress Centro Estético |
      | `openai` | `draft` | `gpt-4.1-nano` | Agente JorjotasBarber |
      | `openai` | `draft` | `gpt-5.4-mini` | Agente EDM San Blas |

      `agentes que siguen en runtime="openclaw": 0`. Los tres ya tenían un `model` de OpenAI
      válido, así que no hubo que tocar ninguna otra columna. Siguen en `draft`: publicarlos es
      otra decisión.

## T3 — Verificación

- [x] **T3.1** Rojo-verde contra el `openai.ts` de HEAD: **3 rojos** (E1, E2, E3) y 8 verdes. E4 y
      E6 ya pasaban, y debían — describen lo que no se rompe.
- [x] **T3.2** `npx tsc --noEmit` EXIT=0. Suite completa: **142/142 ficheros, 1627 pruebas verdes**
      (1624 antes del cambio, +3), 3 omitidas.
- [x] **T3.3** Revisión antes de commitear. Ver "Hallazgos de la revisión".
- [x] **T3.4** Nota en `aa-openclaw-brain/spike.md`: el `:18790` documentado es del contenedor
      anterior `OpenClaw_Agents`; el actual `OpenClaw_Agents_3A` publica `18791->18789`.

## Hallazgos de la revisión (T3.3)

- **6 de los 9 tests de `openai-agent-client.test.ts` borraban las `OPENCLAW_*` a propósito** y
  esperaban un cliente de vuelta. Uno de ellos —`baseURL/apiKey del gateway por defecto`— afirmaba
  literalmente `baseURL: "http://localhost:18791/v1"`: **codificaba el defecto**. Se reescribió con
  el gateway configurado, que es lo que quería medir (cliente nuevo, no el singleton). Los otros
  cinco miden el routing del `model` y siguen midiendo exactamente lo mismo: se les dio la
  precondición nueva vía `conGatewayConfigurado()`, sin relajar ni una aserción.
- **Una aserción propia mal planteada, corregida.** E1 empezó con
  `expect(OpenAICtor).not.toHaveBeenCalled()`, que falla siempre: el constructor ya se invoca al
  importar el módulo para construir el singleton de la plataforma. Sustituido por un conteo
  antes/después, que es lo que se quería decir — que la rama `openclaw` no añade ninguna
  construcción contra `localhost`.
- **El 503 no puede tumbar el cron de reconcile.** Único llamador de `getClientForAgent` en `src/`:
  `engine.ts:449`, el camino de chat. `openclaw/provision.ts` y `openclaw/reconcile.ts` no pasan por
  ahí y conservan su fail-soft noop.
- **Ningún otro test de OpenClaw se vio afectado** (`telegram-webhook-openclaw`,
  `channels-openclaw-handover`, `agent-create-openclaw`, `openclaw-provision`, `openclaw-admin-rpc`):
  verdes sin tocarlos.
- **Nada de OpenClaw se ha borrado.** El runtime sigue cableado de punta a punta: `Agent.runtime`, la
  factory, el aprovisionamiento F2, el reconcile y los canales. Para levantarlo en servidor basta
  con definir `OPENCLAW_BASE_URL`/`OPENCLAW_GATEWAY_TOKEN` y volver a poner `runtime="openclaw"`.

## G — Gates humanos

- [x] **G1** Aprobación del alcance (código + migración, conservando el cableado openclaw).
      ✅ 27/07/2026: "Haz las dos, de momento seguimos dejando openclaw cableado por si a futuro lo
      levantamos en servidor".
- [x] **G2** Aprobación para desplegar el back. ✅ 27/07/2026: "Si si tiene saldo ya, despliega el
      back con el fix". Merge `770d367` en `master`, empujado. Pointer del repo raíz `f6c9917`
      (local: la raíz no tiene remote, por diseño).

      **Qué se verificó contra producción real**, con `Origin: https://cliente.example`:

      | Caso | `aa-back-jmyo.onrender.com` |
      |---|---|
      | `/health` | `200` · `{"status":"ok",…}` |
      | Despliegue efectivo | `uptime` no monótono: `116s` (proceso viejo) → `66s` (nuevo). Firma del deploy solapado de Render. Arranque del proceso servido 72 s **posterior** al commit |
      | **AiAs** publicado (camino `openai`) | `200` · `"Hola, ¿en qué puedo ayudarte hoy?"`, `gpt-5.4-mini`, 1257 tokens, 3287 ms — sin regresión |
      | Agente EDM San Blas (migrado, `draft`) | `403` · `AGENT_UNAVAILABLE` — no un 500: su camino no revienta tras la migración |

      **Lo que NO se pudo verificar en producción, y por qué:** el 503 no es provocable, porque
      exige un agente `runtime="openclaw"` y ya no queda ninguno — que es justo el objetivo de este
      cambio. Su cobertura es E1-E3 (unitarias), con rojo-verde comprobado. Los 72 s entre commit y
      arranque, por sí solos, no descartaban un cold start del build anterior; lo que lo descarta es
      el reemplazo de proceso observado.

## Orden crítico

```
T1.1 → T3.1 → T1.2 → T1.3 → T3.2 → T3.3 → T2.1 (prod) → T3.4 → [G2 desplegar]
```

## Fuera de alcance, anotado como deuda

- **Validar en la publicación (H3) que un agente `openclaw` tenga gateway alcanzable.** Es la red de
  seguridad natural de este defecto: hoy nada impide publicar un agente que no puede responder. Este
  cambio lo hace visible en el primer mensaje, no antes.
- **Levantar OpenClaw en un servidor accesible** (infraestructura). Mientras no ocurra, ningún agente
  de cliente debería volver a `runtime="openclaw"`.
- **La puerta de calidad del 8B** de `aa-openclaw-brain` sigue vigente para ese momento: `qwen3:8b`
  tiene historial de respuestas vacías y elección errónea de herramienta en este stack.
- **`OPENCLAW_AGENT_ID` es un override global**: si se define, los tres agentes hablarían con el
  mismo agente OpenClaw, pisando el target per-agente de F2. Hoy está ausente. No se toca aquí.
