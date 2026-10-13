export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading workspace"
      className="animate-pulse"
    >
      <div className="mb-8 h-10 w-72 rounded-lg bg-muted" />
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="panel h-40 bg-muted/40" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="panel h-80 bg-muted/40" />
        <div className="panel h-80 bg-muted/40" />
      </div>
    </div>
  );
}
