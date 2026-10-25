"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function FieldTabs({ reviewer, manage }: { reviewer: boolean; manage: boolean }) {
  const pathname = usePathname();
  const tabs: [string, string][] = [
    ["/field", "Dashboard"],
    ["/field/tracking", "Employee tracking"],
    ["/field/visits", "Visit history"],
    ["/field/photos", "GPS photos"],
    ...(reviewer ? ([["/field/review", "Verification review"]] as [string, string][]) : []),
    ["/field/reports", "Field reports"],
    ...(manage ? ([["/field/settings", "Settings"]] as [string, string][]) : []),
  ];
  return (
    <nav aria-label="Field operations" className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map(([href, label]) => {
        const active = href === "/field" ? pathname === "/field" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 pb-3 text-xs ${active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
