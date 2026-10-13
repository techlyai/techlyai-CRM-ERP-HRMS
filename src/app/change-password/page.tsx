import { LoginForm } from "@/components/login-form";
import { context } from "@/lib/database";
export const dynamic = "force-dynamic";
export default async function ChangePassword() {
  await context(true);
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-full max-w-md p-8">
        <p className="text-xl font-bold">
          techly<span className="text-primary">.</span>
        </p>
        <h1 className="mt-8 text-2xl font-semibold">
          Make your account yours.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Choose a new password to secure your workspace.
        </p>
        <LoginForm configured change />
      </div>
    </div>
  );
}
