# Diseño: espejo móvil del chat operador

## Enfoque técnico

`operator-chat.ts` ya envía cada turno del operador al gateway vía `chatSend` con la
`sessionKey` compartida (`agent:main:main`, la misma que Telegram). La incógnita es si el
gateway, al procesar `chat.completions` sobre esa sessionKey, empuja también el turno/respuesta
al canal Telegram enlazado, o si ese push solo ocurre para mensajes que entran POR Telegram.

Dos resultados posibles tras la reproducción (Fase A del `tasks.md`):

1. **El espejo ya es automático** (mismo mecanismo interno que hace que Telegram vea las
   respuestas del agente sin importar el canal de origen). En ese caso: no se toca código,
   solo se cierra la verificación y se marca 5.5d.
2. **No hay espejo automático** — el turno queda solo en la sesión, visible por `chat.history`,
   pero Telegram no recibe nada nuevo hasta que el usuario interactúa. En ese caso: se añade un
   fan-out explícito, análogo al patrón ya usado en `crm-telegram-fanout.ts` (5.4c) pero hacia
   el propio bot de Telegram del operador, usando el comando/RPC `message send --channel
   telegram` que la propia task 5.5d apunta como opción evaluada.

## Decisiones de arquitectura

| Decisión | Elección | Alternativas consideradas | Motivo |
|----------|----------|---------------------------|--------|
| Punto de fan-out (si hace falta) | `operator-chat.ts`, tras `chatSend` exitoso | Hacerlo del lado del gateway (config) | Mantiene el mismo patrón que 5.4c: AA orquesta el fan-out, no se modifica infra de OpenClaw. |
| No duplicar en historial | Reusar el filtro de delivery-mirror ya existente (`isDeliveryMirror`) | Crear un segundo mecanismo de filtrado | Evita divergencia; el filtro ya está probado (5.5a). |
| Modelo de IA para reproducir | Usar el configurado en el gateway (Gemini); NO forzar Ollama vía config | Cambiar `agents.defaults.model` para desbloquear el test | Cambiar el modelo de producción para un smoke test es una modificación de config fuera de alcance de esta spec — se espera a que el proveedor se recupere. |

## Flujo de datos

    Web operador (AA front)
            │ POST /api/operator-chat/send
            ▼
    AA back (operator-chat.ts) ──chatSend──▶ Gateway OpenClaw (sessionKey agent:main:main)
            │                                       │
            │                                       ├─▶ (¿automático?) Telegram Bot API
            │                                       │
            └── (si NO automático) ── message send --channel telegram ──▶ Telegram Bot API

## Cambios de archivos (solo si Fase B aplica)

- `agents-agency/back/src/routes/operator-chat.ts`: side-effect adicional tras `chatSend` OK.
- `agents-agency/back/tests/operator-chat.test.ts`: test nuevo cubriendo el fan-out a Telegram.

## Interfaces y contratos

- Reusa `chatSend`/`chatHistory` de `lib/openclaw/admin-rpc.ts` — sin cambios de contrato ahí.
- Si se añade el side-effect, no se introduce un nuevo endpoint público; es interno al handler
  de `/send`.

## Estrategia de pruebas

| Capa | Qué probar | Enfoque |
|------|------------|---------|
| Smoke manual | Mensaje web → visible en Telegram móvil | Manual, con proveedor de IA disponible |
| Back (si Fase B aplica) | Fan-out se invoca tras `chatSend` OK, no en fallo | Test unitario con mocks (mismo patrón que `operator-chat.test.ts`) |
| Regresión | `chat.history` no duplica el turno espejado | Reusa cobertura existente de `isDeliveryMirror` |

## Migración y despliegue

Ninguna migración de datos. Si Fase B aplica, es un cambio de código desplegable normal
(branch `ac/aa-centro-mando-phase6-openclaw-wizard`, sin tocar producción).

## Preguntas abiertas

- [ ] ¿El gateway hace catch-up de mensajes al abrir Telegram si el móvil no estaba activo en
      el momento del envío?
