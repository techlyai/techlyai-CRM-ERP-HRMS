"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">We couldn’t load this page.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Check your database connection and that all setup SQL files have been
        applied.
      </p>
      <p className="error mt-4">{error.message}</p>
      <Button onClick={reset} className="mt-5">
        Try again
      </Button>
    </div>
  );
}
