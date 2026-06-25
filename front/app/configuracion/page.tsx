"use client";

import { ModelEffortSelect } from "@/components/ModelEffortSelect";
import { AppearanceSection } from "@/components/configuracion/AppearanceSection";
import { BrandIdentitySection } from "@/components/configuracion/BrandIdentitySection";
import { GoogleOAuthSection } from "@/components/configuracion/GoogleOAuthSection";
import { useSystemConfig } from "@/hooks/useSystemConfig";

export default function Configuration() {
  const {
    primary, setPrimary,
    secondary, setSecondary,
    font, setFont,
    favicon, setFavicon,
    sidebarLogo, setSidebarLogo,
    defaultAgentModel, setDefaultAgentModel,
    reasoningEffort, setReasoningEffort,
    googleClientId, setGoogleClientId,
    googleClientSecret, setGoogleClientSecret,
    googleConfigured,
    googleRedirectUri,
    status,
    saving,
    dirty,
    saveSettings,
  } = useSystemConfig();

  return (
    <div className="max-w-5xl w-full">
      <div className="mb-8">
        <div className="kicker mb-2">Panel</div>
        <h1 className="text-3xl font-extrabold text-white">Configuración del Entorno</h1>
        <p className="text-sm text-slate-500 mt-1">
          Ajusta los colores de marca, tipografías globales y el tema de ADRICH.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-6 items-start">
        {/* Formulario de Configuración */}
        <div className="card p-6 space-y-6">
          <AppearanceSection
            primary={primary}
            secondary={secondary}
            font={font}
            onPrimaryChange={setPrimary}
            onSecondaryChange={setSecondary}
            onFontChange={setFont}
          />

          <BrandIdentitySection
            favicon={favicon}
            sidebarLogo={sidebarLogo}
            onFaviconChange={setFavicon}
            onSidebarLogoChange={setSidebarLogo}
          />

          {/* Modelo LLM global por defecto */}
          <div className="border-t border-edge pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Modelo IA por defecto</h3>
            <p className="text-xs text-slate-500 -mt-1">
              Modelo sugerido para nuevos agentes y nivel de razonamiento global (afecta coste). Cada agente puede sobrescribirlo.
            </p>
            <ModelEffortSelect
              model={defaultAgentModel}
              effort={reasoningEffort}
              onModelChange={setDefaultAgentModel}
              onEffortChange={setReasoningEffort}
              selectClassName="input-dark text-sm w-full mt-1"
            />
          </div>

          <GoogleOAuthSection
            googleClientId={googleClientId}
            googleClientSecret={googleClientSecret}
            googleConfigured={googleConfigured}
            googleRedirectUri={googleRedirectUri}
            onClientIdChange={setGoogleClientId}
            onClientSecretChange={setGoogleClientSecret}
          />

          {/* Estado y Guardar */}
          <div className="pt-4 border-t border-edge flex items-center justify-between flex-wrap gap-4">
            {status ? (
              <p className="text-sm text-emerald-400 font-semibold">{status}</p>
            ) : (
              <p className="text-xs text-slate-500">Los cambios se guardan centralizados en la Base de Datos.</p>
            )}
            <button
              onClick={saveSettings}
              disabled={!dirty || saving}
              className="btn-grad disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <span className="inline-flex items-center">
                  Guardando
                  <span className="saving-dot">.</span>
                  <span className="saving-dot">.</span>
                  <span className="saving-dot">.</span>
                </span>
              ) : (
                "💾 Guardar Cambios"
              )}
            </button>
          </div>
        </div>

        {/* Live Preview Panel */}
        <div className="card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Vista Previa</h3>

          <div className="space-y-4 p-4 rounded-xl bg-ink/40 border border-edge">
            <div>
              <p className="text-xs text-slate-500 font-semibold mb-1">Gradiente Botón</p>
              <button
                type="button"
                className="w-full font-semibold rounded-lg px-4 py-2 text-xs text-white transition"
                style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
              >
                Botón de ejemplo
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-500 font-semibold mb-1">Color de Selección</p>
              <div className="flex gap-2">
                <span className="w-5 h-5 rounded-full" style={{ backgroundColor: primary }} title="Primario" />
                <span className="w-5 h-5 rounded-full" style={{ backgroundColor: secondary }} title="Secundario" />
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 font-semibold mb-1">Muestra de Letra</p>
              <p className="text-sm font-medium text-white truncate" style={{ fontFamily: font }}>
                La rapidez de ADRICH
              </p>
              <p className="text-xs text-slate-400 leading-tight mt-0.5" style={{ fontFamily: font }}>
                Agentes autónomos de IA y webs automáticas.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
