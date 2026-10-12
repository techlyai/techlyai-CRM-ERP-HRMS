import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "#fff" },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: "hsl(var(--card))",
      },
      borderRadius: { xl: "1rem" },
    },
  },
  plugins: [],
} satisfies Config;
