"use client";

interface GoogleOAuthSectionProps {
  googleClientId: string;
  googleClientSecret: string;
  googleConfigured: boolean;
  googleRedirectUri: string;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
}

/** Credenciales OAuth de Google (Client ID / Secret) y URI de redirección. */
export function GoogleOAuthSection({
  googleClientId,
  googleClientSecret,
  googleConfigured,
  googleRedirectUri,
  onClientIdChange,
  onClientSecretChange,
}: GoogleOAuthSectionProps) {
  return (
    <div className="border-t border-edge pt-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Google OAuth</h3>
        {googleConfigured && <span className="text-xs text-emerald-400">✓ configurado</span>}
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        Necesario para que los chatbots reserven en Google Calendar y conecten Gmail. Crea las credenciales en{" "}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-indigo-400 underline">Google Cloud Console</a>{" "}
        (OAuth 2.0 Client ID, tipo Web). Guía: <code>back/docs/SETUP-OAUTH.md</code>.
      </p>

      {googleRedirectUri && (
        <div className="text-xs text-slate-400">
          <span className="block mb-1">URI de redirección autorizada (pégala en Google Cloud):</span>
          <code className="block bg-black/40 border border-edge rounded-lg px-3 py-2 font-mono text-slate-300 break-all">
            {googleRedirectUri}
          </code>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs text-slate-400">
          Client ID
          <input
            className="input-dark text-sm w-full mt-1 font-mono"
            placeholder="xxxxx.apps.googleusercontent.com"
            value={googleClientId}
            onChange={(e) => onClientIdChange(e.target.value)}
            name="google-client-id"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
        </label>
        <label className="block text-xs text-slate-400">
          Client Secret{" "}
          {googleConfigured && !googleClientSecret && (
            <span className="text-emerald-400">(guardado — dejar vacío para conservar)</span>
          )}
          <input
            className="input-dark text-sm w-full mt-1 font-mono"
            type="password"
            placeholder={googleConfigured ? "••••••••" : "GOCSPX-..."}
            value={googleClientSecret}
            onChange={(e) => onClientSecretChange(e.target.value)}
            name="google-client-secret"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
          />
        </label>
      </div>
    </div>
  );
}
