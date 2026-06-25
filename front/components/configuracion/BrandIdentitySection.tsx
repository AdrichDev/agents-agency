"use client";

import type React from "react";

interface BrandIdentitySectionProps {
  favicon: string;
  sidebarLogo: string;
  onFaviconChange: (value: string) => void;
  onSidebarLogoChange: (value: string) => void;
}

/** Lee un archivo de imagen como data URL y lo entrega al setter. */
function handleFileChange(
  e: React.ChangeEvent<HTMLInputElement>,
  setter: (val: string) => void,
) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => {
    setter(reader.result as string);
  };
  reader.readAsDataURL(file);
}

/** Carga de favicon y logotipo del sidebar (identidad de marca). */
export function BrandIdentitySection({
  favicon,
  sidebarLogo,
  onFaviconChange,
  onSidebarLogoChange,
}: BrandIdentitySectionProps) {
  return (
    <div className="border-t border-edge pt-4 space-y-4">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Identidad de Marca</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Selector de Favicon */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400">Favicon de la Web</label>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              {favicon && <img src={favicon} alt="Favicon" className="w-6 h-6 object-contain" />}
            </div>
            <div className="flex-1 space-y-1">
              <input
                type="file"
                accept=".ico,.png,.jpg,.jpeg,.svg"
                onChange={(e) => handleFileChange(e, onFaviconChange)}
                className="hidden"
                id="favicon-upload"
              />
              <label htmlFor="favicon-upload" className="btn-dark cursor-pointer text-center block py-1.5 px-3 text-[11px] font-bold">
                Subir archivo
              </label>
              {favicon && (
                <button
                  type="button"
                  onClick={() => onFaviconChange("")}
                  className="text-[10px] text-rose-400 hover:underline block"
                >
                  Restablecer
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Selector de Logotipo Sidebar */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400">Logotipo del Sidebar</label>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              {sidebarLogo && <img src={sidebarLogo} alt="Sidebar Logo" className="w-8 h-8 object-contain" />}
            </div>
            <div className="flex-1 space-y-1">
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.svg"
                onChange={(e) => handleFileChange(e, onSidebarLogoChange)}
                className="hidden"
                id="sidebar-logo-upload"
              />
              <label htmlFor="sidebar-logo-upload" className="btn-dark cursor-pointer text-center block py-1.5 px-3 text-[11px] font-bold">
                Subir archivo
              </label>
              {sidebarLogo && (
                <button
                  type="button"
                  onClick={() => onSidebarLogoChange("")}
                  className="text-[10px] text-rose-400 hover:underline block"
                >
                  Restablecer
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
