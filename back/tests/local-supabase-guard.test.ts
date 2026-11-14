/**
 * aa-supabase-local S4 — el setup local nunca debe migrar ni sembrar una base que no sea local.
 * `assertLocalDatabaseUrl` es la única puerta: lanza antes de cualquier conexión si el host no
 * es 127.0.0.1, localhost o ::1.
 */
import { describe, it, expect } from "vitest";
import { assertLocalDatabaseUrl } from "../scripts/local-supabase/lib";

describe("assertLocalDatabaseUrl (S4)", () => {
  it.each([
    "postgresql://postgres:postgres@127.0.0.1:54322/agents_agency",
    "postgresql://postgres:postgres@localhost:54322/agents_agency?schema=aa",
    "postgresql://postgres:postgres@[::1]:54322/agents_agency",
  ])("acepta una base local: %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    "postgresql://postgres.abcdefgh:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://postgres:secret@10.0.0.5:5432/postgres",
    "postgresql://postgres:secret@localhost.evil.com:5432/postgres",
  ])("rechaza una base que no es local: %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(/no es local/);
  });

  it("rechaza una URL vacía o mal formada", () => {
    expect(() => assertLocalDatabaseUrl("")).toThrow(/no es local/);
    expect(() => assertLocalDatabaseUrl("not a url")).toThrow(/no es local/);
  });

  it("el mensaje de error no incluye la contraseña", () => {
    const url = "postgresql://postgres:SuperSecret123@db.abcdefgh.supabase.co:5432/postgres";
    try {
      assertLocalDatabaseUrl(url);
      throw new Error("se esperaba un rechazo");
    } catch (e) {
      expect((e as Error).message).not.toContain("SuperSecret123");
      expect((e as Error).message).toContain("db.abcdefgh.supabase.co");
    }
  });
});
