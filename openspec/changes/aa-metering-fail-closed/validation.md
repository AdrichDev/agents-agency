# Validation — aa-metering-fail-closed

## Historia de usuario

> Como propietario de la plataforma que **paga el LLM de sus clientes**, quiero que ningún
> agente pueda consumir tokens sin tenant asignado y sin cupo comprobado, por ningún canal,
> para poder vender sin exponerme a coste ilimitado e invisible.

## Criterios de aceptación

- **AC1** — Un agente sin `tenantId` no consume LLM por ningún canal: responde 402 y el
  cliente LLM no llega a invocarse.
- **AC2** — Un agente con tenant bloqueado (`isActive = false` o cupo agotado) es cortado en
  **los tres** canales: widget/API, Telegram y WhatsApp.
- **AC3** — El consumo por Telegram y WhatsApp queda registrado en `uso_tokens` y descuenta
  cupo, sin que el llamador tenga que pasar `clientId`.
- **AC4** — La consola de pruebas (`isTest`) sigue funcionando con agentes sin tenant.
- **AC5** — Regresión cero en el camino feliz: agente con tenant y cupo se comporta igual que
  antes en los tres canales.
- **AC6** — El widget recibe **402** (no 500) cuando el motivo es límite de uso.
- **AC7** — Este change no incluye migración de base de datos.
- **AC8** *(añadido durante la implementación)* — La exención de la consola sólo es invocable
  con sesión de operador: `test: true` desde un llamador anónimo no exime de nada.
- **AC9** *(añadido durante la implementación)* — Un tenant desactivado deja de ser atendido
  por completo, incluido el flujo de captación de lead que no gasta tokens.
- **AC10** *(añadido tras `sdd-verify`)* — **Todo** consumo de LLM queda registrado, incluido el
  de las automatizaciones y el cron, que no pasan por `chatWithAgent`.
- **AC11** *(añadido tras `sdd-verify`)* — Ningún identificador interno de tenant sale por la
  ruta pública `POST /api/chat`.
- **AC12** *(añadido tras `sdd-verify`)* — La exención de la consola es acotada: dispensa de
  *tener* tenant, nunca del cupo ni del kill switch de un tenant que sí existe.

## Escenarios (Given-When-Then) — uno por tarea

### T1.1 — Gate fail-closed

```gherkin
Escenario: agente sin tenant es rechazado
  Dado un tenantId ausente (null o undefined)
  Cuando se llama assertUsageAllowed(tenantId)
  Entonces lanza HttpError con status 402

Escenario: la consola de pruebas está exenta
  Dado un tenantId ausente
  Cuando se llama assertUsageAllowed(tenantId, { isTest: true })
  Entonces no lanza y devuelve null

Escenario: tenant sin cupo propaga el corte
  Dado un tenant con tokensUsed >= tokenBalance
  Cuando se llama assertUsageAllowed(tenantId)
  Entonces lanza HttpError 402 procedente de checkClientBalance

Escenario: tenant con cupo pasa
  Dado un tenant activo con cupo disponible
  Cuando se llama assertUsageAllowed(tenantId)
  Entonces devuelve ese tenantId
```

### T2.1 — Gate antes del gasto

```gherkin
Escenario: no se gasta antes de cortar
  Dado un agente con tenantId null
  Cuando se invoca chatWithAgent sobre ese agente sin flag de test
  Entonces se lanza 402
    Y el cliente LLM no ha sido invocado ninguna vez
```

### T2.3 — Regresión del fail-open por canal (el bug grave)

```gherkin
Escenario: Telegram descuenta sin que el llamador pase clientId
  Dado un agente cuyo tenantId es "tenant-1" con cupo disponible
  Cuando el webhook llama chatWithAgent(agentId, texto, convId, "telegram") sin 5º parámetro
  Entonces la respuesta se produce con normalidad
    Y deductTokens ha sido llamado con "tenant-1" y los tokens consumidos
```

### T2.2 / exención en runtime

```gherkin
Escenario: prueba de agente huérfano no descuenta
  Dado un agente con tenantId null
  Cuando se invoca chatWithAgent con isTest = true
  Entonces responde con texto del asistente
    Y deductTokens no ha sido llamado
```

### T3.1 — Status correcto en la ruta pública

