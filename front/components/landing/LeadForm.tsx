"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export default function LeadForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError("Debes aceptar la política de privacidad.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const data = await api<any>("/api/public/leads", {
        method: "POST",
        body: JSON.stringify({ name, email, phone, consent }),
      });
      if (data?.ok) {
        setDone(true);
      } else {
        setError("No se pudo enviar. Inténtalo de nuevo.");
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.body?.error ?? "No se pudo enviar. Inténtalo de nuevo.");
      } else {
        setError("No se pudo conectar con el servidor.");
      }
    }
    setSending(false);
  }

  if (done) {
    return (
      <div className="text-center py-10">
        <div className="text-5xl mb-4">🎉</div>
        <h3 className="text-2xl font-extrabold text-white mb-2">¡Recibido!</h3>
        <p className="text-slate-400 text-sm">
          Gracias por tu interés. Te contactaremos muy pronto para dar vida a tu agente de IA.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          type="text"
          required
          minLength={2}
          placeholder="Tu nombre"
          className="input-dark w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="tel"
          required
          minLength={6}
          placeholder="Teléfono"
          className="input-dark w-full"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <input
        type="email"
        required
        placeholder="Email"
        className="input-dark w-full"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label className="flex items-start gap-3 text-xs text-slate-400 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 accent-indigo-500"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          He leído y acepto la{" "}
          <a href="#" className="text-indigo-400 hover:underline">
            política de privacidad
          </a>{" "}
          y el tratamiento de mis datos para ser contactado por 3A Estudio.
        </span>
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={sending}
        className="btn-neon w-full !py-3 text-sm"
      >
        {sending ? "Enviando..." : "Quiero mi agente de IA →"}
      </button>
    </form>
  );
}
