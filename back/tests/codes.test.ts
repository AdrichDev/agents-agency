import { describe, expect, it, vi } from "vitest";
import { computeNextCode, parseCodeNumber, withCodeRetry } from "@/lib/codes";

describe("codes — generación secuencial de códigos de negocio", () => {
  describe("parseCodeNumber", () => {
    it("extrae el número de un código válido", () => {
      expect(parseCodeNumber("cli-01", "cli")).toBe(1);
      expect(parseCodeNumber("cli-42", "cli")).toBe(42);
      expect(parseCodeNumber("pc-07", "pc")).toBe(7);
    });

    it("devuelve null para códigos malformados o de otro prefijo", () => {
      expect(parseCodeNumber("cli-abc", "cli")).toBeNull();
      expect(parseCodeNumber("pc-01", "cli")).toBeNull();
      expect(parseCodeNumber("cli01", "cli")).toBeNull();
      expect(parseCodeNumber("", "cli")).toBeNull();
    });
  });

  describe("computeNextCode", () => {
    it("empieza en 01 cuando no hay códigos", () => {
      expect(computeNextCode([], "cli")).toBe("cli-01");
      expect(computeNextCode([], "pc")).toBe("pc-01");
    });

    it("continúa la secuencia desde el máximo", () => {
      expect(computeNextCode(["cli-01", "cli-02"], "cli")).toBe("cli-03");
      expect(computeNextCode(["pc-03", "pc-01"], "pc")).toBe("pc-04");
    });

    it("ignora nulls y códigos malformados", () => {
      expect(computeNextCode([null, "basura", "cli-05", "pc-99"], "cli")).toBe("cli-06");
    });

    it("rellena con cero hasta 2 dígitos y crece sin truncar a partir de 100", () => {
      expect(computeNextCode(["cli-09"], "cli")).toBe("cli-10");
      expect(computeNextCode(["cli-99"], "cli")).toBe("cli-100");
      expect(computeNextCode(["cli-100"], "cli")).toBe("cli-101");
    });

    it("no se ve afectado por huecos en la secuencia (usa el máximo)", () => {
      expect(computeNextCode(["cli-01", "cli-07"], "cli")).toBe("cli-08");
    });
  });

  describe("withCodeRetry", () => {
    it("devuelve el resultado al primer intento si no hay conflicto", async () => {
      const create = vi.fn().mockResolvedValue("ok");
      await expect(withCodeRetry(create)).resolves.toBe("ok");
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("reintenta en violación de unique (P2002) y acaba resolviendo", async () => {
      const create = vi
        .fn()
        .mockRejectedValueOnce({ code: "P2002" })
        .mockResolvedValueOnce("ok");
      await expect(withCodeRetry(create)).resolves.toBe("ok");
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("propaga errores que no son P2002 sin reintentar", async () => {
      const create = vi.fn().mockRejectedValue(new Error("boom"));
      await expect(withCodeRetry(create)).rejects.toThrow("boom");
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("lanza el último error tras agotar los reintentos", async () => {
      const create = vi.fn().mockRejectedValue({ code: "P2002" });
      await expect(withCodeRetry(create, 3)).rejects.toEqual({ code: "P2002" });
      expect(create).toHaveBeenCalledTimes(3);
    });
  });
});