```gherkin
Escenario: el widget recibe 402 y no 500
  Dado un agente publicado por publicKey cuyo tenant está bloqueado
  Cuando se hace POST /api/chat con ese publicKey
  Entonces la respuesta tiene status 402
    Y el cuerpo contiene el motivo de límite de uso
```

### T3.2 — Webhooks no rompen el proveedor

```gherkin
Escenario: Telegram no entra en bucle de reintentos
  Dado un agente de Telegram cuyo tenant está bloqueado
  Cuando llega un update al webhook
  Entonces el webhook responde 200 con {ok: true}
    Y el mensaje enviado al usuario indica servicio no disponible, no error genérico
```

### T2.4 — El kill switch corta el servicio, no sólo el gasto (hallazgo)

```gherkin
Escenario: tenant desactivado no crea conversación ni atiende
  Dado un agente cuyo tenant tiene isActive = false
  Cuando se invoca chatWithAgent sobre ese agente
  Entonces se lanza 402
    Y prisma.conversation.create no ha sido llamado
    Y el cliente LLM no ha sido invocado
```

### T3.3 — `test: true` no es un bypass en la ruta pública (hallazgo de seguridad)

```gherkin
Escenario: sin sesión el flag de prueba se ignora
  Dado que POST /api/chat está en la allowlist pública
  Cuando llega {publicKey, message, test: true} sin sesión
  Entonces el motor recibe isTest = false
    Y por tanto el gate de saldo se aplica igual

Escenario: con sesión de operador el flag se honra
  Dado un operador autenticado (req.user presente)
  Cuando envía {agentId, message, test: true}
  Entonces el motor recibe isTest = true
```

### T4.1 — Inventario

```gherkin
Escenario: inventario de huérfanos es sólo lectura
  Dada una base de datos con agentes, algunos sin tenantId
  Cuando se ejecuta scripts/inventory-orphan-agents.ts
  Entonces imprime la lista de agentes sin tenant con su nº de conversaciones no-test
    Y no ejecuta ninguna escritura
```

### T5.1 — Suite existente

```gherkin
Escenario: no se rompe lo que ya estaba verde
  Dado el suite de back con los mocks de token-metering actualizados
  Cuando se ejecuta npm test
  Entonces todos los tests pasan y no hay skips nuevos
```

### T6.1 — el consumo de las automatizaciones se contabiliza (AC10)

```
Dado un agente con tenant asignado y una automatización programada
Cuando la automatización se ejecuta y el modelo consume 88 tokens
Entonces se descuentan del cupo del tenant y se registra en uso_tokens
  con operacion = "automation"
```

### T6.2 — el tenant interno no sale por la ruta pública (AC11)

```
Dado un widget que conversa por POST /api/chat con la clave pública
Cuando el motor resuelve internamente el tenant para poder cobrarle
Entonces la respuesta que recibe el widget no contiene meteredTenantId
  y el cobro se hace igualmente contra el tenant real
```

### T6.3 — la exención de la consola no cubre el kill switch (AC12)

```
Dado un agente cuyo tenant está desactivado por impago
Cuando un operador autenticado lo prueba desde la consola (isTest)
Entonces recibe 402 igual que cualquier canal, y no se le carga consumo
```

## Verificación final

| Check | Cómo |
|---|---|
| V1 typecheck | `npx tsc --noEmit` en `back/` |
| V2 suite | `npm test` en `back/` |
| V3 regresión camino feliz | tests por canal con tenant y cupo |
| V4 sin migración | `back/prisma/migrations/` sin ficheros nuevos |
| V5 revisión | `sdd-verify` antes de proponer commit |

## Gate humano (no automatizable)

**RESUELTO el 27/07/2026.** El inventario se ejecutó contra producción y devolvió 3 agentes
huérfanos, los tres "CRM EUROFORMACIA" (03–04/07/2026), duplicados de pruebas: 0/0/1
conversaciones reales y **ninguno con widget instalado**. El propietario confirma que son
mocks y decide no asignarles tenant. Con eso el fail-closed **no deja sin servicio a ningún
agente de cliente** — sólo vuelve inertes esos tres.

La limpieza (`npm run delete:orphans`, dry-run por defecto) es opcional y posterior: no
condiciona el despliegue. Su ejecución en producción corresponde al propietario; Gru no tiene
credenciales (Supabase MCP responde `Unauthorized: falta SUPABASE_ACCESS_TOKEN`).
