"use client";

import { useEffect, useState } from "react";

/** Datos del emisor persistidos en localStorage (bloque de facturación). */
export interface IssuerData {
  company: string;
  cif: string;
  address: string;
  email: string;
  phone: string;
}

const EMPTY: IssuerData = { company: "", cif: "", address: "", email: "", phone: "" };

/**
 * Gestiona el bloque "Datos del Emisor": carga desde localStorage al montar y
 * persiste al guardar. El logo del sidebar se expone por separado (read-only).
 */
export function useIssuerData() {
  const [issuer, setIssuer] = useState<IssuerData>(EMPTY);
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    setIssuer({
      company: localStorage.getItem("issuer-company") || "",
      cif: localStorage.getItem("issuer-cif") || "",
      address: localStorage.getItem("issuer-address") || "",
      email: localStorage.getItem("issuer-email") || "",
      phone: localStorage.getItem("issuer-phone") || "",
    });
    setLogo(localStorage.getItem("sidebar-logo") || null);
  }, []);

  const saveIssuer = (next: IssuerData) => {
    setIssuer(next);
    localStorage.setItem("issuer-company", next.company);
    localStorage.setItem("issuer-cif", next.cif);
    localStorage.setItem("issuer-address", next.address);
    localStorage.setItem("issuer-email", next.email);
    localStorage.setItem("issuer-phone", next.phone);
  };

  return { issuer, logo, saveIssuer };
}
