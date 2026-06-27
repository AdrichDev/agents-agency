# Comandos — Agents Agency (3A Estudio)

Monorepo: `front/` (Next.js 14) + `back/` (Express + Prisma + Supabase).
DB y Auth en Supabase (proyecto `ciarfjnehqreaccykkjx`). Back en `:4000`, front en `:3000`.

> Ejecuta los comandos `npm` desde la carpeta indicada (`back/` o `front/`).

---

## Arranque rápido

```bash
# Back (API :4000) — Git Bash / PowerShell
cd back && npm run dev

# Front (web :3000) — en otra terminal
cd front && npm run dev
```

Si pides login y se queda en bucle: borra en el navegador
`localStorage → sb-ciarfjnehqreaccykkjx-auth-token` y recarga (sesión rancia).

---

## Back (`cd back`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | API con recarga (`tsx watch src/index.ts`) en `:4000` |
| `npm start` | API sin watch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Suite vitest (integración Storage se salta sin creds) |
| `npm run test:int` | Suite + integración Storage **real** (carga `.env`) |
| `npm run generate` | `prisma generate` (regenera cliente) |
| `npm run db:push` | `prisma db push` + generate — ⚠️ ver aviso migraciones |
| `npm run backup` | Backup de la BD |
| `npm run create-user` | Crear usuario |

### Scripts puntuales (back)
```bash
npx tsx scripts/setup-storage-bucket.ts    # crea bucket público "public-assets" (idempotente)
npx tsx scripts/encrypt-tokens.ts          # cifrar tokens existentes
npx tsx scripts/generate-landings.ts       # generar landings
npx tsx scripts/reclassify-skills.ts       # reclasificar skills
npx tsx scripts/recovery-seed.ts           # seed de recuperación
npx tsx scripts/backfill-cod-cliente.ts    # backfill códigos de cliente
npx tsx scripts/test-conversations.ts [agentId]  # smoke de chat
npx tsx scripts/migrate-avatars-to-storage.ts          # DRY-RUN: avatares base64 -> Storage
npx tsx scripts/migrate-avatars-to-storage.ts --apply  # aplica la migración
```

---

## Front (`cd front`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | Web Next.js en `:3000` |
| `npm run build` | Build de producción |
| `npm start` | Servir build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:e2e` | Playwright e2e |

---

## Migraciones Prisma (convención del repo)

SQL manual en `back/prisma/migrate-*.sql`. **Las tablas viven en el schema `aa`**
(multiSchema) → el SQL crudo necesita prefijo, p.ej. `aa.agente`.

```bash
# 1) Editar back/prisma/schema.prisma (campo nuevo)
# 2) Aplicar el SQL aditivo a la BD (ALTER TABLE aa.<tabla> ...)
# 3) Regenerar cliente:
cd back && npm run generate
```

> ⚠️ **Windows + EPERM**: `prisma generate` falla si el back (`npm run dev`)
> está corriendo (archivos del cliente bloqueados). **Para el back antes** de generar.
> Evita `db push` si el schema tiene tablas de otros dominios (riesgo de DROP);
> usa SQL aditivo manual.

---

## Supabase Storage

```bash
cd back
npx tsx scripts/setup-storage-bucket.ts   # bucket "public-assets" (público, png/jpeg/webp, 2MB)
npm run test:int                          # valida bucket + política + content-type (real)
```

Assets públicos (avatar widget, imágenes de landing) → Storage; la BD guarda la URL.

---

## Docker (infra local: n8n)

> La base de datos vive en Supabase (DATABASE_URL en back/.env). El Postgres
> local pgvector (:5433) se retiró en la migración a Supabase.

```bash
cd <raíz agents-agency>
docker compose up -d        # n8n (:5678)
docker compose down
docker compose logs -f n8n
```

---

## Troubleshooting

```bash
# Puerto 4000 ocupado (back zombie) — Git Bash:
netstat -ano | grep ':4000' | grep -i listen      # ver PID
taskkill //PID <PID> //T //F                       # matar

# Verificar back vivo
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/health   # 200 = ok
```

---

## CI (GitHub Actions)
- `.github/workflows/ci.yml` — back (typecheck + `npm test`) + front (typecheck) en cada push/PR.
  Job `storage-integration` corre `test:int` solo si existen los secrets del repo
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (escribe bajo `_test/`).
- `.github/workflows/security.yml` — gitleaks (escaneo de secretos).

## Salud / despliegue
- `GET /health` → liveness. `GET /ready` → readiness (ping BD).
- Despliegue: ver `docs/DEPLOY.md`. OAuth Google: `docs/SETUP-OAUTH.md`.
