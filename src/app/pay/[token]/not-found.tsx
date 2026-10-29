import { Logo } from "@/components/logo";

/** Shown for a wrong or removed payment link instead of the workspace "Page not found". */
export default function PayLinkNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <section className="panel w-full max-w-md p-8 text-center">
        <div className="flex justify-center"><Logo size={26} /></div>
        <h1 className="mt-5 text-lg font-semibold">This payment link is not valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be incomplete or no longer active. Please use the latest Pay now link we sent you on WhatsApp, or contact us.
        </p>
      </section>
    </main>
  );
}
