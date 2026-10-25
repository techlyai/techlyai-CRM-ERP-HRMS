export type Notification = {
  id: string;
  category: string;
  title: string;
  body: string;
  record_id: string | null;
  read_at: string | null;
  created_at: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  link: string | null;
  meta: Record<string, unknown>;
};
/** Sound selection: a stored upload path, or "builtin:<tone>" from the built-in library. */
export type SoundChoice = string;
export type Preferences = {
  muted: boolean;
  volume: number;
  /** Per-category overrides keyed by notification category. */
  categories: Record<string, { muted?: boolean; sound?: SoundChoice }>;
  /** Personal default sound for every category without an override. */
  default_sound?: SoundChoice;
  snoozed_until?: string;
};
/** Company-wide sound defaults stored in settings.data.sounds. */
export type CompanySounds = {
  default: SoundChoice;
  categories: Record<string, SoundChoice>;
};
/** Notification categories and their human labels, grouped for settings screens. */
export const notificationCategories: { key: string; label: string; group: string }[] = [
  { key: "reminder-yearly", label: "Yearly reminders", group: "Reminders" },
  { key: "reminder-monthly", label: "Monthly reminders", group: "Reminders" },
  { key: "reminder-custom", label: "Custom & one-time reminders", group: "Reminders" },
  { key: "chat", label: "Chat messages", group: "Team" },
  { key: "eod", label: "Daily report submissions", group: "Reports" },
  { key: "questions", label: "Report questions & replies", group: "Reports" },
  { key: "approvals", label: "Approvals & decisions", group: "Reports" },
  { key: "renewals", label: "Renewals", group: "Business" },
  { key: "payments", label: "Vendor payments due", group: "Business" },
  { key: "followups", label: "Lead follow-ups", group: "Business" },
  { key: "tasks", label: "Task deadlines", group: "Work" },
  { key: "projects", label: "Project updates", group: "Work" },
  { key: "attendance", label: "Attendance", group: "Work" },
  { key: "field", label: "Field operations & GPS photos", group: "Work" },
  { key: "maintenance", label: "Asset maintenance", group: "Operations" },
  { key: "stock", label: "Low stock", group: "Operations" },
];
