"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Skill } from "@/components/agent-wizard/types";

interface SkillsResponse {
  items: Skill[];
  totalPages: number;
}

export function useWizardSkills() {
  const [items, setItems] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  async function load() {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    const data = await api<SkillsResponse>(`/api/skills?${params}`);
    setItems(data.items ?? []);
    setTotalPages(data.totalPages ?? 1);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [q, category, page]);

  useEffect(() => {
    api<string[]>("/api/skills/categories")
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  return { items, categories, q, setQ, category, setCategory, page, setPage, totalPages };
}

