# Deploy a Vercel — checklist

## Pre-deploy
- [ ] `npm run typecheck` pasa
- [ ] `npm test` pasa
- [ ] `npm run build` pasa en local
- [ ] BD de producción creada con `CREATE EXTENSION vector;`
- [ ] `npm run db:push` ejecutado contra la BD de producción

## Deploy
1. Sube el repo a GitHub
2. https://vercel.com → Import Project
3. Environment Variables — añade TODAS las de `.env.example`:
   - `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
   - `NEXT_PUBLIC_APP_URL` = `https://tu-app.vercel.app`
   - `GOOGLE_CLIENT_ID/SECRET`, `SLACK_CLIENT_ID/SECRET`, `JIRA_CLIENT_ID/SECRET`
   - `CRON_SECRET` (cadena aleatoria larga)
4. Deploy. El cron de `vercel.json` (cada 5 min → `/api/cron/automations`) se activa solo.
   - Nota: en el plan Hobby de Vercel los crons corren máximo 1 vez/día; para cada 5 min necesitas plan Pro o un cron externo (cron-job.org) llamando al endpoint con `Authorization: Bearer $CRON_SECRET`.

## Post-deploy
- [ ] Añadir redirect URIs de producción en Google/Slack/Atlassian (ver SETUP-OAUTH.md)
- [ ] Probar el flujo OAuth de cada proveedor desde la pestaña Integraciones
- [ ] Lanzar "Descubrir skills" en el Marketplace
- [ ] Crear un agente de prueba y verificar el widget en una página HTML local

## Rollback
Vercel → Deployments → "..." en el deployment anterior → Promote to Production.
