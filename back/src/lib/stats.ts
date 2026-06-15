// Barrel: preserves the public API of `@/lib/stats` after splitting into
// cohesive submodules under `@/lib/stats/`. All previously exported symbols
// remain importable from this path unchanged.
export * from "@/lib/stats/types";
export * from "@/lib/stats/helpers";
export * from "@/lib/stats/aggregator";
export * from "@/lib/stats/drilldown";
