# Validación — generación IA del CRM vía AA

Regla: cada cambio OK solo con verificación en verde.

## Auth de servicio (seguridad)
Historia: el CRM (server-to-server) debe poder llamar SOLO los endpoints de generación
con un token de servicio, sin abrir el resto de la API.
AC: token correcto + path de generación → pasa; cualquier otra combinación → no.
- Given token correcto + POST /api/ai/marketing-plan|generate o /api/market-studies,
  When isServiceCall, Then true. (test: public-routes.test.ts ✓)
- Given token incorrecto / sin Bearer / token vacío, When isServiceCall, Then false. (✓)
- Given token correcto pero path NO de servicio (/api/agents) o método GET, Then false
  → el token NO abre el resto de la API. (✓)

## Endpoints de generación
Historia: "Generar con IA" del CRM obtiene contenido de la IA vía AA, sin cobrar al cliente.
AC: POST con {model,effort,prompt} → 200 {content, usage}; prompt vacío → 400.
- Given prompt válido, When POST /api/ai/generate (o marketing-plan), Then {content,usage}.
  (test: smoke OpenAI real ✓ — gpt-5.4-mini devolvió content + usage.total_tokens=15)
- Given prompt ausente, When POST, Then 400 "prompt requerido". (revisión de código ✓)
- SIN metering: no se toca tenant.tokensUsed ni TokenUsage (verificado: handlers no
  llaman deductTokens/checkClientBalance). (revisión ✓)

## Pendiente (requiere env del usuario)
- Smoke end-to-end CRM→AA con AA_SERVICE_TOKEN seteado en ambos.
