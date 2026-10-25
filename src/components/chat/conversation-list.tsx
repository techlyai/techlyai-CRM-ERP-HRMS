"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Pin,
  BellOff,
  ShieldCheck,
  Flag,
  MessageSquare,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  conversationTitle,
  otherMember,
  relativeTime,
  type Conversation,
  type MessageReport,
} from "./helpers";
import { GroupAvatar, PersonAvatar } from "./bits";
import { readChat } from "./client-api";
export type SearchHit = {
  id: string;
  conversation_id: string;
  conversation_kind: string;
  conversation_name: string | null;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};
export function ConversationList({
  me,
  meName,
  conversations,
  review,
  reports,
  selected,
  onOpen,
  className,
}: {
  me: string;
  meName: string;
  conversations: Conversation[];
  review: Conversation[];
  reports: MessageReport[];
  selected: string | null;
  onOpen: (id: string, focusMessage?: string) => void;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const term = q.trim().toLowerCase();
  // Message search runs server-side after a short pause in typing.
  useEffect(() => {
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setHits([]);
    setSearchError(false);
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await readChat<{ results: SearchHit[] }>(
          "/api/chat/search?q=" + encodeURIComponent(term),
          controller.signal,
        );
        if (!controller.signal.aborted) setHits(data.results);
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, searchAttempt]);
  const everything = useMemo(
    () => [...conversations, ...review],
    [conversations, review],
  );
  const titleOf = (id: string) => {
    const c = everything.find((x) => x.id === id);
    return c ? conversationTitle(c, me) : "Conversation";
  };
  const matches = (c: Conversation) =>
    !term ||
    conversationTitle(c, me).toLowerCase().includes(term) ||
    (c.department || "").toLowerCase().includes(term) ||
    c.members.some((m) => m.name.toLowerCase().includes(term));
  const visible = conversations.filter(matches);
  const reviewable = review.filter(matches);
  const reportCount = reports.length;
  return (
    <aside
      className={cn(
        "w-full shrink-0 flex-col border-border bg-card lg:w-[320px] lg:border-r",
        className,
      )}
      aria-label="Conversations"
    >
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, groups and messages"
            aria-label="Search conversations and messages"
            className="border-0 bg-transparent px-0 py-2 text-[13px] shadow-none focus:shadow-none"
          />
          {q ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reportCount > 0 && !term && (
          <div className="border-b border-border bg-warning/5 px-4 py-2.5">
            <p className="flex items-center gap-2 text-[11px] font-semibold text-warning">
              <Flag size={12} />
              {reportCount} reported{" "}
              {reportCount === 1 ? "message" : "messages"} awaiting review
            </p>
            <ul className="mt-1.5 space-y-1">
              {reports.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={!r.conversation_id}
                    onClick={() =>
                      r.conversation_id &&
                      onOpen(r.conversation_id, r.message_id)
                    }
                    className="w-full truncate text-left text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                  >
                    {r.reporter_name}: {r.reason}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {term && (
          <SectionLabel>
            {searching ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> Searching
                messages
              </span>
            ) : (
              `Conversations (${visible.length + reviewable.length})`
            )}
          </SectionLabel>
        )}
        <ul>
          {visible.map((c) => (
            <ConversationRow
              key={c.id}
              c={c}
              me={me}
              meName={meName}
              active={c.id === selected}
              onClick={() => onOpen(c.id)}
            />
          ))}
        </ul>
        {term && !visible.length && !reviewable.length && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            No conversations match. Try another name or department.
          </p>
        )}
        {!visible.length && !term && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="icon-tile mb-3 h-10 w-10">
              <MessageSquare size={18} />
            </span>
            <p className="text-sm font-medium">No conversations yet</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Start a direct message or create a group to begin.
            </p>
          </div>
        )}
        {reviewable.length > 0 && (
          <>
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={11} /> Admin review
              </span>
            </SectionLabel>
            <ul>
              {reviewable.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  me={me}
                  meName={meName}
                  active={c.id === selected}
                  onClick={() => onOpen(c.id)}
                />
              ))}
            </ul>
          </>
        )}
        {term.length >= 2 && (
          <>
            <SectionLabel>Messages ({hits.length})</SectionLabel>
            {searchError && (
              <p role="alert" className="px-4 pb-4 text-xs text-danger">
                Message search could not connect.{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => setSearchAttempt((value) => value + 1)}
                >
                  Try again
                </button>
              </p>
            )}
            {!hits.length && !searching && !searchError && (
              <p className="px-4 pb-4 text-xs text-muted-foreground">
                No messages match.
              </p>
            )}
            <ul>
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(h.conversation_id, h.id)}
                    className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate font-medium text-foreground">
                        {h.conversation_kind === "group"
                          ? h.conversation_name || "Group"
                          : titleOf(h.conversation_id)}
                      </span>
                      <span className="ml-auto shrink-0">
                        {relativeTime(h.created_at)}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-xs">
                      <span className="font-medium">
                        {h.sender_id === me ? "You" : h.sender_name}:
                      </span>{" "}
                      {h.body}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
      {children}
    </div>
  );
}
function ConversationRow({
  c,
  me,
  meName,
  active,
  onClick,
}: {
  c: Conversation;
  me: string;
  meName: string;
  active: boolean;
  onClick: () => void;
}) {
  const title = conversationTitle(c, me);
  const other = c.kind === "direct" ? otherMember(c, me) : null;
  const online = c.members.filter((m) => m.id !== me && m.online).length;
  const preview = c.last
    ? `${c.last.sender === meName ? "You" : c.last.sender.split(" ")[0]}: ${c.last.body}`
    : c.review
      ? "Not a member · review access"
      : "No messages yet";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
          active && "bg-primary/[0.07] hover:bg-primary/[0.09]",
        )}
      >
        {c.kind === "group" ? (
          <GroupAvatar />
        ) : (
          <PersonAvatar
            name={other?.name || title}
            online={Boolean(other?.online)}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[13px]",
                c.unread > 0 ? "font-semibold" : "font-medium",
              )}
            >
              {title}
            </span>
            {c.official && (
              <ShieldCheck
                size={12}
                className="shrink-0 text-primary"
                aria-label="Official group"
              />
            )}
            {c.pinned && (
              <Pin
                size={11}
                className="shrink-0 text-muted-foreground"
                aria-label="Pinned"
              />
            )}
            {c.muted && (
              <BellOff
                size={11}
                className="shrink-0 text-muted-foreground"
                aria-label="Muted"
              />
            )}
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {relativeTime(c.last?.at || c.last_message_at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                "truncate text-xs",
                c.unread > 0 && !c.muted
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {preview}
            </span>
            {c.kind === "group" && online > 0 && c.unread === 0 && (
              <span className="ml-auto shrink-0 text-[10px] text-success">
                {online} online
              </span>
            )}
            {c.unread > 0 && (
              <span
                className={cn(
                  "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                  c.muted
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
