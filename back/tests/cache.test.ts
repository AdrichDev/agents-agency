import { describe, expect, it, vi } from "vitest";
import { buildCacheControl, setCache, cacheControl } from "@/lib/cache";

describe("cache — buildCacheControl", () => {
  it("private by default with max-age", () => {
    expect(buildCacheControl({ maxAge: 30 })).toBe("private, max-age=30");
  });

  it("public + stale-while-revalidate", () => {
    expect(buildCacheControl({ maxAge: 60, public: true, staleWhileRevalidate: 300 })).toBe(
      "public, max-age=60, stale-while-revalidate=300"
    );
  });

  it("floors and clamps non-negative max-age", () => {
    expect(buildCacheControl({ maxAge: -5 })).toBe("private, max-age=0");
    expect(buildCacheControl({ maxAge: 12.9 })).toBe("private, max-age=12");
  });

  it("omits swr when zero/absent", () => {
    expect(buildCacheControl({ maxAge: 10, staleWhileRevalidate: 0 })).toBe("private, max-age=10");
  });
});

describe("cache — setCache", () => {
  it("sets the Cache-Control header", () => {
    const res = { setHeader: vi.fn() } as any;
    setCache(res, { maxAge: 60, public: true });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=60");
  });
});

describe("cache — cacheControl middleware", () => {
  it("sets header on GET and calls next", () => {
    const res = { setHeader: vi.fn() } as any;
    const next = vi.fn();
    cacheControl({ maxAge: 30 })({ method: "GET" } as any, res, next);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, max-age=30");
    expect(next).toHaveBeenCalled();
  });

  it("does NOT set header on non-GET (mutations)", () => {
    const res = { setHeader: vi.fn() } as any;
    const next = vi.fn();
    cacheControl({ maxAge: 30 })({ method: "POST" } as any, res, next);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
