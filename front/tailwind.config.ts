import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--bg)",
        panel: "var(--panel)",
        edge: "var(--edge)",
      },
    },
  },
  plugins: [],
};
export default config;
