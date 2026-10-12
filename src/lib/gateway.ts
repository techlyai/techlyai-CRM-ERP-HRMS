import { timingSafeEqual } from "node:crypto";

// A service credential is additional to session authentication and PostgreSQL RLS.
// Check in route handlers/actions as well as middleware.
export function requireGateway(headers: { get(name: string): string | null }) {
  const expected = process.env.TECHLY_INTERNAL_API_KEY || "";
  const supplied = headers.get("x-techly-service-key") || "";
  if (expected.length < 32 || supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw Error("Unauthorized service request");
  }
}
