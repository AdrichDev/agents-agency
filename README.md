# Agents Agency

Plataforma web para **crear, configurar y desplegar agentes de IA para negocios**. Cada cliente conecta sus canales, su información y su propia clave de IA, y sus datos quedan separados de los de otros clientes.

Forma parte de [3A Estudio](https://github.com/AdrichDev/3a_estudio) y su panel público está en <https://3aestudio.vercel.app>.

## Qué hace

- **Asistente de creación de agentes** por sector, con instrucciones y herramientas (skills) preconfiguradas.
- **RAG**: lee la web del cliente y la indexa (PostgreSQL + pgvector) para responder con datos reales.
- **Agentes con herramientas**: el agente decide qué herramienta usar y llama a las APIs reales.
- **Integraciones OAuth**: Google (Gmail y Calendar), Slack, Jira y Notion.
- **Canales**: Telegram, WhatsApp, API REST y un widget que se pega en cualquier web.
- **Multi-cliente**: cada cliente (tenant) tiene sus datos, roles, cuotas de uso y su propia clave de IA, guardada cifrada.
- **Facturación**: catálogo de servicios sincronizado con Stripe, presupuestos y facturas.
- **Automatizaciones** programadas y plantillas de n8n.

## Estructura

```text
back/      API en Node.js + Express + TypeScript, Prisma y motor de agentes   (puerto 4000)
front/     Panel y landing en Next.js + React + Tailwind                      (puerto 3000)
db/        Scripts de base de datos
docs/      DEPLOY.md (despliegue) y SETUP-OAUTH.md (alta de OAuth)
openspec/  Cambios documentados (SDD): propuesta, diseño y tareas
render.yaml, Dockerfile   Despliegue de la API en Render
```

## Tecnologías

Node.js · TypeScript · Express · Prisma · PostgreSQL (+ pgvector) · Supabase (base de datos, auth y storage) · Next.js · React · Tailwind CSS · Stripe · OpenAI · Vitest · Playwright · Docker · GitHub Actions.

## Arranque en local

Requisitos: Node.js 22 y una base de datos PostgreSQL (el proyecto usa Supabase; pgvector debe estar disponible).

```bash
# 1. Backend
cd back
npm install
cp .env.example .env     # rellena DATABASE_URL, JWT_SECRET, OPENAI_API_KEY...
npm run migrate:deploy   # aplica las migraciones de Prisma
npm run create-user      # crea un usuario para entrar
npm run dev              # http://localhost:4000

# 2. Frontend (otra terminal)
cd front
npm install
# crea front/.env.local con NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev              # http://localhost:3000
```

Para las integraciones OAuth sigue [docs/SETUP-OAUTH.md](docs/SETUP-OAUTH.md). Nunca subas ficheros `.env` al repositorio.

## Tests

```bash
cd back  && npm test && npm run typecheck   # Vitest (unas 2.000 pruebas) y tipos
cd back  && npm run test:int                # integración real con Supabase Storage (necesita credenciales)
cd front && npm run typecheck               # tipos
cd front && npm run test:e2e                # Playwright (18 recorridos)
```

## CI/CD y despliegue

- **GitHub Actions**: `ci.yml` (tipos y tests del backend, tipos del frontend) y `security.yml` (gitleaks sobre todo el historial).
- **API**: Render con Docker (Frankfurt), despliegue automático según `render.yaml`.
- **Panel**: Vercel.
- Más detalle en [docs/DEPLOY.md](docs/DEPLOY.md).

## Seguridad

Claves de clientes cifradas, validación de datos con zod, límite de peticiones, cabeceras con helmet y protección frente a llamadas a direcciones internas. Hay un informe de auditoría en `security-audit-report.json`.

## Metodología

Desarrollo guiado por especificaciones (SDD) con OpenSpec: cada cambio importante tiene su propuesta, diseño y tareas en `openspec/changes/`. Ramas por funcionalidad, pull requests y Conventional Commits.
