# Proposal: Landing Data Integrations (CRM & Webhooks)

## Intent
Integrar el Landing Builder (`agents-agency`) con múltiples capas de datos (Data Layers) de forma nativa. 
El objetivo es permitir que el código generado (estático) pueda comunicarse directamente con una API externa sin requerir infraestructura adicional por parte del cliente, usando simples peticiones `fetch`.

## Scope
Soportar dos nuevas modalidades principales (además de Firebase/Supabase/Local):
1. **Creador CRM (Fase 3):** Envío directo de leads a la cuenta del cliente en OperaOS.
2. **Webhooks / n8n (Fase 4):** Envío directo de leads a flujos de automatización externos (n8n, Make, Zapier).

## Risks
- La inyección de variables (`businessId`, `WEBHOOK_URL`) en código generado por LLM debe ser determinista.
- Si el código no está bien formado, el `fetch` podría fallar silenciosamente en el HTML estático.

## Dependencies
- Requiere que la API Pública de Creador CRM (`/public/leads`) esté operativa (Completado en Fase 2).
