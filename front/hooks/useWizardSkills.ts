"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Skill } from "@/components/agent-wizard/types";

interface SkillsResponse {
  items: Skill[];
  totalPages: number;
}

function normalizeUseOptions(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort();
}

export function useWizardSkills() {
  const [items, setItems] = useState<Skill[]>([]);
  const [uses, setUses] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [use, setUse] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  async function load() {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (use) params.set("use", use.trim().toUpperCase());
    const data = await api<SkillsResponse>(`/api/skills?${params}`);
    setItems(data.items ?? []);
    setTotalPages(data.totalPages ?? 1);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [q, use, page]);

  useEffect(() => {
    // Select dinámico según los valores de la columna USE
    api<string[]>("/api/skills/uses")
      .then((data) => setUses(normalizeUseOptions(Array.isArray(data) ? data : [])))
      .catch(() => {});
  }, []);

  return { items, uses, q, setQ, use, setUse, page, setPage, totalPages };
}
