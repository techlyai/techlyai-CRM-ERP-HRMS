export function Status({ value }: { value: string }) {
  const good = [
    "Approved",
    "Active",
    "Completed",
    "Present",
    "Paid",
    "Won",
    "Confirmed",
    "Received",
    "Joined",
  ];
  const bad = ["Rejected", "Expired", "Overdue", "Lost", "Absent", "Damaged"];
  const pending = [
    "Submitted",
    "Pending Payment",
    "Clarification Required",
    "Upcoming",
    "Late",
    "In Review",
    "Partially Paid",
    "Cancellation Requested",
  ];
  const cls = good.includes(value)
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : bad.includes(value)
      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
      : pending.includes(value)
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}
