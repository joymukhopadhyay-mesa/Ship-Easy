import type { Config } from "tailwindcss";

// Tokens taken from docs/ui-reference (light grey canvas, white rounded cards,
// black pill for active/primary, green/red/amber status, purple accent).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F2F3F5",
        ink: "#0B0B0C",
        muted: "#6B7280",
        line: "#E6E7EB",
        ok: "#16A34A",
        bad: "#DC2626",
        warn: "#D97706",
        accent: "#7C3AED",
        sky: "#C9D8EC",
      },
      borderRadius: { card: "22px" },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.04)" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
