# Diseño — aa-openclaw-runtime-fail-closed

## D1 — Por qué fail-closed y no fail-soft

`admin-rpc.ts` es fail-soft a propósito: su comentario lo dice —"el llamador NUNCA debe romper la
petición HTTP del usuario porque el gateway de OpenClaw esté caído"—. Eso es correcto **ahí**,
porque el aprovisionamiento es un efecto de fondo: si no se puede configurar el gateway, guardar el
agente debe seguir funcionando.

El camino de chat es lo contrario. Ahí el gateway no es un extra: es quien produce la respuesta. No
hay nada que degradar. Las dos únicas salidas son un error explícito o un error opaco, y hoy tenemos
el opaco. Fail-closed no añade un fallo nuevo; le pone nombre al que ya ocurre.

Rechazado: caer al cliente de la plataforma cuando OpenClaw no está disponible. Sería el mismo
fallback silencioso que `getClientForAgent` ya prohíbe para byok (`openai.ts:183-185`, "NUNCA cae al
cliente de la plataforma"), y por la misma razón: convertiría "el cerebro es mío y local" en "gasto
el dinero del propietario" sin que nadie lo decida. Además haría invisible el problema, que es
justamente lo que hay que arreglar.

## D2 — Status 503, y por qué no otro

Se sigue el precedente que ya existe en el repo para exactamente este caso —dependencia externa sin
configurar— en `src/lib/automations/import.ts:129`:

```ts
throw new HttpError(503, "n8n no está configurado (N8N_BASE_URL/N8N_API_KEY)");
```

Descartados, con motivo:

- **402** — lo reserva H1 para el corte de servicio del tenant, y `webhook-shared.ts:34` propaga su
  texto al usuario final del canal. Un fallo de configuración nuestro pasaría por "no has pagado".
- **403** — lo usa `assertAgentServable` para el estado del agente (no publicado, archivado). El
  agente aquí está perfectamente publicable; lo que falta es infraestructura.
- **500** — es lo que ya pasa hoy, y no distingue "no configurado" de "el modelo ha reventado".

Lo que arrastra el 503, verificado:

| Consumidor | Comportamiento con 503 |
|---|---|
| `visitorError` (`visitor-error.ts:86`) | `status >= 500` ⇒ `CUALQUIER_5XX` ⇒ el visitante lee el texto genérico. El nombre de la variable de entorno **no** sale |
| `ai.ts:117` | `status >= 500` ⇒ `captureError` a Sentry. Correcto: es avería nuestra |
| `channelErrorMessage` (`webhook-shared.ts:34`) | sólo propaga texto en 402 ⇒ Telegram/WhatsApp dan mensaje genérico |
| Consola del operador (`ai.ts`, `esOperador`) | lee el mensaje real, con los nombres de las variables |

## D3 — Qué se exige exactamente

Ambas variables, no sólo la URL:

- `OPENCLAW_BASE_URL` — sin ella no hay a dónde ir. Es el fallback que se elimina.
- `OPENCLAW_GATEWAY_TOKEN` — `spike.md §1` verificó que el gateway exige `Authorization: Bearer`.
  Sin token, el SDK de OpenAI ni siquiera llega a la red: lanza por `apiKey` ausente con un mensaje
  que habla de `OPENAI_API_KEY`, una pista falsa que apunta al proveedor equivocado.

Se comprueba en un helper propio en `openai.ts` en lugar de importar `isConfigured()` de
`admin-rpc.ts` por dos razones: ese helper exige `OPENCLAW_ADMIN_URL`/`OPENCLAW_GATEWAY_PASSWORD`,
que son las del admin y no las del chat; e importar ese módulo metería `node:child_process` en el
camino caliente del chat.

## D4 — Lo que NO cambia

- La prioridad del `model` efectivo (`OPENCLAW_AGENT_ID` → `openclaw/aa-<agentId>` →
  `openclaw/default`) se queda igual.
- `isOpenclaw: true` y el `user: conversationId` de `engine.ts:439-480` se quedan igual.
- El puerto `18791` desaparece del código como default, pero sigue siendo el correcto para el
  contenedor `OpenClaw_Agents_3A`: quien levante el gateway pone
  `OPENCLAW_BASE_URL=http://localhost:18791/v1` y todo funciona como antes.
- Ni una línea del subsistema OpenClaw se borra. El runtime sigue cableado.

## D5 — El cambio de dato en producción

Tres filas, una columna: `runtime` de `"openclaw"` a `"openai"`.

- No se toca `ecommerceConfig.openclawProvisioning`: es el registro histórico de por qué esto falló y
  sirve de evidencia. Que quede `status: "failed"` en un agente ya migrado es correcto —describe el
  pasado, no el presente.
- No se toca `status`: los tres siguen en `draft`. Publicarlos es otra decisión, y no la toma este
  cambio.
- `model` se queda como esté: para `runtime="openai"` decide el proveedor (`providerForModel`), y si
  está vacío rige el default de la plataforma.
- Reversible con un `update` de la misma columna. Los ids quedan en `tasks.md`.

## Ficheros

| Fichero | Cambio |
|---|---|
| `back/src/lib/openai.ts` | Quitar el fallback `?? "http://localhost:18791/v1"`; helper de configuración; `HttpError(503, …)` |
| `back/tests/openclaw-runtime-fail-closed.test.ts` | Nuevo. Cubre E1-E5 |
| `openspec/changes/aa-openclaw-brain/spike.md` | Nota de que el puerto documentado (`:18790`) es del contenedor anterior |
| producción (BD) | `runtime` de 3 agentes |

## Estrategia de prueba

Unitaria sobre `getClientForAgent`, manipulando `process.env` y restaurándolo. Es la frontera exacta
del cambio y no necesita ni red ni BD. Un test debe fallar contra el `openai.ts` de HEAD —si pasa,
no está midiendo nada—. El caso "con env definida" es la no-regresión: prueba que quien levante el
gateway mañana no encuentra nada roto.
