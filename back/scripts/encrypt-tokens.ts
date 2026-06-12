/**
 * Script idempotente para cifrar tokens OAuth existentes en texto plano.
 * También vuelca un backup de las filas Integration antes de la unificación google.
 *
 * Uso: npx tsx back/scripts/encrypt-tokens.ts
 *
 * Prerrequisitos:
 *   - CHANNEL_ENCRYPTION_KEY definida en .env (o entorno)
 *   - npx prisma generate ejecutado
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../src/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isEncrypted, encryptToken } from "../src/lib/integrations/oauth";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // Verificar clave de cifrado antes de tocar la DB (R1-3-b)
  if (!process.env.CHANNEL_ENCRYPTION_KEY) {
    console.error(
      "[encrypt-tokens] ERROR: CHANNEL_ENCRYPTION_KEY no está definida en el entorno.\n" +
        "  Define la variable antes de ejecutar este script.\n" +
        "  El script NO ha modificado ninguna fila."
    );
    process.exit(1);
  }

  // Backup OBLIGATORIO antes de cualquier modificación (punto innegociable del diseño)
  const allRows = await prisma.integration.findMany();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // process.cwd() apunta al directorio back/ cuando se ejecuta desde allí
  const backupPath = join(process.cwd(), `prisma/backup-integrations-${timestamp}.json`);
  writeFileSync(backupPath, JSON.stringify(allRows, null, 2), "utf8");
  console.log(`[encrypt-tokens] Backup escrito en: ${backupPath} (${allRows.length} filas)`);

  if (allRows.length === 0) {
    console.log("[encrypt-tokens] No hay filas en Integration. Nada que cifrar.");
    return;
  }

  let migrated = 0;
  let alreadyEncrypted = 0;
  let errors = 0;

  for (const row of allRows) {
    try {
      const needsAccessUpdate = !isEncrypted(row.accessToken);
      const needsRefreshUpdate = row.refreshToken !== null && !isEncrypted(row.refreshToken);

      if (!needsAccessUpdate && !needsRefreshUpdate) {
        alreadyEncrypted++;
        continue;
      }

      const updates: { accessToken?: string; refreshToken?: string } = {};
      if (needsAccessUpdate) {
        updates.accessToken = encryptToken(row.accessToken);
      }
      if (needsRefreshUpdate) {
        updates.refreshToken = encryptToken(row.refreshToken!);
      }

      await prisma.integration.update({
        where: { id: row.id },
        data: updates,
      });

      console.log(`  [cifrado] id=${row.id} provider=${row.provider} agentId=${row.agentId}`);
      migrated++;
    } catch (e) {
      console.error(`  [ERROR] id=${row.id}:`, e);
      errors++;
    }
  }

  console.log(
    `\n[encrypt-tokens] Completado: ${migrated} filas cifradas, ${alreadyEncrypted} ya cifradas, ${errors} errores.`
  );

  if (errors > 0) {
    console.error("[encrypt-tokens] ADVERTENCIA: hubo errores. Revisar antes de continuar.");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("[encrypt-tokens] Error fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
