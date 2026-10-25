import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { configured } from "@/lib/database";
import { ShieldCheck, Users, Target, BarChart3 } from "lucide-react";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const features = [
  {
    icon: Users,
    title: "People",
    detail: "HR records, attendance, leave and daily reports",
  },
  {
    icon: Target,
    title: "Customers",
    detail: "Leads, clients, renewals and follow-ups",
  },
  {
    icon: BarChart3,
    title: "Operations",
    detail: "Projects, inventory, purchases and finance",
  },
];

export default function LoginPage() {
  const ready = configured();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel: always navy, independent of the app theme. */}
      <section className="relative hidden overflow-hidden bg-navy p-10 text-navy-foreground lg:flex lg:flex-col xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-accent/20 blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-[560px] w-[560px] rounded-full bg-primary/25 blur-[130px]"
        />
        {/* Signature: the Connect symbol, drawn large as two intersecting rings. */}
        <svg
          aria-hidden
          viewBox="0 0 122.5 80"
          className="pointer-events-none absolute -bottom-24 -right-20 h-[380px] w-auto opacity-[.14] xl:h-[460px]"
        >
          <circle
            cx="40"
            cy="40"
            r="39.25"
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth="1.5"
          />
          <circle
            cx="82.5"
            cy="40"
            r="39.25"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
          />
          <clipPath id="login-lens">
            <circle cx="40" cy="40" r="40" />
          </clipPath>
          <circle
            cx="82.5"
            cy="40"
            r="40"
            fill="white"
            fillOpacity="0.18"
            clipPath="url(#login-lens)"
          />
        </svg>

        <div className="relative">
          <Logo tone="dark" size={30} />
        </div>

        <div className="relative my-auto max-w-xl py-12">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.06] px-3 py-1.5 text-[11px] font-medium tracking-wide text-navy-foreground/80">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            One connected workspace
          </span>
          <h1 className="text-[44px] font-semibold leading-[1.1] text-white xl:text-[52px]">
            Where your team
            <br />
            and your customers
            <br />
            <span className="text-accent">connect.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-7 text-navy-foreground/65">
            Orbit brings people, projects, customers and operations into one
            place, so every day starts with a clear picture.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {features.map(({ icon: Icon, title, detail }) => (
              <div
                key={title}
                className="rounded-xl border border-white/10 bg-white/[.05] p-4 backdrop-blur-sm"
              >
                <Icon size={20} className="mb-3 text-accent" strokeWidth={1.75} />
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-1 text-[11px] leading-5 text-navy-foreground/60">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between text-xs text-navy-foreground/50">
          <span>© {new Date().getFullYear()} Techly · Orbit</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} />
            Private company workspace
          </span>
        </div>
      </section>

      {/* Sign-in panel */}
      <section className="relative flex items-center justify-center bg-background px-6 py-12 sm:px-10">
        <ThemeToggle className="absolute right-4 top-4 text-muted-foreground" />
        <div className="w-full max-w-[380px]">
          <Logo variant="stacked" size={40} className="mb-10 w-full lg:hidden" />
          <Logo variant="mark" size={28} className="mb-6 hidden lg:block" />
          <h2 className="text-[28px] font-semibold leading-tight">
            Welcome back
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in with your username or phone number to open your workspace.
          </p>
          {!ready && (
            <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              <p className="font-semibold">Database connection required</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                The application is installed. Configure PostgreSQL, apply the
                schema, and create the first Admin using the steps in
                docs/SETUP.md to enable sign-in.
              </p>
            </div>
          )}
          <LoginForm configured={ready} />
        </div>
      </section>
    </div>
  );
}
