import { LoginForm } from "@/components/login-form";
export const dynamic = "force-dynamic";
import { configured } from "@/lib/database";
import {
  Layers3,
  ShieldCheck,
  ArrowUpRight,
  Users,
  BarChart3,
  CheckCircle2,
} from "lucide-react";
export default function LoginPage() {
  const ready = configured();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#151129] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-32 top-40 h-96 w-96 rounded-full bg-violet-600/20 blur-[100px]" />
        <div className="absolute -left-20 bottom-0 h-80 w-80 rounded-full bg-indigo-600/20 blur-[100px]" />
        <div className="relative text-3xl font-bold tracking-tight">
          techly<span className="text-violet-400">.</span>
        </div>
        <div className="relative my-auto max-w-xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-[11px] text-violet-200">
            <Layers3 size={13} /> One workspace. Every possibility.
          </div>
          <h1 className="text-[52px] font-semibold leading-[1.13] tracking-tight">
            Great work starts
            <br />
            with a{" "}
            <span className="text-violet-400">
              connected
              <br />
              team.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-slate-400">
            Bring your people, projects, customers, and operations together.
            Less busywork. More moving forward.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              [Users, "People first"],
              [BarChart3, "Clear insights"],
              [CheckCircle2, "Built to work"],
            ].map(([Icon, label]) => {
              const I = Icon as React.ElementType;
              return (
                <div
                  key={String(label)}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <I size={21} className="mb-3 text-violet-300" />
                  <p className="text-xs text-slate-300">{String(label)}</p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="relative flex items-center justify-between text-xs text-slate-500">
          <span>© {new Date().getFullYear()} Techly</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} />
            Private company workspace
          </span>
        </div>
      </div>
      <div className="flex items-center justify-center bg-card px-6 py-14">
        <div className="w-full max-w-[380px]">
          <div className="mb-12 text-3xl font-bold lg:hidden">
            techly<span className="text-primary">.</span>
          </div>
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-primary">
            <ArrowUpRight size={23} />
          </div>
          <p className="mb-3 text-xs font-medium text-primary">
            YOUR WORKSPACE AWAITS
          </p>
          <h2 className="text-3xl font-semibold tracking-tight">
            Welcome back.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in to keep your business moving.
          </p>
          {!ready && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Database connection required</p>
              <p className="mt-2 text-xs leading-5">
                The application is installed. Configure PostgreSQL, apply the
                schema, and create the first Admin using the steps in
                docs/SETUP.md to enable sign-in.
              </p>
            </div>
          )}
          <LoginForm configured={ready} />
        </div>
      </div>
    </div>
  );
}
