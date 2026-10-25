// Pure helpers and shared types for the employee chat. No React or Next imports
// so the same module runs inside node:test (tests/chat.test.ts) and the browser.
export type ProfileRole = "super_admin" | "manager" | "employee";
export type Member = {
  id: string;
  name: string;
  /** Company role of the person (not their role inside the group). */
  role: ProfileRole | string;
  online: boolean;
  /** Group role from conversation_members; only present on thread payloads. */
  group_role?: "member" | "admin";
  last_seen_at?: string | null;
  last_read_at?: string | null;
};
export type LastMessage = { body: string; sender: string; at: string } | null;
export type Conversation = {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  department: string | null;
  project_id: string | null;
  official: boolean;
  last_message_at: string | null;
  muted: boolean;
  pinned: boolean;
  role: "member" | "admin" | null;
  members: Member[];
  unread: number;
  last: LastMessage;
  /** True when the caller is not a member and sees it through Admin review. */
  review?: boolean;
};
export type ChatAttachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
};
export type ReplyPreview = {
  id: string;
  sender_name: string;
  body: string;
  deleted: boolean;
  attachment_name: string | null;
};
export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  reply_to: string | null;
  reply: ReplyPreview | null;
  attachment: ChatAttachment | null;
  pinned: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  read_by: string[];
};
export type MessageReport = {
  id: string;
  message_id: string;
  conversation_id: string | null;
  reporter_id: string;
  reporter_name: string;
  reason: string;
  status: "open" | "dismissed" | "actioned";
  created_at: string;
};
export type DirectoryPerson = {
  id: string;
  full_name: string;
  department: string | null;
  role: ProfileRole;
};
export type ChatPolicy = {
  group_creation: "admins" | "managers" | "everyone";
  direct_messages: "everyone" | "team";
  edit_minutes: number;
  admin_review: boolean;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/** Chat attachments live at '<uploaderId>/chat/<conversationId>/<fileId>.<ext>'. */
export function parseChatPath(path: string) {
  const m = /^([^/]+)\/chat\/([^/]+)\/([^/.]+)\.([a-z0-9]{1,5})$/.exec(path);
  if (!m || !isUuid(m[1]) || !isUuid(m[2]) || !isUuid(m[3])) return null;
  return { uploader: m[1], conversation: m[2], file: m[3], ext: m[4] };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar day key, e.g. 2026-10-13. */
export function dayKey(input: string | Date) {
  const d = typeof input === "string" ? new Date(input) : input;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function dayLabel(key: string, now = new Date()) {
  const [y, m, d] = key.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const diff = Math.round(
    (startOfDay(now).getTime() - day.getTime()) / 86400000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7)
    return day.toLocaleDateString(undefined, { weekday: "long" });
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: day.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
export type DayGroup<T> = { key: string; label: string; items: T[] };
/** Groups messages (already sorted ascending) by local calendar day. */
export function groupByDay<T extends { created_at: string }>(
  messages: T[],
  now = new Date(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const message of messages) {
    const key = dayKey(message.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(message);
    else groups.push({ key, label: dayLabel(key, now), items: [message] });
  }
  return groups;
}

/** Other members who have read up to (and including) this message. */
export function readersOf(
  message: { sender_id: string; created_at: string },
  members: Pick<Member, "id" | "name" | "last_read_at">[],
  me: string,
) {
  const sent = Date.parse(message.created_at);
  return members
    .filter(
      (m) =>
        m.id !== me &&
        m.id !== message.sender_id &&
        m.last_read_at &&
        Date.parse(m.last_read_at) >= sent,
    )
    .map((m) => m.name);
}

/** Merge polled messages into the loaded list by id, keeping chronological order. */
export function mergeMessages<T extends { id: string; created_at: string }>(
  existing: T[],
  incoming: T[],
) {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/** The timestamp a poll should resume from: the newest activity minus a small overlap. */
export function pollCursor(
  messages: {
    created_at: string;
    edited_at: string | null;
    deleted_at: string | null;
  }[],
  overlapMs = 2000,
) {
  let max = 0;
  for (const m of messages)
    for (const t of [m.created_at, m.edited_at, m.deleted_at])
      if (t) max = Math.max(max, Date.parse(t));
  return max ? new Date(max - overlapMs).toISOString() : null;
}

export function canEditMessage(
  message: { sender_id: string; deleted_at: string | null; created_at: string },
  me: string,
  editMinutes: number,
  now = new Date(),
) {
  if (message.sender_id !== me || message.deleted_at) return false;
  if (editMinutes < 0) return true;
  return now.getTime() - Date.parse(message.created_at) <= editMinutes * 60000;
}

export function conversationTitle(
  c: Pick<Conversation, "kind" | "name" | "members">,
  me: string,
) {
  if (c.kind === "group") return c.name || "Group";
  const other = c.members.find((m) => m.id !== me);
  return other?.name || "Direct message";
}
export function otherMember(c: Pick<Conversation, "members">, me: string) {
  return c.members.find((m) => m.id !== me) || null;
}

export const isOnline = (lastSeen: string | null | undefined, now = new Date()) =>
  Boolean(lastSeen) && now.getTime() - Date.parse(lastSeen as string) < 120000;

/** Collapse the sender header when the same person writes again within five minutes. */
export function continuesThread(
  prev: { sender_id: string; created_at: string } | undefined,
  cur: { sender_id: string; created_at: string },
) {
  if (!prev || prev.sender_id !== cur.sender_id) return false;
  if (dayKey(prev.created_at) !== dayKey(cur.created_at)) return false;
  return Date.parse(cur.created_at) - Date.parse(prev.created_at) < 5 * 60000;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
export function relativeTime(iso: string | null, now = new Date()) {
  if (!iso) return "";
  const diff = now.getTime() - Date.parse(iso);
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (dayKey(iso) === dayKey(now)) return formatTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday)) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
export const isImage = (mime: string) => /^image\//.test(mime);

/** Mirrors private.can_chat_with for the people picker. */
export function canDirectMessage(
  me: Pick<DirectoryPerson, "id" | "role" | "department"> & {
    manager_id: string | null;
  },
  them: DirectoryPerson & { manager_id?: string | null },
  policy: ChatPolicy["direct_messages"],
) {
  if (me.id === them.id) return false;
  if (me.role !== "employee" || them.role !== "employee") return true;
  if (policy === "everyone") return true;
  const sameManager =
    me.manager_id !== null &&
    me.manager_id !== undefined &&
    me.manager_id === (them.manager_id ?? null);
  const sameDepartment = (me.department ?? null) === (them.department ?? null);
  return sameManager || sameDepartment;
}
export function canCreateGroups(
  role: ProfileRole,
  policy: ChatPolicy["group_creation"],
) {
  return (
    role === "super_admin" ||
    (policy === "managers" && role === "manager") ||
    policy === "everyone"
  );
}
