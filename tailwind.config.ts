import type { Config } from "tailwindcss";

// Tokens taken from docs/ui-reference: light grey canvas, white rounded cards, black pill for
// active/primary, indigo accent for AI / selected (video), green / amber / red / grey status.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F2F3F5",
        ink: "#0B0B0C",
        muted: "#6B7280",
        line: "#E8E9ED",
        ok: "#16A34A",
        okSoft: "#E7F7EE",
        bad: "#E5484D",
        badSoft: "#FDEBEC",
        warn: "#D97706",
        warnBright: "#F59E0B",
        warnSoft: "#FEF4E2",
        accent: "#5B4CF5",
        accentSoft: "#EFEDFE",
        sky: "#C9D8EC",
        grey: "#8A8F98",
        greySoft: "#F0F1F3",
      },
      borderRadius: { card: "22px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 6px 20px rgba(16,24,40,.05)",
        lift: "0 10px 30px rgba(16,24,40,.12)",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
