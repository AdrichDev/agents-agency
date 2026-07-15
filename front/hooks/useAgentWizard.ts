"use client";

import { useEffect, useState } from "react";
import type { AgentWizardForm } from "@/components/agent-wizard/types";

export const INITIAL_AGENT_FORM: AgentWizardForm = {
  clientMode: "existing",
  tenantId: "",
  clientName: "",
  website: "",
  sector: "",
  name: "",
  systemPrompt: "",
  runtime: "openclaw",
  model: "gpt-5.4-mini",
  reasoningEffort: "low",
  temperature: 0.7,
  skillIds: [],
  channel: "widget",
  widgetPrimaryColor: "#4f46e5",
  widgetSecondaryColor: "#9333ea",
  widgetAvatarBase64: "",
  widgetAvatarEmoji: "🤖",
  widgetTemplateConfig: {
    position: "right",
    launcherShape: "circle",
    panelSize: "normal",
  },
};

// Borrador del wizard en sessionStorage: si la creación falla o se recarga la
// página, el formulario no se pierde (se limpia con clearDraft al crear con éxito).
const DRAFT_KEY = "aa-agent-wizard-draft";

function loadDraft(): AgentWizardForm {
  if (typeof window === "undefined") return INITIAL_AGENT_FORM;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return INITIAL_AGENT_FORM;
    // Merge sobre el inicial: campos nuevos añadidos después de guardar el
    // borrador conservan su valor por defecto.
    return { ...INITIAL_AGENT_FORM, ...(JSON.parse(raw) as Partial<AgentWizardForm>) };
  } catch {
    return INITIAL_AGENT_FORM;
  }
}

export function useAgentWizard() {
  const [form, setForm] = useState<AgentWizardForm>(loadDraft);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      /* storage lleno o bloqueado: el wizard sigue funcionando sin borrador */
    }
  }, [form]);

  function set<K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function clearDraft() {
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* noop */
    }
  }

  return { form, set, setForm, clearDraft };
}
