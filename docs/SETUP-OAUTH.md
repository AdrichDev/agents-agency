# Setup de OAuth e infraestructura

## 1. Base de datos (PostgreSQL + pgvector)

### Opción A — Supabase (gratis)
1. Crea un proyecto en https://supabase.com
2. SQL Editor → ejecuta: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Settings → Database → copia la **Connection string (URI)** en modo *Session* y ponla en `DATABASE_URL`

### Opción B — Railway
1. New Project → Deploy PostgreSQL en https://railway.app
2. Conéctate con `psql` y ejecuta `CREATE EXTENSION IF NOT EXISTS vector;` (imagen con pgvector: usa el template "pgvector")
3. Copia `DATABASE_URL` de la pestaña Variables

Después: `npm run db:push`

## 2. Google (Calendar + Gmail — proveedor unificado)

> A partir de P2 el proveedor es `google` (unificado). La redirect URI es **una sola**.

1. https://console.cloud.google.com → crea proyecto → APIs & Services
2. **Enable APIs**: Gmail API y Google Calendar API
3. OAuth consent screen → External → añade los scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
   - `openid`, `email`
   - Añade tu email como *test user* mientras esté en modo testing
4. Credentials → Create Credentials → **OAuth client ID** → Web application
   - Authorized redirect URIs:
     - `http://localhost:4000/api/oauth/google/callback`
     - (y la misma con tu dominio de producción)
5. Copia Client ID y Secret en `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

> **Entornos locales**: Google no acepta `localhost` como redirect URI en algunas configuraciones. Usa ngrok: `ngrok http 4000` y pon la URL HTTPS generada en `BACK_URL` y en las redirect URIs de la consola.

## 3. Slack
1. https://api.slack.com/apps → Create New App → From scratch
2. OAuth & Permissions → Redirect URLs: `{BACK_URL}/api/oauth/slack/callback`
3. Bot Token Scopes: `chat:write`, `channels:read`, `channels:history`
4. Copia Client ID y Secret en `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`
5. Instala la app en tu workspace e invita al bot a los canales: `/invite @tu-bot`

## 4. Notion (nuevo en P2)
1. https://www.notion.so/profile/integrations → Create new integration → Public
2. En **Redirect URIs** añadir: `{BACK_URL}/api/oauth/notion/callback`
3. Los scopes se configuran en la app (no en la URL de autorización)
4. Copia `OAuth client ID` y `OAuth client secret` en `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`

## 5. Jira (fase posterior — "Próximamente")
1. https://developer.atlassian.com/console/myapps → Create → OAuth 2.0 integration
2. Permissions → Jira API → añade scopes: `read:jira-work`, `write:jira-work`, `offline_access`
3. Authorization → Callback URL: `{BACK_URL}/api/oauth/jira/callback`
4. Copia Client ID y Secret en `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET`

## 6. GitHub token (opcional, recomendado)
Sube el rate limit del scraper de skills de 10 a 30 req/min:
https://github.com/settings/tokens → Fine-grained token sin permisos especiales → `GITHUB_TOKEN`

## 7. Cifrado de tokens en reposo

La variable `CHANNEL_ENCRYPTION_KEY` (AES-256-GCM, 32 bytes hex) **es obligatoria** para que el backend pueda cifrar los tokens OAuth al guardarlos. Sin ella el callback devuelve HTTP 500.

Generar una clave válida:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Nota importante
Tras desplegar a producción, actualiza `BACK_URL` y añade las redirect URIs de producción en cada consola OAuth. Las redirect URIs deben ser exactamente iguales a las que el backend genera en `{BACK_URL}/api/oauth/{provider}/callback`.
