/**
 * CLI del generador del catálogo (aa-catalogo-precios-fuente-unica, T2.2).
 *
 *   npm run catalog:sync
 *
 * Se ejecuta después de tocar `front/lib/service-catalog.json`. Idempotente: si el espejo ya está al
 * día no escribe nada, para no dejar el árbol sucio sin motivo.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  GENERATED_MODULE_PATH,
  CATALOG_JSON_PATH,
  readCatalogSource,
  renderCatalogModule,
  normalizeEol,
} from "./service-catalog-codegen";

const source = readCatalogSource();
const rendered = renderCatalogModule(source);

// Normalizado: con `core.autocrlf=true` el fichero en disco puede venir con CRLF del checkout, y
// reescribirlo por eso dejaría el árbol sucio en cada ejecución sin haber cambiado nada.
const actual = existsSync(GENERATED_MODULE_PATH)
  ? normalizeEol(readFileSync(GENERATED_MODULE_PATH, "utf8"))
  : null;

if (actual === rendered) {
  console.log(`[catalog:sync] ya al día — ${source.services.length} servicios, sin cambios`);
} else {
  writeFileSync(GENERATED_MODULE_PATH, rendered, "utf8");
  console.log(
    `[catalog:sync] regenerado desde ${CATALOG_JSON_PATH}\n` +
      `               ${source.services.length} servicios · cupo de plan ${source.planTokens.toLocaleString("es-ES")} tokens`
  );
}
