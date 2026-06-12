import { describe, it, expect, afterEach } from "vitest";
import { getJwtSecret, assertAuthSecrets } from "@/lib/auth";

const original = process.env.JWT_SECRET;

afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

describe("JWT_SECRET fail-closed", () => {
  it("lanza si JWT_SECRET está ausente", () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    expect(() => assertAuthSecrets()).toThrow(/JWT_SECRET/);
  });

  it("lanza si JWT_SECRET es demasiado corto (<32)", () => {
    process.env.JWT_SECRET = "corto";
    expect(() => getJwtSecret()).toThrow(/32/);
  });

  it("acepta un secreto suficientemente largo", () => {
    process.env.JWT_SECRET = "x".repeat(32);
    expect(getJwtSecret()).toHaveLength(32);
    expect(() => assertAuthSecrets()).not.toThrow();
  });
});
