// Setup global de tests: provee secretos mínimos para que el código fail-closed
// (auth, etc.) no aborte durante la ejecución de la suite.
// Phase 4: SUPABASE_JWT_SECRET replaces JWT_SECRET.
process.env.SUPABASE_JWT_SECRET ??= "test-supabase-jwt-secret-0123456789-abcdef";
process.env.SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service-role-key-for-testing-only";
