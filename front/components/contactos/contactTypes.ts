export type ContactType = "lead" | "prospecto";
export type ContactedStatus = "si" | "no" | "nc";

export interface ProspectContact {
  id: string;
  codigo: string;
  type: ContactType;
  name: string;
  phone: string | null;
  email: string | null;
  sector: string | null;
  direccion: string | null;
  peticion: string | null;
  contactado: ContactedStatus;
  contactedAt: string | null;
  createdAt: string;
  clientId: string | null;
  client?: { id: string; name: string; codigo: string | null } | null;
}

export interface ContactFormState {
  type: ContactType;
  name: string;
  phone: string;
  email: string;
  sector: string;
  direccion: string;
}

export const EMPTY_FORM: ContactFormState = {
  type: "prospecto",
  name: "",
  phone: "",
  email: "",
  sector: "",
  direccion: "",
};

export const CONTACTADO_CYCLE: Record<ContactedStatus, ContactedStatus> = {
  nc: "si",
  si: "no",
  no: "nc",
};

export const CONTACTADO_LABELS: Record<ContactedStatus, string> = {
  si: "Sí",
  no: "No",
  nc: "NC",
};

export type SortKey = "codigo" | "name" | "email" | "sector" | "contactado" | "createdAt";

/** Orden lógico de los estados de contacto al ordenar por esa columna. */
export const CONTACTADO_ORDER: Record<ContactedStatus, number> = { si: 0, no: 1, nc: 2 };

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
