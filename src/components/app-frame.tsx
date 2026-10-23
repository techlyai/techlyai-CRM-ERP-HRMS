"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as NavigationDialog from "@radix-ui/react-dialog";
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
  Menu,
  X,
  LogOut,
  ShieldCheck,
  WifiOff,
  BellRing,
  MessageSquare,
} from "lucide-react";
import { modules, type Profile } from "@/lib/modules";
import { logout } from "@/lib/actions";
import { unlockAlertSound } from "@/lib/audio";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { NotificationCentre } from "./notification-centre";
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
  const [pageSearch, setPageSearch] = useState("");
  const [offline, setOffline] = useState(false);
  const [unreadCount, setUnreadCount] = useState(unread);
  const navRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const term = pageSearch.trim().toLowerCase();
  const availableModules = modules.filter((m) => visible.includes(m.key));
  const matchingModules = availableModules.filter((m) =>
    `${m.title} ${m.description} ${m.group}`.toLowerCase().includes(term),
  );
  useEffect(() => {
    setMobile(false);
    setPageSearch("");
  }, [pathname]);
  useEffect(() => {
    const connectionChanged = () => setOffline(!navigator.onLine);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobile(false);
    };
    connectionChanged();
    window.addEventListener("online", connectionChanged);
    window.addEventListener("offline", connectionChanged);
    window.addEventListener("keydown", shortcut);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      window.removeEventListener("online", connectionChanged);
      window.removeEventListener("offline", connectionChanged);
      window.removeEventListener("keydown", shortcut);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, []);
  // Keep the active link visible when the menu is longer than the screen.
  // Only the menu's own vertical scroll moves; the page and sidebar never shift.
  useEffect(() => {
    const menu = mobile ? mobileNavRef.current : navRef.current;
    const link = menu?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!menu || !link) return;
    const box = menu.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    const margin = 48;
    if (item.top < box.top + margin)
      menu.scrollTo({
        top: menu.scrollTop - (box.top + margin - item.top),
        behavior: "auto",
      });
    else if (item.bottom > box.bottom - margin)
      menu.scrollTo({
        top: menu.scrollTop + (item.bottom - (box.bottom - margin)),
        behavior: "auto",
      });
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
  const nav = (
    href: string,
    label: string,
    Icon: React.ElementType,
    isModule = false,
  ) => {
    if (term && !isModule && !label.toLowerCase().includes(term)) return null;
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
  const sidebar = (compact = false) => (
    <>
      <div className="flex h-[76px] items-center border-b border-border px-6">
        <Link href="/" aria-label="Orbit home" className="rounded-md">
          <Logo size={26} />
        </Link>
        {compact && (
          <button
            className="ml-auto rounded-md p-2 text-muted-foreground"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className="mx-4 mt-4 flex shrink-0 items-center gap-3 rounded-lg border border-border p-3">
        <div className="icon-tile h-8 w-8 rounded-md">
          <Building2 size={17} />
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold">Orbit workspace</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            A Techly project
          </div>
        </div>
      </div>
      <div className="relative mx-4 mt-4">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
        />
        <input
          aria-label="Find a page"
          placeholder="Find a page…"
          value={pageSearch}
          onChange={(event) => setPageSearch(event.target.value)}
          className="pl-9 pr-9 text-xs"
        />
        {pageSearch && (
          <button
            onClick={() => setPageSearch("")}
            aria-label="Clear page search"
            className="absolute right-1 top-1 rounded-md p-2 text-muted-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <nav
        ref={compact ? mobileNavRef : navRef}
        aria-label="Main navigation"
        className="scroll-thin scroll-fade mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 pt-1"
      >
        {nav("/", "Overview", LayoutDashboard)}
        {["Business", "Work", "People", "Operations", "Finance"].map(
          (group) => {
            const list = matchingModules.filter((m) => m.group === group);
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
                    true,
                  ),
                )}
              </div>
            );
          },
        )}
        <div className="mt-5">
          {!term && (
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
              Workspace
            </div>
          )}
          {nav("/reminders", "Reminders", BellRing)}
          {nav("/chat", "Chat", MessageSquare)}
          {nav("/notifications", "Notifications", Bell)}
          {profile.role === "super_admin" &&
            nav("/users", "Users & access", ShieldCheck)}
          {profile.role === "super_admin" &&
            nav("/activity", "Activity & audit", FileText)}
          {nav("/settings", "Settings", Settings2)}
        </div>
        {term &&
          !matchingModules.length &&
          ![
            "Overview",
            "Reminders",
            "Chat",
            "Notifications",
            "Settings",
            ...(profile.role === "super_admin"
              ? ["Users & access", "Activity & audit"]
              : []),
          ].some((label) => label.toLowerCase().includes(term)) && (
            <p
              role="status"
              className="px-3 py-4 text-xs leading-5 text-muted-foreground"
            >
              No pages match “{pageSearch}”. Try a module name, such as tasks or
              leave.
            </p>
          )}
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
    </>
  );
  return (
    <NavigationDialog.Root open={mobile} onOpenChange={setMobile}>
      <div className="min-h-screen">
        <a
          href="#main-content"
          className="sr-only z-[60] rounded-lg bg-card p-3 text-primary shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-card lg:flex">
          {sidebar()}
        </aside>
        <NavigationDialog.Portal>
          <NavigationDialog.Overlay className="fixed inset-0 z-40 bg-navy/50 backdrop-blur-[2px]" />
          <NavigationDialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(320px,90vw)] flex-col border-r border-border bg-card shadow-xl"
          >
            <NavigationDialog.Title className="sr-only">
              Workspace navigation
            </NavigationDialog.Title>
            {sidebar(true)}
          </NavigationDialog.Content>
        </NavigationDialog.Portal>
        <div className="min-w-0 lg:pl-[248px]">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-2 border-b border-border bg-card/90 px-4 backdrop-blur md:gap-4 lg:px-8">
            <NavigationDialog.Trigger asChild>
              <button
                className="shrink-0 rounded-md p-2 text-foreground lg:hidden"
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={22} />
              </button>
            </NavigationDialog.Trigger>
            <Link
              href="/"
              aria-label="Orbit home"
              className="hidden sm:block lg:hidden"
            >
              <Logo variant="mark" size={22} />
            </Link>
            <form
              action="/search"
              role="search"
              className="flex min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 focus-within:border-primary"
            >
              <input
                ref={searchRef}
                name="q"
                aria-label="Search workspace records"
                placeholder="Search records…"
                maxLength={100}
                className="min-w-0 border-0 bg-transparent px-0 py-1 text-[13px] shadow-none focus:shadow-none"
              />
              <kbd className="hidden whitespace-nowrap rounded border bg-card px-1.5 py-1 text-[10px] text-muted-foreground md:block">
                Ctrl K
              </kbd>
              <button
                type="submit"
                aria-label="Search workspace"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-primary"
              >
                <Search size={17} />
              </button>
            </form>
            <div className="flex items-center gap-1 md:gap-3">
              <ThemeToggle className="text-muted-foreground" />
              <NotificationCentre unread={unreadCount} />
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
          {offline && (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-3 text-sm"
            >
              <WifiOff size={16} className="shrink-0" />
              You’re offline. Reconnect before saving changes or sending
              messages.
            </div>
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto max-w-[1600px] p-4 pb-28 outline-none sm:p-5 sm:pb-28 lg:p-8"
          >
            {children}
          </main>
          <nav
            aria-label="Quick navigation"
            className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-border bg-card/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
          >
            {[
              ["/", "Overview", LayoutDashboard],
              ["/modules/tasks", "Tasks", CheckSquare],
              ["/chat", "Chat", MessageSquare],
              ["/reminders", "Reminders", BellRing],
              ["/notifications", "Inbox", Bell],
            ]
              .filter(
                ([href]) =>
                  href !== "/modules/tasks" || visible.includes("tasks"),
              )
              .map(([href, label, Icon]) => {
                const C = Icon as React.ElementType;
                const active =
                  pathname === href ||
                  (href !== "/" && pathname.startsWith(String(href) + "/"));
                return (
                  <Link
                    key={String(href)}
                    href={String(href)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 min-w-12 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[10px] ${active ? "font-semibold text-primary" : "text-muted-foreground"}`}
                  >
                    <C size={19} />
                    {String(label)}
                  </Link>
                );
              })}
          </nav>
        </div>
      </div>
    </NavigationDialog.Root>
  );
}
