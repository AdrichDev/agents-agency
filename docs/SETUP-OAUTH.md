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

## 2. Google (Gmail + Calendar)
1. https://console.cloud.google.com → crea proyecto → APIs & Services
2. **Enable APIs**: Gmail API y Google Calendar API
3. OAuth consent screen → External → añade los scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
   - Añade tu email como *test user* mientras esté en modo testing
4. Credentials → Create Credentials → **OAuth client ID** → Web application
   - Authorized redirect URIs:
     - `http://localhost:4000/api/oauth/gmail/callback`
     - `http://localhost:4000/api/oauth/calendar/callback`
     - (y las mismas con tu dominio de producción)
5. Copia Client ID y Secret en `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

## 3. Slack
1. https://api.slack.com/apps → Create New App → From scratch
2. OAuth & Permissions → Redirect URLs: `http://localhost:4000/api/oauth/slack/callback` (+ producción)
3. Bot Token Scopes: `chat:write`, `channels:read`, `channels:history`
4. Copia Client ID y Secret en `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`
5. Instala la app en tu workspace e invita al bot a los canales: `/invite @tu-bot`

## 4. Jira (Atlassian)
1. https://developer.atlassian.com/console/myapps → Create → OAuth 2.0 integration
2. Permissions → Jira API → añade scopes: `read:jira-work`, `write:jira-work`, `offline_access`
3. Authorization → Callback URL: `http://localhost:4000/api/oauth/jira/callback` (+ producción)
4. Copia Client ID y Secret en `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET`

## 5. GitHub token (opcional, recomendado)
Sube el rate limit del scraper de skills de 10 a 30 req/min:
https://github.com/settings/tokens → Fine-grained token sin permisos especiales → `GITHUB_TOKEN`

## Nota importante
Tras desplegar a producción, cambia `NEXT_PUBLIC_APP_URL` y añade las redirect URIs de producción en cada consola OAuth.
