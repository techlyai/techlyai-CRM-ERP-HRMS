"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
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
        Try loading it again. If the problem continues, contact your workspace
        administrator.
      </p>
      {error.digest && (
        <p className="mt-4 text-xs text-muted-foreground">
          Support reference: {error.digest}
        </p>
      )}
      <Button onClick={reset} className="mt-5">
        Try again
      </Button>
      <Button asChild variant="outline" className="ml-2 mt-5">
        <Link href="/">Go to overview</Link>
      </Button>
    </div>
  );
}
