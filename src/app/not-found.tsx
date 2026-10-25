import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <section className="panel w-full max-w-lg p-8 text-center">
        <p className="text-sm font-semibold text-primary">Page not found</p>
        <h1 className="mt-3 text-2xl font-semibold">
          Let’s get you back to your work
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This link may be out of date, or the record may no longer be
          available. Open your overview or search for the record by name.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">
              <ArrowLeft size={16} />
              Go to overview
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/search">
              <Search size={16} />
              Search records
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
