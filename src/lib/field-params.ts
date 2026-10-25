import { z } from "zod";
const uuid = z.string().uuid();
const day = /^\d{4}-\d{2}-\d{2}$/;

/** Validated list-page filters from the query string. */
export function fieldParams(p: Record<string, string | undefined>, today: string, defaultDays = 7) {
  const back = new Date(today + "T00:00:00Z");
  back.setUTCDate(back.getUTCDate() - (defaultDays - 1));
  const from = day.test(p.from || "") ? p.from! : back.toISOString().slice(0, 10);
  const to = day.test(p.to || "") ? p.to! : today;
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined);
  return {
    from: from <= to ? from : to,
    to,
    user: uuid.safeParse(p.user).success ? p.user : undefined,
    tl: uuid.safeParse(p.tl).success ? p.tl : undefined,
    photo: uuid.safeParse(p.photo).success ? p.photo : undefined,
    department: p.department && p.department.length <= 100 ? p.department : undefined,
    verification: pick(p.verification, ["verified", "outside", "pending", "gps_unavailable", "inaccurate", "manual_review"] as const),
    review: pick(p.review, ["pending", "approved", "rejected", "clarification"] as const),
    source: pick(p.source, ["camera", "gallery"] as const),
    status: pick(p.status, ["Draft", "Submitted", "Clarification Required", "Resubmitted", "Escalated", "Approved", "Rejected", "In progress", "Ended"] as const),
  };
}
