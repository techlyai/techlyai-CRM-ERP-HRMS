import { useId } from "react";
import { cn } from "@/lib/utils";

type Tone = "auto" | "light" | "dark";
const tones: Record<Exclude<Tone, "auto">, React.CSSProperties> = {
  light: {
    ["--logo-sky" as string]: "#0ea5e9",
    ["--logo-indigo" as string]: "#6366f1",
    ["--logo-text" as string]: "#0f172a",
    ["--logo-overlap" as string]: "#ffffff",
  },
  dark: {
    ["--logo-sky" as string]: "#38bdf8",
    ["--logo-indigo" as string]: "#818cf8",
    ["--logo-text" as string]: "#ffffff",
    ["--logo-overlap" as string]: "#ffffff",
  },
};
const toneStyle = (tone: Tone) => (tone === "auto" ? undefined : tones[tone]);

/** The Techly "Connect" symbol: two equal circles whose overlap is left white. */
export function LogoMark({
  size = 32,
  tone = "auto",
  className,
  title = "Techly",
}: {
  size?: number;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  const id = "lens" + useId().replace(/:/g, "");
  return (
    <svg
      width={Math.round((size * 122.5) / 80)}
      height={size}
      viewBox="0 0 122.5 80"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
      style={toneStyle(tone)}
    >
      <clipPath id={id}>
        <circle cx="40" cy="40" r="40" />
      </clipPath>
      <circle cx="40" cy="40" r="40" fill="var(--logo-sky)" />
      <circle cx="82.5" cy="40" r="40" fill="var(--logo-indigo)" />
      <circle
        cx="82.5"
        cy="40"
        r="40"
        fill="var(--logo-overlap)"
        clipPath={`url(#${id})`}
      />
    </svg>
  );
}

/** Wordmark: "Tech" in navy, "ly" in indigo, Poppins SemiBold. */
export function LogoWordmark({
  tone = "auto",
  className,
  style,
}: {
  tone?: Tone;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={cn("font-display font-semibold leading-none", className)}
      style={{ ...toneStyle(tone), ...style }}
    >
      <span style={{ color: "var(--logo-text)" }}>Tech</span>
      <span style={{ color: "var(--logo-indigo)" }}>ly</span>
    </span>
  );
}

/**
 * Combination mark. `horizontal` for headers and sidebars, `stacked` for
 * splash and sign-in screens, `mark` for compact spaces. `size` is the symbol
 * height in pixels; the wordmark scales with it.
 */
export function Logo({
  variant = "horizontal",
  size = 28,
  tone = "auto",
  className,
}: {
  variant?: "horizontal" | "stacked" | "mark";
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  if (variant === "mark")
    return <LogoMark size={size} tone={tone} className={className} />;
  const stacked = variant === "stacked";
  return (
    <span
      className={cn(
        "inline-flex items-center",
        stacked ? "flex-col" : "flex-row",
        className,
      )}
      style={{ gap: Math.round(size * (stacked ? 0.6 : 0.42)) }}
    >
      <LogoMark size={size} tone={tone} />
      <LogoWordmark
        tone={tone}
        style={{ fontSize: Math.round(size * (stacked ? 1.1 : 0.95)) }}
      />
    </span>
  );
}
