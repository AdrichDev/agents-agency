/** Datos fijos de la empresa para presupuestos (editables en Configuración). */

export interface CompanyData {
  name: string;
  ownerName: string;
  nif: string;
  address: string;
  email: string;
  phone: string;
  iban: string;
  vatRate: number; // % IVA
  quoteFooter: string;
}

export const DEFAULT_COMPANY: CompanyData = {
  name: "Agent Agency",
  ownerName: "Adrián",
  nif: "",
  address: "",
  email: "achozas9@hotmail.com",
  phone: "",
  iban: "",
  vatRate: 21,
  quoteFooter:
    "Presupuesto válido durante 30 días. El plazo de entrega se acuerda a la firma. 50% a la aceptación y 50% a la entrega.",
};

const KEY = "aa-company";

export function loadCompany(): CompanyData {
  if (typeof window === "undefined") return DEFAULT_COMPANY;
  try {
    return { ...DEFAULT_COMPANY, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_COMPANY;
  }
}

export function saveCompany(data: CompanyData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(data));
}
