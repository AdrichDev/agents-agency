# Validation

## User Story
Como dueño de una agencia, quiero que las landings generadas por la herramienta se conecten automáticamente al CRM o a herramientas de automatización como n8n, para que mis clientes reciban leads directamente sin necesidad de configurar bases de datos o código en servidores.

## Acceptance Criteria
- El builder ofrece 3 modalidades conversacionales para bases de datos: Informativo (nada), Webhooks (n8n), Creador CRM.
- La opción de Creador CRM inyecta estáticamente el `businessId` del proyecto de AA en el código `fetch()`.
- La opción de Webhook inyecta un placeholder que luego el Wizard reemplaza por la URL real provista por el usuario.
- El código resultante exportado es puramente estático (HTML/JS) y no requiere variables de entorno de un Node.js externo para funcionar.

## Scenarios
- **Given** a user wants to generate a CRM landing, **When** they select Creador CRM and generate the site, **Then** the `fetch` in `index.html` points to `api.tu-crm.com/public/leads` with the correct `businessId`.
- **Given** a user wants to generate a webhook landing, **When** they paste `https://n8n.webhook...` in the Setup Wizard and click Apply, **Then** the placeholder in `index.html` is replaced with the URL.

## Testing Strategy
- Manual E2E tests generating landings and checking the `index.html` content.
