# Deploy a Vercel — checklist

## Pre-deploy
- [ ] `npm run typecheck` pasa
- [ ] `npm test` pasa
- [ ] `npm run build` pasa en local
- [ ] BD de producción creada con `CREATE EXTENSION vector;`
- [ ] `npm run migrate:deploy` ejecutado contra la BD de producción (ver "Baseline de producción" abajo si es la primera vez)

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

## Migraciones (flujo oficial)
La estrategia oficial es `prisma migrate deploy` con el historial en `prisma/migrations/`.
- Deploy normal (BD ya baselined): `npm run migrate:deploy`.
- Estado: `npm run migrate:status`. Desarrollo local: `npm run migrate:dev`.

## Baseline de producción (una sola vez)
La BD de producción se construyó con `db push` + SQL numerado en `db/`, por lo que su tabla
`_prisma_migrations` está **vacía**. El baseline squasheado (`20260708000000_squashed_baseline`)
ya refleja el estado real, así que un `migrate deploy` directo fallaría intentando recrear
tablas que ya existen. Arreglo de una sola vez **en el host** con el `DATABASE_URL` real:

```bash
# 1. Confirmar que prod NO tiene drift respecto a schema.prisma (DEBE salir vacío).
#    Si emite SQL, prod tiene drift real → reconciliar ANTES de baselinar.
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code

# 2. Marcar el baseline como aplicado sin ejecutar su SQL.
npx prisma migrate resolve --applied 20260708000000_squashed_baseline

# 3. Verificar.
npx prisma migrate status   # -> "Database schema is up to date!"

# A partir de aquí, deploys futuros: solo  npx prisma migrate deploy
```

## Rollback
Vercel → Deployments → "..." en el deployment anterior → Promote to Production.
