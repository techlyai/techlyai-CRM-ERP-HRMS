import Link from "next/link";
import { ActivationForm } from "@/components/activation-form";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { inviteMessages, inviteStatus } from "@/lib/invites";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Activate your account",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: { token?: string | string[] };
}) {
  const token =
    typeof searchParams.token === "string" ? searchParams.token : "";
  let invitation: Awaited<ReturnType<typeof inviteStatus>> | null = null;
  try {
    invitation = await inviteStatus(token);
  } catch {
    // A temporary database failure is different from an invalid invitation.
  }
  const valid = invitation?.state === "valid";
  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background p-6">
      <ThemeToggle className="absolute right-4 top-4 text-muted-foreground" />
      <section className="panel w-full max-w-md p-8 sm:p-10">
        <Logo size={26} />
        <h1 className="mt-8 text-2xl font-semibold leading-tight">
          {valid ? "Activate your account" : "Check your activation link"}
        </h1>
        {valid ? (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {invitation?.name ? `Welcome, ${invitation.name}. ` : ""}
              Choose a password to open your workspace.
            </p>
            <ActivationForm token={token} />
          </>
        ) : (
          <div className="mt-5 space-y-4">
            <p role="alert" className="error">
              {invitation && invitation.state !== "valid"
                ? inviteMessages[invitation.state]
                : "We could not verify your invitation right now. Reload this page to try again."}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {invitation
                ? "If you need a new activation link, contact your administrator."
                : "Your invitation has not been used or changed."}
            </p>
          </div>
        )}
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
