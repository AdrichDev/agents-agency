# Propuesta — generación IA del CRM vía AA (server-to-server, SIN metering)

## Contexto / decisión
El botón "Generar con IA" del CRM (marketing-plan / branding / market-study) no
funcionaba: faltaban endpoints en AA y el `AA_SERVICE_TOKEN` no pasaba el gate (espera
JWT Supabase) → 401.

DECISIÓN del propietario: la generación del CRM es **coste de PLATAFORMA**, NO se
factura al cupo de tokens del cliente (si se agota, OpenAI corta el servicio del
propietario). Por tanto se DESCARTA el "token gap" original: **sin metering al tenant,
sin migración de TokenUsage, sin checkClientBalance/402**. El objetivo se reduce a
hacer la generación **funcional**.

## Alcance (implementado)
- **Auth de servicio:** `isServiceCall()` en `lib/public-routes.ts` (testeable, DI del
  token). El gate de `index.ts` deja pasar SOLO los endpoints de generación cuando el
  `Authorization: Bearer` coincide con `AA_SERVICE_TOKEN` (timingSafeEqual). No abre el
  resto de la API ni falsea `req.user` (esos handlers no lo usan).
  Paths de servicio: `POST /api/ai/marketing-plan`, `POST /api/ai/generate`,
  `POST /api/market-studies`.
- **Endpoints de generación** (`routes/ai.ts`): `POST /api/ai/marketing-plan` y
  `POST /api/ai/generate` (branding). Reciben `{model, effort, prompt}`, ejecutan el
  modelo (reasoning_effort solo en gpt-5*) y devuelven `{content, usage:{tokens, model}}`.
  Sin metering.
- **market-studies**: ya existía; solo necesitaba pasar el gate (no usa `req.user`).

## Fuera de alcance
- Metering / cupos / 402 (decisión: coste de plataforma).
- Migración DB. UI del CRM (ya manda `clientId` aunque aquí se ignora para metering).
- Rediseñar el flujo de market-study (crear vs generar).

## Config requerida (runtime)
- AA back: `AA_SERVICE_TOKEN=<token fuerte>` (solo servidor).
- CRM front (server): `AA_SERVICE_TOKEN=<mismo valor>` + `AA_API_URL=<url de AA>`.
  Sin CORS (server-to-server, sin Origin de navegador).

## Seguridad
- El token de servicio es estático y potente; vive SOLO en env de servidor. Comparación
  en tiempo constante. Alcance mínimo (3 paths). Si no está configurado → `isServiceCall`
  devuelve false (no se abre nada por accidente).
