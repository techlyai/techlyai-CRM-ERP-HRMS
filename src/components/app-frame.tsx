"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Target,
  Building2,
  RefreshCw,
  FolderKanban,
  CheckSquare,
  FileText,
  Users,
  UserPlus,
  Clock3,
  CalendarClock,
  CalendarDays,
  Laptop,
  Package,
  Wrench,
  Truck,
  ShoppingBag,
  IndianRupee,
  CreditCard,
  Wallet,
  Settings2,
  Bell,
  Search,
  ChevronDown,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  Command,
} from "lucide-react";
import { modules, type Profile } from "@/lib/modules";
import { logout } from "@/lib/actions";
import { unlockAlertSound } from "@/lib/audio";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
const icons: Record<string, React.ElementType> = {
  Target,
  Building2,
  RefreshCw,
  FolderKanban,
  CheckSquare,
  FileText,
  Users,
  UserPlus,
  Clock3,
  CalendarClock,
  CalendarDays,
  Laptop,
  Package,
  Wrench,
  Truck,
  ShoppingBag,
  IndianRupee,
  CreditCard,
  Wallet,
  Settings2,
};
export function AppFrame({
  children,
  profile,
  visible,
  unread,
}: {
  children: React.ReactNode;
  profile: Profile;
  visible: string[];
  unread: number;
}) {
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [unreadCount, setUnreadCount] = useState(unread);
  const navRef = useRef<HTMLElement>(null);
  // Keep the active link visible when the menu is longer than the screen.
  // Only the menu's own vertical scroll moves; the page and sidebar never shift.
  useEffect(() => {
    const menu = navRef.current;
    const link = menu?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!menu || !link) return;
    const box = menu.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    const margin = 48;
    if (item.top < box.top + margin)
      menu.scrollTo({ top: menu.scrollTop - (box.top + margin - item.top), behavior: "auto" });
    else if (item.bottom > box.bottom - margin)
      menu.scrollTo({ top: menu.scrollTop + (item.bottom - (box.bottom - margin)), behavior: "auto" });
  }, [pathname, mobile]);
  useEffect(() => setUnreadCount(unread), [unread]);
  useEffect(() => {
    const update = (event: Event) =>
      setUnreadCount(
        Math.max(
          0,
          Math.min(100, Number((event as CustomEvent<number>).detail) || 0),
        ),
      );
    window.addEventListener("techly:unread", update);
    document.addEventListener("pointerdown", unlockAlertSound);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("techly:unread", update);
      document.removeEventListener("pointerdown", unlockAlertSound);
    };
  }, []);
  const initials = profile.full_name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
  const nav = (href: string, label: string, Icon: React.ElementType) => {
    const active =
      pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
    return (
      <Link
        onClick={() => setMobile(false)}
        href={href}
        key={href}
        aria-current={active ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
      >
        <Icon size={17} strokeWidth={active ? 2.25 : 2} />
        <span className="flex-1">{label}</span>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </Link>
    );
  };
  return (
    <div className="min-h-screen">
      <div
        onClick={() => setMobile(false)}
        className={
          mobile ? "fixed inset-0 z-30 bg-navy/50 backdrop-blur-[2px] lg:hidden" : "hidden"
        }
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-border bg-card transition-transform lg:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-[76px] items-center border-b border-border px-6">
          <Link href="/" aria-label="Techly home" className="rounded-md">
            <Logo size={26} />
          </Link>
          <button
            className="ml-auto rounded-md p-1 text-muted-foreground lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="mx-4 mt-4 flex shrink-0 items-center gap-3 rounded-lg border border-border p-3">
          <div className="icon-tile h-8 w-8 rounded-md">
            <Building2 size={17} />
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold">Techly workspace</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Company operations
            </div>
          </div>
          <ChevronDown size={14} className="text-muted-foreground" />
        </div>
        <nav
          ref={navRef}
          aria-label="Main navigation"
          className="scroll-thin scroll-fade mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 pt-1"
        >
          {nav("/", "Overview", LayoutDashboard)}
          {["Business", "Work", "People", "Operations", "Finance"].map(
            (group) => {
              const list = modules.filter(
                (m) => m.group === group && visible.includes(m.key),
              );
              if (!list.length) return null;
              return (
                <div key={group} className="mt-5">
                  <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
                    {group}
                  </div>
                  {list.map((m) =>
                    nav(
                      "/modules/" + m.key,
                      m.title,
                      icons[m.icon] || FileText,
                    ),
                  )}
                </div>
              );
            },
          )}
          <div className="mt-5">
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
              Workspace
            </div>
            {nav("/notifications", "Notifications", Bell)}
            {profile.role === "super_admin" &&
              nav("/users", "Users & access", ShieldCheck)}
            {profile.role === "super_admin" &&
              nav("/activity", "Activity & audit", FileText)}
            {nav("/settings", "Settings", Settings2)}
          </div>
        </nav>
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <div className="avatar h-8 w-8">{initials}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">
                {profile.full_name}
              </div>
              <div className="mt-1 text-[10px] capitalize text-muted-foreground">
                {profile.role.replace("_", " ")}
              </div>
            </div>
            <button
              aria-label="Sign out"
              title="Sign out"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => logout()}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-4 border-b border-border bg-card/90 px-5 backdrop-blur lg:px-8">
          <button
            className="rounded-md text-foreground lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={22} />
          </button>
          <Link href="/" aria-label="Techly home" className="lg:hidden">
            <Logo variant="mark" size={22} />
          </Link>
          <form
            action="/search"
            className="flex max-w-md flex-1 items-center gap-2"
          >
            <Search size={17} className="shrink-0 text-muted-foreground" />
            <input
              name="q"
              aria-label="Search authorized records"
              placeholder="Search your workspace…"
              className="border-0 bg-transparent p-0 text-[13px] shadow-none focus:shadow-none"
            />
            <span className="hidden rounded border px-1.5 py-1 text-[10px] text-muted-foreground md:block">
              <Command size={10} />
            </span>
          </form>
          <div className="flex items-center gap-1 md:gap-3">
            <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground xl:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Connected
            </div>
            <ThemeToggle className="text-muted-foreground" />
            <Link
              href="/notifications"
              className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={`${unreadCount} unread notifications`}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
            <div className="hidden h-7 w-px bg-border sm:block" />
            <Link
              href="/settings"
              aria-label="Your settings"
              className="avatar h-8 w-8"
            >
              {initials}
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-5 pb-24 lg:p-8">
          {children}
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-border bg-card/95 py-3 backdrop-blur lg:hidden">
          {[
            ["/", "Overview", LayoutDashboard],
            ["/modules/tasks", "Tasks", CheckSquare],
            ["/modules/attendance", "Attendance", Clock3],
            ["/notifications", "Inbox", Bell],
          ].map(([href, label, Icon]) => {
            const C = Icon as React.ElementType;
            return (
              <Link
                key={String(href)}
                href={String(href)}
                className={`flex flex-col items-center gap-1 text-[10px] ${pathname === href ? "font-semibold text-primary" : "text-muted-foreground"}`}
              >
                <C size={19} />
                {String(label)}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
