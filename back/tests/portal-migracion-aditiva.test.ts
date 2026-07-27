/**
 * H5 (aa-portal-cliente, T1.4) — `usuario.tenant_id` entra sin romper a nadie.
 *
 * Este test no comprueba una función: comprueba una FORMA de migrar. `tenant_id` tiene que llegar
 * nullable y sin default, porque `NULL` significa "usuario del estudio" y eso es exactamente lo que
 * son todas las filas que ya existen. Si algún día alguien la pone NOT NULL, tendrá que rellenarla
 * para el staff, y el único valor disponible sería un tenant inventado: la peor fila posible en la
 * columna que decide qué datos ve cada quien.
 *
 * También fija `ON DELETE RESTRICT`. Con `SET NULL`, borrar un tenant convertiría a sus usuarios de
 * portal en staff — un borrado de cliente que acaba en escalada de privilegios.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migracion = readFileSync(
  new URL("../prisma/migrations/20260727050000_usuario_tenant_id/migration.sql", import.meta.url),
  "utf8"
);

/** Cuerpo del `model User { ... }`, para no aserta sobre coincidencias de otras tablas. */
function modeloUser(): string {
  const m = schema.match(/model User \{([\s\S]*?)\n\}/);
  expect(m, "no se encuentra `model User` en schema.prisma").not.toBeNull();
  return m![1];
}

describe("T1.4 — la columna llega nullable y sin default (schema)", () => {
  it("`User.tenantId` es opcional", () => {
    expect(modeloUser()).toMatch(/tenantId\s+String\?\s+@map\("tenant_id"\)/);
  });

  it("`User.tenantId` NO tiene default: no hay tenant que dar por supuesto", () => {
    const linea = modeloUser()
      .split("\n")
      .find((l) => l.includes("tenantId"));
    expect(linea).toBeDefined();
    expect(linea).not.toMatch(/@default/);
  });

  it("la relación borra con RESTRICT, no con SetNull", () => {
    // SetNull convertiría al usuario de portal en staff al borrar su tenant.
    expect(modeloUser()).toMatch(/@relation\(fields: \[tenantId\][^)]*onDelete: Restrict\)/);
    expect(modeloUser()).not.toMatch(/@relation\(fields: \[tenantId\][^)]*SetNull/);
  });

  it("`tenantId` está indexado: la puerta y el portal filtran por él en cada petición", () => {
    expect(modeloUser()).toMatch(/@@index\(\[tenantId\]\)/);
  });

  it("`client` figura entre los valores documentados de `role`", () => {
    expect(modeloUser()).toMatch(/role\s+String.*client/);
  });
});

describe("T1.4 — la migración es aditiva (SQL)", () => {
  it("añade la columna sin NOT NULL y sin DEFAULT", () => {
    expect(migracion).toMatch(/ALTER TABLE "usuario" ADD COLUMN "tenant_id" TEXT;/);
  });

  it("ninguna sentencia del fichero impone NOT NULL ni un default sobre `tenant_id`", () => {
    // Se miran las sentencias, no los comentarios: el comentario del fichero explica por qué NO se
    // hace, y un `toMatch` ingenuo sobre todo el texto se dispararía con esa misma explicación.
    const sentencias = migracion
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    expect(sentencias).not.toMatch(/NOT NULL/i);
    expect(sentencias).not.toMatch(/DEFAULT/i);
    expect(sentencias).not.toMatch(/UPDATE\s+"?usuario"?/i);
  });

  it("crea el índice y la FK con ON DELETE RESTRICT", () => {
    expect(migracion).toMatch(/CREATE INDEX "usuario_tenant_id_idx" ON "usuario"\("tenant_id"\);/);
    expect(migracion).toMatch(/REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/);
  });

  it("no borra ni renombra nada: sólo añade", () => {
    const sentencias = migracion
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    expect(sentencias).not.toMatch(/DROP\s/i);
    expect(sentencias).not.toMatch(/RENAME/i);
  });
});
