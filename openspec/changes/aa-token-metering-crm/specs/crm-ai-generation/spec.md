# Especificaci?n ? CRM AI Generation

## Purpose

Define el contrato para que el CRM invoque generaci?n IA en AA mediante llamadas server-to-server con token de servicio, sin consumir cupos ni registrar metering por tenant.

## Requirements

### Requirement: Autenticaci?n de servicio limitada

El sistema MUST aceptar `Authorization: Bearer <AA_SERVICE_TOKEN>` ?nicamente para `POST /api/ai/marketing-plan`, `POST /api/ai/generate` y `POST /api/market-studies`. MUST NOT abrir otros endpoints ni crear un `req.user` falso.

#### Scenario: Token v?lido en endpoint permitido

- GIVEN `AA_SERVICE_TOKEN` est? configurado y el header Bearer coincide
- WHEN el CRM llama `POST /api/ai/marketing-plan`
- THEN la petici?n pasa el gate de autenticaci?n de servicio

#### Scenario: Token v?lido en endpoint no permitido

- GIVEN el header Bearer coincide con `AA_SERVICE_TOKEN`
- WHEN se llama `GET /api/agents` u otro path no listado
- THEN la llamada no se considera de servicio
- AND sigue aplicando la autenticaci?n JWT normal

### Requirement: Generaci?n de marketing plan y branding

El sistema MUST exponer generaci?n IA para marketing plan y branding mediante payload `{model, effort, prompt}` y respuesta `{content, usage}`. MUST rechazar prompts vac?os con 400.

#### Scenario: Prompt v?lido

- GIVEN un prompt no vac?o
- WHEN el CRM llama `POST /api/ai/generate`
- THEN AA devuelve `content` y `usage.tokens`

#### Scenario: Prompt ausente

- GIVEN el payload no incluye `prompt`
- WHEN se solicita generaci?n
- THEN AA devuelve 400 con error de prompt requerido

### Requirement: Market studies por token de servicio

El sistema MUST permitir que `POST /api/market-studies` use el mismo gate de servicio para el flujo CRM?AA existente, sin redise?ar el handler.

#### Scenario: Market study server-to-server

- GIVEN el CRM usa el token de servicio correcto
- WHEN solicita `POST /api/market-studies`
- THEN AA permite la llamada sin exigir JWT Supabase de usuario final

### Requirement: Sin token metering al tenant

El sistema MUST NOT descontar tokens, consultar balance, crear registros `TokenUsage` ni responder 402 por cupo del tenant para estas generaciones. El coste corresponde a la plataforma.

#### Scenario: Generaci?n exitosa sin cupo tenant

- GIVEN un tenant sin cupo disponible
- WHEN el CRM solicita generaci?n IA v?a AA con token de servicio
- THEN la generaci?n no consulta ni descuenta cupo del tenant
- AND el ?nico l?mite efectivo es la disponibilidad del proveedor OpenAI de la plataforma
