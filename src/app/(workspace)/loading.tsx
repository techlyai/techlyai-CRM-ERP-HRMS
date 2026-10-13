import { LogoMark } from "@/components/logo";
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading workspace">
      <div className="mb-8 flex items-center gap-3">
        <LogoMark size={20} className="animate-pulse" />
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="grid animate-pulse gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="panel h-40 bg-muted/40 shadow-none" />
        ))}
      </div>
      <div className="mt-6 grid animate-pulse gap-6 md:grid-cols-[2fr_1fr]">
        <div className="panel h-80 bg-muted/40 shadow-none" />
        <div className="panel h-80 bg-muted/40 shadow-none" />
      </div>
    </div>
  );
}
