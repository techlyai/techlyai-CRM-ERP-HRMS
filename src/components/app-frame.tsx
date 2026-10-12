"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  Sun,
  Moon,
  ChevronDown,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  ArrowUpRight,
  Command,
} from "lucide-react";
import { modules, type Profile } from "@/lib/modules";
import { logout } from "@/lib/actions";
import { Button } from "./ui/button";
import { unlockAlertSound } from "@/lib/audio";
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
  const [dark, setDark] = useState(false);
  const [unreadCount, setUnreadCount] = useState(unread);
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
    return () => {
      window.removeEventListener("techly:unread", update);
      document.removeEventListener("pointerdown", unlockAlertSound);
    };
  }, []);
  useEffect(() => {
    const isDark = localStorage.getItem("techly-theme") === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  const theme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("techly-theme", next ? "dark" : "light");
  };
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
        className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${active ? "bg-violet-500/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
      >
        <Icon size={17} />
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
          mobile ? "fixed inset-0 z-30 bg-black/40 lg:hidden" : "hidden"
        }
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-border bg-card transition-transform lg:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Link
          href="/"
          className="flex h-[76px] items-center gap-2.5 border-b border-border px-6"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xl font-black text-white shadow-md shadow-violet-500/20">
            t<span className="text-violet-200">.</span>
          </span>
          <span className="text-[25px] font-bold tracking-tight">
            techly<span className="text-primary">.</span>
          </span>
          <button
            className="ml-auto lg:hidden"
            aria-label="Close navigation"
            onClick={(e) => {
              e.preventDefault();
              setMobile(false);
            }}
          >
            <X size={18} />
          </button>
        </Link>
        <div className="mx-4 mt-5 flex items-center gap-3 rounded-lg border border-border p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-primary">
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
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-5">
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
        </div>
        <div className="border-t border-border p-4">
          {nav("/notifications", "Notifications", Bell)}
          {profile.role === "super_admin" &&
            nav("/users", "Users & access", ShieldCheck)}
          {profile.role === "super_admin" &&
            nav("/activity", "Activity & audit", FileText)}
          {nav("/settings", "Settings", Settings2)}
          <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
              {initials}
            </div>
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
              onClick={() => logout()}
            >
              <LogOut size={15} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-4 border-b border-border bg-card/95 px-5 backdrop-blur lg:px-8">
          <button
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={22} />
          </button>
          <form
            action="/search"
            className="flex max-w-md flex-1 items-center gap-2"
          >
            <Search size={17} className="text-muted-foreground" />
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
          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground xl:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Your connected workspace
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={theme}
              aria-label={dark ? "Use light mode" : "Use dark mode"}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <Link
              href="/notifications"
              className="relative p-2"
              aria-label={`${unreadCount} unread notifications`}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
            <div className="hidden h-7 w-px bg-border sm:block" />
            <Link
              href="/settings"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700"
            >
              {initials}
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-5 pb-24 lg:p-8">
          {children}
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-border bg-card py-3 lg:hidden">
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
                className={`flex flex-col items-center gap-1 text-[10px] ${pathname === href ? "text-primary" : "text-muted-foreground"}`}
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
