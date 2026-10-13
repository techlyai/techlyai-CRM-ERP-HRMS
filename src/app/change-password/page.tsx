import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { context } from "@/lib/database";
export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password" };
export default async function ChangePassword() {
  await context(true);
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background p-6">
      <ThemeToggle className="absolute right-4 top-4 text-muted-foreground" />
      <div className="panel w-full max-w-md p-8 sm:p-10">
        <Logo size={26} />
        <h1 className="mt-8 text-2xl font-semibold leading-tight">
          Make your account yours
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose a new password to secure your workspace.
        </p>
        <LoginForm configured change />
      </div>
    </div>
  );
}
