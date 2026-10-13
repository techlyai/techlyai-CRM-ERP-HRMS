import type { Config } from "tailwindcss";
const hsl = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: hsl("background"),
        foreground: hsl("foreground"),
        border: hsl("border"),
        input: hsl("input"),
        ring: hsl("ring"),
        primary: {
          DEFAULT: hsl("primary"),
          hover: hsl("primary-hover"),
          foreground: hsl("primary-foreground"),
        },
        accent: {
          DEFAULT: hsl("accent"),
          foreground: hsl("accent-foreground"),
        },
        navy: {
          DEFAULT: hsl("navy"),
          foreground: hsl("navy-foreground"),
        },
        muted: {
          DEFAULT: hsl("muted"),
          foreground: hsl("muted-foreground"),
        },
        card: {
          DEFAULT: hsl("card"),
          foreground: hsl("card-foreground"),
        },
        success: hsl("success"),
        warning: hsl("warning"),
        danger: hsl("danger"),
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "var(--font-inter)", "sans-serif"],
      },
      borderRadius: { xl: "1rem", "2xl": "1.25rem" },
      boxShadow: {
        soft: "var(--shadow-soft)",
        glow: "0 0 0 1px hsl(var(--primary) / 0.25), 0 12px 40px -12px hsl(var(--primary) / 0.45)",
      },
      opacity: { 12: "0.12" },
    },
  },
  plugins: [],
} satisfies Config;
