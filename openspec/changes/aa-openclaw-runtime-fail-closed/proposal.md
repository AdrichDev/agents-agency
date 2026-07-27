# Propuesta — aa-openclaw-runtime-fail-closed

## Intención

Que un agente con `runtime="openclaw"` deje de fallar de forma opaca cuando el cerebro OpenClaw no
está alcanzable, y que los tres agentes de cliente que hoy están mudos por ese motivo respondan con
el LLM de la plataforma. El cableado de `openclaw` se conserva íntegro para cuando el gateway se
levante en un servidor.

## El problema, con evidencia

`getClientForAgent` (`back/src/lib/openai.ts:194`) resuelve el gateway así:

```ts
baseURL: process.env.OPENCLAW_BASE_URL ?? "http://localhost:18791/v1",
```

Ese `??` es el fallo. En Render, `localhost` es el propio contenedor del back, donde no hay ningún
gateway escuchando. La llamada muere en `ECONNREFUSED`, sube como error sin `status`, y
`visitorError` la clasifica —correctamente— como `500 / INTERNAL`. Consecuencias:

- el visitante lee "Ahora mismo no puedo responder", que es cierto pero no accionable;
- el operador lee `fetch failed`, que no menciona OpenClaw ni la configuración ausente;
- Sentry recibe la avería como error interno del producto, cuando es una dependencia sin configurar.

El resto del subsistema OpenClaw **ya no hace esto**. `admin-rpc.ts` deriva su host de
`OPENCLAW_BASE_URL` y, si falta, devuelve `noop: OPENCLAW_ADMIN_URL/OPENCLAW_GATEWAY_PASSWORD
missing` sin salir a la red. La asimetría es el defecto: el aprovisionamiento se rinde limpio y lo
anota, mientras el camino de chat sigue adelante contra un host inventado.

Evidencia recogida el 27/07/2026:

| Hecho | Cómo se comprobó |
|---|---|
| El gateway está caído hace 5 días | `docker ps -a`: `OpenClaw_Agents_3A` en `Exited (255)`, con `openclaw_3a_postgres` y `openclaw_3a_n8n` igual |
| El único contenedor OpenClaw en marcha es de otro stack | `openClaw_Wabiks_engine` Up, columna Ports vacía ⇒ sin puertos publicados, inalcanzable incluso desde el host |
| El aprovisionamiento ya se rindió y lo dejó escrito | los 3 agentes con `ecommerceConfig.openclawProvisioning.status = "failed"`; dos por `noop: OPENCLAW_ADMIN_URL/OPENCLAW_GATEWAY_PASSWORD missing` (17/07 y 15/07), uno por `http 404` (06/07) |
| El puerto `18791` del código es correcto | `OpenClaw_Agents_3A` publica `0.0.0.0:18791->18789/tcp`. Lo desactualizado es `aa-openclaw-brain/spike.md`, que documenta `:18790` del contenedor anterior `OpenClaw_Agents` |

Deducción, no lectura directa: que el cron de reconcile anotara `missing` sugiere que en Render no
hay `OPENCLAW_*` definidas. No hay acceso al panel de env de Render para confirmarlo, y el cambio no
depende de ello: con o sin esas variables, un `localhost` en Render no lleva a ningún gateway.

## Lo que NO es un bug

`aa-openclaw-brain` diseña OpenClaw como cerebro **local** (Ollama en la máquina del propietario) con
agents-agency como plano de control. El producto se sirve desde Render. Un agente `runtime="openclaw"`
sólo puede responder si esa máquina está encendida y expuesta. Eso es un modelo de despliegue
incompatible con vender el agente, no una línea de código equivocada. Este cambio **no** lo resuelve:
hace que el fallo sea legible y saca a los clientes reales de esa vía.

## Alcance

1. **`getClientForAgent`**: sin fallback a `localhost`. Si `runtime="openclaw"` y falta
   `OPENCLAW_BASE_URL` o `OPENCLAW_GATEWAY_TOKEN`, lanzar `HttpError(503, …)` nombrando las
   variables, igual que `automations/import.ts:129` hace con n8n.
2. **Dato en producción**: pasar a `runtime="openai"` los 3 agentes de cliente hoy mudos
   —Agente EDM San Blas, Agente Caress Centro Estético, Agente JorjotasBarber—, con los ids
   registrados para poder revertir.

## Fuera de alcance

- Levantar OpenClaw en un servidor accesible (infraestructura, decisión del propietario). El
  cableado `runtime="openclaw"` se conserva entero para ese momento: ni una línea de OpenClaw se
  borra.
- Corregir el puerto de `spike.md`. Es documentación de un spike fechado; se anota aquí y basta.
- Validar en la publicación (H3) que un agente `openclaw` tenga gateway antes de poder publicarse.
  Es la red de seguridad natural de este defecto y queda anotada como deuda.
- La puerta de calidad del 8B de `aa-openclaw-brain`: sigue vigente para cualquier agente que
  vuelva a `runtime="openclaw"` en el futuro.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El 503 rompe un flujo que hoy "funciona" en local con el gateway levantado | Con `OPENCLAW_BASE_URL` definida el comportamiento es idéntico al actual. Sólo cambia el caso sin configurar, que hoy falla igual pero peor |
| Un 503 propagado a canales de mensajería filtra detalle interno | `channelErrorMessage` sólo propaga el texto en un 402; cualquier otro status da mensaje genérico. Verificado en `webhook-shared.ts:34` |
| El visitante del widget lee el nombre de una variable de entorno | Imposible: `visitorError` usa tabla cerrada por status y un 503 cae en `CUALQUIER_5XX`. El texto sólo lo ve el operador |
| El cambio de `runtime` en producción se pierde de vista | Los 3 ids quedan escritos en `tasks.md`; revertir es un `update` de una columna |

## Dependencias

- `aa-openclaw-brain` (F1/F2): define `Agent.runtime` y el aprovisionamiento. No se modifica.
- `aa-widget-error-visitante`: aporta que un 5xx no llega al visitante y sí a Sentry. Este cambio se
  apoya en él.
