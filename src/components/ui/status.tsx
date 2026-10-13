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
    ? "bg-success/10 text-success"
    : bad.includes(value)
      ? "bg-danger/10 text-danger"
      : pending.includes(value)
        ? "bg-warning/10 text-warning"
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
