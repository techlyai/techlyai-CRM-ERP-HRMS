/** Field operations types and helpers shared by server pages and client components. */

export type Verification = "verified" | "outside" | "pending" | "gps_unavailable" | "inaccurate" | "manual_review";
export type ReviewStatus = "pending" | "approved" | "rejected" | "clarification";
export type ReportStatus = "Draft" | "Submitted" | "Clarification Required" | "Resubmitted" | "Escalated" | "Approved" | "Rejected";

export type FieldAssignment = {
  user_id: string;
  enabled: boolean;
  team_leader_id: string | null;
  reporting_admin_id: string | null;
  schedule_days: number[];
  schedule_start: string;
  schedule_end: string;
  interval_seconds: number;
  photo_upload: boolean;
  gallery_allowed: boolean;
  geofence_required: boolean;
  default_radius_m: number;
};
export type FieldSite = {
  id: string;
  name: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  active: boolean;
};
export type FieldSession = {
  id: string;
  user_id: string;
  status: "active" | "ended";
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  window_end: string;
  interval_seconds: number;
  point_count: number;
  distance_m: number;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_point_at: string | null;
};
export type FieldPoint = { latitude: number; longitude: number; accuracy_m: number; captured_at: string; source: string };
export type FieldVisit = {
  id: string;
  session_id: string;
  user_id: string;
  site_id: string | null;
  report_id: string | null;
  title: string;
  purpose: string;
  customer: string;
  description: string;
  notes: string;
  expected_label: string | null;
  expected_lat: number | null;
  expected_lng: number | null;
  expected_radius_m: number | null;
  started_at: string;
  ended_at: string | null;
  start_lat: number | null;
  start_lng: number | null;
  start_accuracy: number | null;
  start_distance_m: number | null;
  start_status: Verification;
  end_lat: number | null;
  end_lng: number | null;
  end_accuracy: number | null;
  end_distance_m: number | null;
  end_status: Verification | null;
};
export type FieldPhoto = {
  id: string;
  user_id: string;
  session_id: string;
  visit_id: string | null;
  report_id: string | null;
  source: "camera" | "gallery";
  file_path: string | null;
  file_name: string;
  mime: string;
  size: number;
  file_uploaded_at: string | null;
  title: string;
  purpose: string;
  customer: string;
  description: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  captured_at: string | null;
  uploaded_at: string;
  expected_label: string | null;
  expected_lat: number | null;
  expected_lng: number | null;
  expected_radius_m: number | null;
  distance_m: number | null;
  verification: Verification;
  checks: Record<string, unknown>;
  review_status: ReviewStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_notes: string;
  location_purged_at: string | null;
};
export type FieldReport = {
  id: string;
  user_id: string;
  session_id: string | null;
  report_date: string;
  title: string;
  work_completed: string;
  customer: string;
  project_id: string | null;
  issues: string;
  next_steps: string;
  eod_record_id: string | null;
  status: ReportStatus;
  version: number;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};
export type FieldEvent = { id: number; report_id: string | null; photo_id: string | null; actor_id: string | null; action: string; body: string; created_at: string };
export type OverviewRow = {
  user_id: string;
  name: string;
  employee_id: string | null;
  department: string | null;
  enabled: boolean;
  team_leader: { id: string; name: string } | null;
  reporting_admin: { id: string; name: string } | null;
  sessions: (Pick<FieldSession, "id" | "status" | "started_at" | "ended_at" | "end_reason" | "point_count" | "last_lat" | "last_lng" | "last_accuracy" | "last_point_at"> & { distance_m: number })[];
  visits: number;
  photos: number;
  failures: number;
  pending_photos: number;
  pending_reports: number;
};

/** Labels and tones for geofence results. Tone is never the only signal: labels are always shown. */
export const verificationInfo: Record<Verification, { label: string; short: string; tone: "green" | "red" | "amber" | "gray" }> = {
  verified: { label: "Verified – Within Geofence", short: "Within geofence", tone: "green" },
  outside: { label: "Failed – Outside Geofence", short: "Outside geofence", tone: "red" },
  pending: { label: "Pending Verification", short: "Pending", tone: "amber" },
  gps_unavailable: { label: "GPS Unavailable", short: "No GPS", tone: "gray" },
  inaccurate: { label: "Inaccurate GPS Reading", short: "Inaccurate GPS", tone: "amber" },
  manual_review: { label: "Manual Review Required", short: "Manual review", tone: "amber" },
};
export const reviewInfo: Record<ReviewStatus, { label: string; tone: "green" | "red" | "amber" | "gray" }> = {
  pending: { label: "Awaiting review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  clarification: { label: "Clarification requested", tone: "amber" },
};
export const toneClass = {
  green: "bg-success/10 text-success border-success/30",
  red: "bg-danger/10 text-danger border-danger/30",
  amber: "bg-warning/10 text-warning border-warning/30",
  gray: "bg-muted text-muted-foreground border-border",
} as const;
export function reportTone(status: ReportStatus) {
  return status === "Approved" ? "green" : status === "Rejected" ? "red" : status === "Draft" ? "gray" : "amber";
}

/** Effective display status of a photo: an unfinished upload is still pending. */
export function photoVerification(p: Pick<FieldPhoto, "verification" | "file_path">): Verification {
  return p.file_path ? p.verification : "pending";
}
export function needsReview(p: Pick<FieldPhoto, "verification" | "review_status" | "file_path">) {
  return p.review_status === "pending" || p.review_status === "clarification"
    ? photoVerification(p) !== "verified"
    : false;
}
export const endReasons: Record<string, string> = {
  employee: "Ended by employee",
  checkout: "Ended at attendance check-out",
  schedule: "Ended at scheduled time",
  admin: "Ended when tracking was disabled",
};
export const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Session state for one overview row on a date. */
export function sessionState(r: OverviewRow): "active" | "completed" | "not_started" {
  if (r.sessions.some((s) => s.status === "active")) return "active";
  return r.sessions.length ? "completed" : "not_started";
}

/** Route length in metres along points, skipping imprecise readings. */
export function routeLength(points: Pick<FieldPoint, "latitude" | "longitude" | "accuracy_m">[], maxAccuracy = 100) {
  const good = points.filter((p) => p.accuracy_m <= maxAccuracy);
  let total = 0;
  for (let i = 1; i < good.length; i++) {
    const a = good[i - 1];
    const b = good[i];
    const rad = (d: number) => (d * Math.PI) / 180;
    const h =
      Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
      Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    total += 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  return total;
}

/** Points waiting to be sent, kept on the device so a network drop loses nothing. */
export type QueuedPoint = { client_id: string; lat: number; lng: number; accuracy: number; captured_at: string; source: "track" };
export function mergeQueue(queue: QueuedPoint[], add: QueuedPoint[], max = 2000) {
  const seen = new Set(queue.map((p) => p.client_id));
  const merged = [...queue, ...add.filter((p) => !seen.has(p.client_id))];
  return merged.slice(Math.max(0, merged.length - max));
}
