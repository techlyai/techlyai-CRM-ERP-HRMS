export type Notification = {
  id: string;
  category: string;
  title: string;
  body: string;
  record_id: string | null;
  read_at: string | null;
  created_at: string;
};
export type Preferences = {
  muted: boolean;
  volume: number;
  categories: Record<string, { muted?: boolean; sound?: string }>;
  snoozed_until?: string;
};
