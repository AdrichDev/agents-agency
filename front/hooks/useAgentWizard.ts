"use client";

import { useState } from "react";
import type { AgentWizardForm } from "@/components/agent-wizard/types";

export const INITIAL_AGENT_FORM: AgentWizardForm = {
  clientName: "",
  website: "",
  sector: "",
  name: "",
  systemPrompt: "",
  model: "gpt-4.1-nano",
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

export function useAgentWizard() {
  const [form, setForm] = useState<AgentWizardForm>(INITIAL_AGENT_FORM);

  function set<K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return { form, set, setForm };
}
