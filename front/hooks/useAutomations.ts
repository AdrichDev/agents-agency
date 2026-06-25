"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SERVICES } from "@/components/automations/automationCatalog";

interface IntegrationStatus {
  provider: string;
  status: "connected" | "reauth_required" | "disconnected";
}

export type ServiceConnectionState =
  | "connected"
  | "reauth_required"
  | "disconnected"
  | "upcoming"
  | null;

/**
 * Estado + fetch del panel de automatizaciones de un agente. Extrae la lógica de
 * datos del componente; comportamiento idéntico al inline previo (mismas
 * llamadas de red y mismo orden de efectos).
 */
export function useAutomations(agentId: string, onChange: () => void) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  // Mapeo service → provider cargado desde el backend (fuente única R6-1)
  const [serviceToProvider, setServiceToProvider] = useState<Record<string, string>>({});
  const [upcomingProviders, setUpcomingProviders] = useState<string[]>([]);

  // Cargar service-map y estado de integraciones (R6-1, R6-2)
  useEffect(() => {
    api<{ serviceToProvider: Record<string, string>; upcomingProviders: string[] }>(
      `/api/integrations/services`
    )
      .then((d) => {
        setServiceToProvider(d.serviceToProvider ?? {});
        setUpcomingProviders(d.upcomingProviders ?? []);
      })
      .catch(() => {});

    api<{ integrations: IntegrationStatus[] }>(`/api/integrations/${agentId}/status`)
      .then((d) => setIntegrations(d.integrations ?? []))
      .catch(() => {});
  }, [agentId]);

  /** Devuelve el estado de la conexión para el servicio seleccionado, o null si no requiere OAuth */
  function getServiceConnectionState(serviceId: string): ServiceConnectionState {
    const provider = serviceToProvider[serviceId];
    if (!provider) return null;
    if (upcomingProviders.includes(provider)) return "upcoming";
    const int = integrations.find((i) => i.provider === provider);
    return int?.status ?? "disconnected";
  }

  async function create(form: {
    name: string;
    trigger: string;
    prompt: string;
    service: string;
    action: string;
    intervalMinutes: number;
  }) {
    setSaving(true);
    const config: { service?: string; action?: string; intervalMinutes?: number } = {};
    if (form.service) config.service = form.service;
    if (form.action) config.action = form.action;
    if (form.trigger === "schedule") config.intervalMinutes = form.intervalMinutes;
    await api("/api/automations", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        name: form.name,
        trigger: form.trigger,
        prompt: form.prompt,
        config,
      }),
    });
    setSaving(false);
    setShowForm(false);
    onChange();
  }

  async function toggle(a: { id: string; enabled: boolean }) {
    await api("/api/automations", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: !a.enabled }) });
    onChange();
  }

  async function remove(id: string) {
    await api("/api/automations", { method: "DELETE", body: JSON.stringify({ id }) });
    onChange();
  }

  async function resync(id: string) {
    await api(`/api/automations/${id}/resync`, { method: "POST" });
    onChange();
  }

  return {
    showForm, setShowForm,
    saving,
    serviceToProvider,
    getServiceConnectionState,
    create,
    toggle,
    remove,
    resync,
  };
}

// Reexport para conveniencia de consumidores del hook.
export { SERVICES };
