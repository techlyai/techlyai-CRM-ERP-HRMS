import { CheckCircle2, CircleDashed, HelpCircle, MapPinOff, ShieldAlert, XCircle } from "lucide-react";
import {
  photoVerification,
  reportTone,
  reviewInfo,
  toneClass,
  verificationInfo,
  type FieldPhoto,
  type ReportStatus,
  type ReviewStatus,
  type Verification,
} from "@/lib/field";

const icons: Record<Verification, React.ElementType> = {
  verified: CheckCircle2,
  outside: XCircle,
  pending: CircleDashed,
  gps_unavailable: MapPinOff,
  inaccurate: ShieldAlert,
  manual_review: HelpCircle,
};

/** Geofence result with icon and text, so colour is never the only signal. */
export function VerificationBadge({ status, short = false }: { status: Verification; short?: boolean }) {
  const info = verificationInfo[status];
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${toneClass[info.tone]}`}>
      <Icon size={12} aria-hidden /> {short ? info.short : info.label}
    </span>
  );
}
export function PhotoBadge({ photo, short }: { photo: Pick<FieldPhoto, "verification" | "file_path">; short?: boolean }) {
  return <VerificationBadge status={photoVerification(photo)} short={short} />;
}
export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const info = reviewInfo[status];
  return <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${toneClass[info.tone]}`}>{info.label}</span>;
}
export function ReportBadge({ status }: { status: ReportStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${toneClass[reportTone(status)]}`}>{status}</span>;
}
export function SourceBadge({ source }: { source: "camera" | "gallery" }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${source === "camera" ? "border-primary/30 bg-primary/10 text-primary" : toneClass.gray}`}>
      {source === "camera" ? "Camera capture" : "Gallery upload"}
    </span>
  );
}
