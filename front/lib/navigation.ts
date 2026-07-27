export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export const NAV_TITLE = "Centro de Mando";

/**
 * Sidebar navigation grouped by functional domain (aa-navegacion-lateral-agrupada).
 * Order and composition are business-defined — see proposal.md decisions.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "general",
    label: "Área de Trabajo",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "📊" },
      { href: "/agenda", label: "Agenda", icon: "📅" },
    ],
  },
  {
    id: "pedidos",
    label: "Pedidos",
    items: [
      { href: "/agents/new", label: "Nuevo Agente", icon: "✨" },
      { href: "/skills", label: "Marketplace", icon: "🛒" },
      { href: "/agents", label: "Agentes", icon: "🤖" },
      { href: "/landing-builder", label: "Landing Builder", icon: "🎨" },
    ],
  },
  {
    id: "clientes-lead",
    label: "Clientes / Lead",
    items: [
      { href: "/clientes", label: "Clientes", icon: "👥" },
      { href: "/contactos", label: "Contactos", icon: "📇" },
    ],
  },
  {
    id: "presupuestos",
    label: "Facturación",
    items: [
      { href: "/presupuestos", label: "Presupuestos", icon: "💳" },
      { href: "/facturas", label: "Facturas", icon: "🧾" },
      { href: "/tarifas", label: "Tarifas", icon: "🏷️" },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { href: "/estadisticas", label: "Estadísticas", icon: "📈" },
      { href: "/estudios-mercado", label: "Estudios de Mercado", icon: "🔎" },
    ],
  },
] as const;

/**
 * Vista plana derivada de NAV_GROUPS, para compatibilidad con consumidores
 * que esperen la lista de items sin jerarquía de grupos.
 */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * H5 (aa-portal-cliente, T4.3) — Menú del usuario de portal.
 *
 * Es una lista aparte y no un filtro sobre NAV_GROUPS: un filtro deja el menú del estudio como base y
 * cada grupo nuevo que alguien añada aparecería también aquí hasta que se acordase de excluirlo. Con
 * dos listas, lo que el cliente ve es exactamente lo que está escrito en esta constante.
 *
 * Los `href` tienen que caer bajo `/portal`, que es lo único que la puerta del backend
 * (`clientScopeGate`) le permite alcanzar. Un enlace fuera de ahí sería un 403 con forma de botón.
 */
export const PORTAL_NAV: readonly NavGroup[] = [
  {
    id: "portal",
    label: "Mi servicio",
    items: [
      { href: "/portal", label: "Resumen", icon: "📊" },
    ],
  },
] as const;

/**
 * Menú que le toca a un rol. Cualquier rol que no sea el del portal es staff del estudio.
 *
 * Deny-by-default también aquí: el menú del portal es el caso por defecto sólo para `client`, y
 * cualquier rol desconocido cae en el del estudio porque es lo que ya pasaba antes de H5 — la
 * restricción de verdad la aplica el backend, y un menú no es un control de acceso.
 */
export function navForRole(role: string | null | undefined): readonly NavGroup[] {
  return role === "client" ? PORTAL_NAV : NAV_GROUPS;
}
