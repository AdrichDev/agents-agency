# Agent Agency ⚡

Plataforma SaaS para tu agencia de agentes de IA: crea, configura y despliega agentes para clientes en minutos.

## Estructura

```
back/    API Express + Prisma + agentic loop + cron de automatizaciones  → :4000
front/   Dashboard Next.js (estilo dark/gradient)                        → :3000
docs/    Guías de OAuth y deploy
docker-compose.yml   PostgreSQL + pgvector                               → :5433
```

## Arranque (3 terminales o 2 si Docker ya corre)

```bash
# 1. Base de datos
docker compose up -d

# 2. Backend
cd back
npm install
npm run db:push      # primera vez
npm run dev          # → http://localhost:4000

# 3. Frontend
cd front
npm install
npm run dev          # → http://localhost:3000
```

## Qué hace
- **Wizard de 6 pasos** — crea un agente por sector con prompt y skills preconfiguradas
- **RAG automático** — scrapea la web del cliente y la indexa con pgvector
- **Agentic loop (OpenAI function calling)** — el agente decide qué tools usar y el executor llama a las APIs reales
- **Integraciones OAuth 1-clic** — Gmail, Google Calendar, Slack y Jira
- **Automatizaciones sin código** — "clasifica mis emails y crea tickets Jira", cada 5 min
- **Marketplace de skills** — auto-descubre MCPs de GitHub
- **Despliegue multicanal** — widget embebible (servido por el back), API REST, Telegram, WhatsApp

## Stack
Back: Express · Prisma 7 · PostgreSQL + pgvector · OpenAI (gpt-5.4-mini)
Front: Next.js 14 · Tailwind (tema dark con gradientes)

## Configuración
- `back/.env` — DATABASE_URL, OPENAI_API_KEY, OAuth, CRON_SECRET, BACK_URL, FRONT_URL, **GOOGLE_MAPS_API_KEY** (estudios de mercado: requiere "Places API (New)" + Geocoding API habilitadas en Google Cloud)
- `front/.env.local` — NEXT_PUBLIC_API_URL (URL del back)

OAuth: [docs/SETUP-OAUTH.md](docs/SETUP-OAUTH.md) · Deploy: [docs/DEPLOY.md](docs/DEPLOY.md)

## Comandos útiles

```bash
# Base de datos
docker compose up -d                 # levanta PostgreSQL + pgvector (:5433)
docker compose down                  # para la BD

# Backend (cd back)
npm run dev                          # API en :4000 (tsx watch)
npm run start                        # API sin watch
npm run db:push                      # aplica el schema Prisma + genera el client
npm run generate                     # solo regenera el Prisma client
npm run create-user                  # crea un usuario (login JWT)
npm test                             # tests (vitest)
npm run typecheck                    # comprobación de tipos (tsc --noEmit)

# Frontend (cd front)
npm run dev                          # dashboard en :3000 (Next + turbo)
npm run build                        # build de producción
npm run typecheck                    # comprobación de tipos
npm run test:e2e                     # tests e2e (Playwright)
```

## Tests
```bash
cd back  && npm test && npm run typecheck    # backend: unit + tipos
cd front && npm run typecheck                # frontend: tipos
```
## Login

Script para crear un usuario y que se guarde con jwt:

npm run create-user

## Endpoints de prueba

- GET http://localhost:4000/auth/me
- POST http://localhost:4000/auth/refresh
