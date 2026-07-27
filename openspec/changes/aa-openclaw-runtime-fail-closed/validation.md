# Validación — aa-openclaw-runtime-fail-closed

## Historia de usuario

Como propietario de la plataforma, quiero que un agente cuyo cerebro OpenClaw no está configurado
falle diciendo qué falta, y que los agentes de mis clientes no dependan de que mi máquina esté
encendida — sin perder el cableado de OpenClaw para cuando lo levante en un servidor.

## Criterios de aceptación

- **AC1** — Con `runtime="openclaw"` y sin `OPENCLAW_BASE_URL`, `getClientForAgent` lanza
  `HttpError` con status 503 y no construye ningún cliente contra `localhost`.
- **AC2** — El mensaje del error nombra las variables que faltan, para que el operador sepa qué
  poner. Ese texto no llega nunca al visitante: `visitorError` lo sustituye por el genérico.
- **AC3** — Con `OPENCLAW_BASE_URL` y `OPENCLAW_GATEWAY_TOKEN` definidas, el comportamiento es
  idéntico al de antes del cambio: mismo `baseURL`, mismo `model` efectivo, `isOpenclaw: true`.
- **AC4** — Los agentes con `runtime="openai"` no se ven afectados por nada de esto.
- **AC5** — Tras la migración, ninguno de los 3 agentes de cliente queda en `runtime="openclaw"`, y
  su `status` sigue siendo el que era (`draft`).

## Escenarios

### E1 — Sin `OPENCLAW_BASE_URL` no se sale a la red (AC1)
- **Dado** un agente `{ runtime: "openclaw", agentId: "ag_1" }` y `OPENCLAW_BASE_URL` sin definir
- **Cuando** se llama a `getClientForAgent`
- **Entonces** lanza `HttpError` con `status === 503`

### E2 — Sin `OPENCLAW_GATEWAY_TOKEN` tampoco (AC1)
- **Dado** `OPENCLAW_BASE_URL` definida pero `OPENCLAW_GATEWAY_TOKEN` ausente
- **Cuando** se llama a `getClientForAgent`
- **Entonces** lanza `HttpError` con `status === 503`, en vez de que el SDK lance hablando de
  `OPENAI_API_KEY`

### E3 — El mensaje es accionable para el operador y opaco para el visitante (AC2)
- **Dado** el error de E1
- **Cuando** se lee su `message`
- **Entonces** contiene `OPENCLAW_BASE_URL`
- **Y** `visitorError(error).error` es el texto genérico de 5xx, sin `OPENCLAW` ni `localhost`
- **Y** `visitorError(error).code === "INTERNAL"`

### E4 — Con el gateway configurado, nada cambia (AC3)
- **Dado** `OPENCLAW_BASE_URL=http://localhost:18791/v1` y `OPENCLAW_GATEWAY_TOKEN=t`
- **Cuando** se llama a `getClientForAgent` con `{ runtime: "openclaw", agentId: "ag_1" }`
- **Entonces** devuelve `isOpenclaw: true` y `model === "openclaw/aa-ag_1"`
- **Y** el `baseURL` del cliente es el de la variable

### E5 — El fallback a `localhost` ya no existe (AC1)
- **Dado** `OPENCLAW_BASE_URL` sin definir
- **Cuando** se inspecciona el código de `getClientForAgent`
- **Entonces** no queda ningún literal `localhost:18791` en `src/lib/openai.ts`
- *(se comprueba por el efecto: E1 lanza en vez de devolver un cliente)*

### E6 — Un agente `openai` no se ve tocado (AC4)
- **Dado** un agente `{ runtime: "openai" }` y ninguna variable `OPENCLAW_*`
- **Cuando** se llama a `getClientForAgent`
- **Entonces** devuelve el cliente de la plataforma con `isOpenclaw: false`, sin lanzar

## Mapa tarea → prueba

| Tarea | Prueba |
|---|---|
| T1.1 helper de configuración | E1, E2 |
| T1.2 `HttpError(503, …)` con mensaje accionable | E3 |
| T1.3 no-regresión del camino configurado | E4, E6 |
| T2.1 migración de los 3 agentes | verificación en BD (AC5), no unitaria |
| T3.1 rojo-verde | E1, E2, E3 deben fallar contra el `openai.ts` de HEAD |
