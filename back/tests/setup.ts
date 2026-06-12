// Setup global de tests: provee secretos mínimos para que el código fail-closed
// (auth, etc.) no aborte durante la ejecución de la suite.
process.env.JWT_SECRET ??= "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
