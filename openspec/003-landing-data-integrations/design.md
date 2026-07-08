# Design

## Architecture
El flujo se apoya en un patrón Headless "sin backend intermedio". 
En lugar de que la Landing llame a una base de datos (Firebase) mediante SDKs, o a un backend local que haga proxy a la base de datos (requiriendo Node.js), la landing hará peticiones directas de CORS a la API del CRM o a un Webhook.

## Data Flow
### Flujo 1: Creador CRM (Fase 3)
1. Usuario elige "Creador CRM" en `PromptPicker`.
2. `landing.ts` recupera `project.business` (el ID del tenant) y se lo pasa a `generateFiles`.
3. `generator.ts` instruye al LLM que inserte un `fetch` hacia `/public/leads` adjuntando `{ businessId }`.
4. El HTML resultante funciona como cliente independiente.

### Flujo 2: Webhooks (Fase 4)
1. Usuario elige "Webhook / n8n" en `PromptPicker`.
2. `generator.ts` instruye al LLM que inserte un `fetch` hacia `WEBHOOK_URL_PLACEHOLDER`.
3. En el `SetupWizard.tsx`, el usuario provee su URL real.
4. Al hacer click en "Aplicar", una expresión regular (`.replace`) busca el placeholder y lo sobreescribe en crudo en el archivo estático antes de guardar/descargar.

## File Changes (Fases 3 y 4 combinadas)
- `agents-agency/back/src/lib/landing/interview.ts`: Reescritura del texto conversacional (fallback).
- `agents-agency/back/src/lib/landing/generator.ts`: Adición de tipos `creador-crm` y `webhook` con sus system prompts.
- `agents-agency/back/src/routes/landing.ts`: Inyección de `project.business`.
- `agents-agency/back/src/lib/landing/data-layer.ts`: Ajuste para reenvío del `businessId`.
- `agents-agency/front/components/landing/PromptPicker.tsx`: Selector UI.
- `agents-agency/front/app/landing-builder/[id]/page.tsx`: Selector UI secundario.
- `agents-agency/front/components/landing/SetupWizard.tsx`: Inyección Regex de `WEBHOOK_URL`.
