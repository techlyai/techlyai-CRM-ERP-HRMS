"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Download,
  Loader2,
  MessageSquare,
  Paperclip,
  Pin,
  RefreshCw,
  Reply,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFile } from "@/components/attachments";
import {
  heartbeat,
  markRead,
  reviewConversation,
  sendMessage,
  setConversationPrefs,
} from "@/lib/chat-actions";
import { cn } from "@/lib/utils";
import { GroupAvatar, IconButton, PersonAvatar } from "./bits";
import { MembersDialog } from "./dialogs";
import { readChat } from "./client-api";
import {
  conversationTitle,
  formatSize,
  formatTime,
  groupByDay,
  mergeMessages,
  otherMember,
  pollCursor,
  readersOf,
  type ChatAttachment,
  type ChatMessage,
  type Conversation,
  type DirectoryPerson,
} from "./helpers";

type ThreadPayload = {
  conversation: Conversation;
  messages: ChatMessage[];
  typing: string[];
  hasMore: boolean;
};

export function ConversationThread({
  id,
  me,
  isAdmin,
  directory,
  focusMessage,
  draft,
  onDraftChange,
  onBack,
  onChanged,
}: {
  id: string;
  me: string;
  isAdmin: boolean;
  directory: DirectoryPerson[];
  focusMessage?: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [retry, setRetry] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [busyPrefs, setBusyPrefs] = useState(false);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const nearBottom = useRef(true);
  const olderPosition = useRef<{ height: number; top: number } | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const olderRef = useRef<() => void>(() => {});
  const sendingRef = useRef(false);
  const typingRef = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let paging = false;
    let audited = false;
    let lastRead = "";
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        if (!audited) {
          const result = await reviewConversation(id);
          if (!result.ok)
            throw Error(result.error || "This conversation is unavailable.");
          audited = true;
        }
        if (controller.signal.aborted) return;
        const cursor = pollCursor(messagesRef.current);
        const query = new URLSearchParams({ conversation: id });
        if (cursor) query.set("after", cursor);
        const data = await readChat<ThreadPayload>(
          "/api/chat/messages?" + query,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const merged = mergeMessages(messagesRef.current, data.messages);
        messagesRef.current = merged;
        setConversation(data.conversation);
        setMessages(merged);
        setTyping(data.typing);
        if (!cursor) setHasMore(data.hasMore);
        setError("");
        const newest = merged[merged.length - 1]?.id || "empty";
        if (
          !data.conversation.review &&
          newest !== lastRead &&
          !document.hidden
        ) {
          const result = await markRead(id);
          if (controller.signal.aborted) return;
          if (result.ok) {
            lastRead = newest;
            onChanged();
          } else
            setError(
              "Messages loaded, but the read status could not update. Retrying automatically.",
            );
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load this conversation.",
          );
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const loadOlder = async () => {
      const first = messagesRef.current[0];
      if (paging || !first) return;
      paging = true;
      setLoadingOlder(true);
      try {
        const query = new URLSearchParams({
          conversation: id,
          before: first.created_at,
        });
        const data = await readChat<ThreadPayload>(
          "/api/chat/messages?" + query,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const viewport = scrollRef.current;
        if (viewport)
          olderPosition.current = {
            height: viewport.scrollHeight,
            top: viewport.scrollTop,
          };
        messagesRef.current = mergeMessages(messagesRef.current, data.messages);
        setMessages(messagesRef.current);
        setHasMore(data.hasMore);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load earlier messages.",
          );
      } finally {
        paging = false;
        if (!controller.signal.aborted) setLoadingOlder(false);
      }
    };
    const ping = () => {
      if (!document.hidden)
        void heartbeat(Date.now() - typingRef.current < 5000 ? id : null).catch(
          () => {},
        );
    };
    refreshRef.current = () => void load();
    olderRef.current = () => void loadOlder();
    void load();
    ping();
    const timer = window.setInterval(load, 5000);
    const presenceTimer = window.setInterval(ping, 10000);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(presenceTimer);
      document.removeEventListener("visibilitychange", load);
      refreshRef.current = () => {};
      olderRef.current = () => {};
    };
  }, [id, onChanged, retry]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (olderPosition.current) {
      viewport.scrollTop =
        olderPosition.current.top +
        viewport.scrollHeight -
        olderPosition.current.height;
      olderPosition.current = null;
    } else if (nearBottom.current) viewport.scrollTop = viewport.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (!focusMessage) return;
    const target = document.getElementById("chat-message-" + focusMessage);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      nearBottom.current = false;
    }
  }, [focusMessage, messages.length]);

  useEffect(() => {
    if (
      focusMessage &&
      !loading &&
      !loadingOlder &&
      !error &&
      hasMore &&
      !messages.some((message) => message.id === focusMessage)
    ) {
      olderRef.current();
    }
  }, [focusMessage, loading, loadingOlder, error, hasMore, messages]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      sendingRef.current ||
      (!draft.trim() && !file) ||
      !conversation ||
      conversation.review
    )
      return;
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    try {
      let uploaded = attachment;
      if (file && !uploaded) {
        const path = await uploadFile(undefined, file, false, id);
        uploaded = {
          path,
          name: file.name,
          mime:
            file.type ||
            (file.name.endsWith(".csv")
              ? "text/csv"
              : "application/octet-stream"),
          size: file.size,
        };
        if (mounted.current) setAttachment(uploaded);
      }
      const result = await sendMessage({
        conversation: id,
        body: draft.trim(),
        replyTo: reply?.id,
        attachment: uploaded,
      });
      if (!result.ok)
        throw Error(
          result.error || "Your message could not be sent. Try again.",
        );
      onDraftChange("");
      onChanged();
      if (mounted.current) {
        setFile(null);
        setAttachment(null);
        setReply(null);
        nearBottom.current = true;
        refreshRef.current();
        composerRef.current?.focus();
      }
    } catch (cause) {
      if (mounted.current)
        setSendError(
          cause instanceof Error
            ? cause.message
            : "Your message could not be sent. Your draft is still here.",
        );
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const preferences = async (input: { muted?: boolean; pinned?: boolean }) => {
    setBusyPrefs(true);
    try {
      const result = await setConversationPrefs({ conversation: id, ...input });
      if (!result.ok)
        throw Error(
          result.error || "Could not update conversation preferences.",
        );
      if (mounted.current) {
        setConversation((current) =>
          current ? { ...current, ...input } : current,
        );
        onChanged();
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not update preferences.",
        );
    } finally {
      if (mounted.current) setBusyPrefs(false);
    }
  };
  const title = conversation
    ? conversationTitle(conversation, me)
    : "Conversation";
  const other = conversation ? otherMember(conversation, me) : null;
  const missingFocus =
    focusMessage && !messages.some((message) => message.id === focusMessage);

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={title}>
      <header className="flex min-h-[65px] items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <IconButton
          label="Back to conversations"
          onClick={onBack}
          className="lg:hidden"
        >
          <ArrowLeft size={18} />
        </IconButton>
        {conversation?.kind === "group" ? (
          <GroupAvatar />
        ) : (
          <PersonAvatar name={title} online={other?.online} />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {conversation?.review
              ? "Admin review · read only"
              : conversation?.kind === "group"
                ? `${conversation.members.length} members`
                : other?.online
                  ? "Online"
                  : "Direct message"}
          </p>
        </div>
        {conversation?.kind === "group" && (
          <IconButton
            label="View group members"
            onClick={() => setMembersOpen(true)}
          >
            <Users size={17} />
          </IconButton>
        )}
        {conversation && !conversation.review && (
          <>
            <IconButton
              label={
                conversation.pinned ? "Unpin conversation" : "Pin conversation"
              }
              active={conversation.pinned}
              disabled={busyPrefs}
              onClick={() => void preferences({ pinned: !conversation.pinned })}
            >
              <Pin size={16} />
            </IconButton>
            <IconButton
              label={
                conversation.muted ? "Unmute conversation" : "Mute conversation"
              }
              active={conversation.muted}
              disabled={busyPrefs}
              onClick={() => void preferences({ muted: !conversation.muted })}
            >
              {conversation.muted ? <BellOff size={16} /> : <Bell size={16} />}
            </IconButton>
          </>
        )}
      </header>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/20 bg-danger/5 px-4 py-2 text-xs"
        >
          <p>{error}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={12} />
            Retry
          </Button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={() => {
          const node = scrollRef.current;
          if (node)
            nearBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 100;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        aria-busy={loading}
      >
        {loading ? (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 size={18} className="animate-spin" />
            Loading messages…
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="mb-4 text-center">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingOlder}
                  onClick={() => olderRef.current()}
                >
                  {loadingOlder && (
                    <Loader2 size={13} className="animate-spin" />
                  )}
                  Load earlier messages
                </Button>
              </div>
            )}
            {missingFocus && (
              <p
                role="status"
                className="mb-4 rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground"
              >
                {hasMore
                  ? "Finding the selected message in earlier history…"
                  : "The selected message is no longer available in this conversation."}
              </p>
            )}
            {!messages.length && !error && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <MessageSquare
                  size={28}
                  className="mb-1 text-muted-foreground"
                />
                <p className="text-sm font-medium">Start the conversation</p>
                <p className="text-xs text-muted-foreground">
                  Send a message to get things moving.
                </p>
              </div>
            )}
            {groupByDay(messages).map((day) => (
              <div key={day.key}>
                <p className="my-4 text-center text-[11px] font-medium text-muted-foreground">
                  {day.label}
                </p>
                <ul className="space-y-3">
                  {day.items.map((message) => (
                    <li
                      key={message.id}
                      id={"chat-message-" + message.id}
                      className={cn(
                        "flex",
                        message.sender_id === me
                          ? "justify-end"
                          : "justify-start",
                      )}
                    >
                      <article
                        className={cn(
                          "max-w-[90%] rounded-xl border px-3 py-2 sm:max-w-[80%]",
                          message.sender_id === me
                            ? "border-primary/10 bg-primary/[0.07]"
                            : "border-border bg-background",
                          message.id === focusMessage &&
                            "ring-2 ring-primary ring-offset-2 ring-offset-card",
                        )}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span className="font-semibold">
                            {message.sender_id === me
                              ? "You"
                              : message.sender_name}
                          </span>
                          <time
                            className="text-muted-foreground"
                            dateTime={message.created_at}
                            title={new Date(
                              message.created_at,
                            ).toLocaleString()}
                          >
                            {formatTime(message.created_at)}
                          </time>
                          {message.pinned && (
                            <Pin size={11} className="text-primary" />
                          )}
                        </div>
                        {message.deleted_at ? (
                          <p className="text-xs italic text-muted-foreground">
                            Message deleted
                          </p>
                        ) : (
                          <>
                            {message.reply && (
                              <div className="mb-2 border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                                <p className="font-medium">
                                  {message.reply.sender_name}
                                </p>
                                <p className="line-clamp-2 break-words">
                                  {message.reply.deleted
                                    ? "Message deleted"
                                    : message.reply.body ||
                                      message.reply.attachment_name}
                                </p>
                              </div>
                            )}
                            {message.body && (
                              <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                                {message.body}
                              </p>
                            )}
                            {message.attachment && (
                              <a
                                href={
                                  "/api/chat/file?path=" +
                                  encodeURIComponent(message.attachment.path)
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 flex max-w-full items-center gap-2 rounded-lg border border-border bg-card p-2 text-xs hover:border-primary/40"
                              >
                                <Download
                                  size={15}
                                  className="shrink-0 text-primary"
                                />
                                <span className="min-w-0">
                                  <span className="block break-all font-medium">
                                    {message.attachment.name}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {formatSize(message.attachment.size)} · Open
                                    file
                                  </span>
                                </span>
                              </a>
                            )}
                            <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                              {message.edited_at && <span>Edited</span>}
                              {message.sender_id === me && (
                                <ReadReceipt
                                  message={message}
                                  conversation={conversation}
                                  me={me}
                                />
                              )}
                              {!conversation?.review && (
                                <button
                                  type="button"
                                  aria-label={"Reply to " + message.sender_name}
                                  title="Reply"
                                  className="rounded p-1 hover:bg-muted hover:text-foreground"
                                  onClick={() => {
                                    setReply(message);
                                    composerRef.current?.focus();
                                  }}
                                >
                                  <Reply size={13} />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </article>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
      {conversation?.review ? (
        <p className="flex items-center gap-2 border-t border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          <ShieldCheck size={16} />
          You are reviewing this conversation. Your access is recorded.
        </p>
      ) : (
        conversation && (
          <form onSubmit={submit} className="border-t border-border p-3 sm:p-4">
            {typing.length > 0 && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                {typing.join(", ")} {typing.length === 1 ? "is" : "are"} typing…
              </p>
            )}
            {reply && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    Replying to {reply.sender_name}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {reply.body || reply.attachment?.name}
                  </span>
                </span>
                <IconButton
                  label="Cancel reply"
                  disabled={sending}
                  onClick={() => setReply(null)}
                >
                  <X size={14} />
                </IconButton>
              </div>
            )}
            {file && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
                <Paperclip size={14} />
                <span className="min-w-0 flex-1 truncate">
                  {file.name} · {formatSize(file.size)}
                </span>
                <IconButton
                  label="Remove attachment"
                  disabled={sending}
                  onClick={() => {
                    setFile(null);
                    setAttachment(null);
                  }}
                >
                  <X size={14} />
                </IconButton>
              </div>
            )}
            {sendError && (
              <p role="alert" className="mb-2 text-xs text-danger">
                {sendError}
              </p>
            )}
            <label htmlFor={"message-" + id} className="sr-only">
              Message {title}
            </label>
            <textarea
              ref={composerRef}
              id={"message-" + id}
              value={draft}
              maxLength={10000}
              disabled={sending}
              rows={2}
              placeholder={"Message " + title + "…"}
              className="min-h-[72px] max-h-40 resize-y text-sm"
              onChange={(event) => {
                onDraftChange(event.target.value);
                typingRef.current = Date.now();
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                aria-label="Attach a file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.csv"
                disabled={sending}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  event.target.value = "";
                  if (!selected) return;
                  if (selected.size > 20 * 1024 * 1024 || selected.size === 0) {
                    setSendError("Choose a file between 1 byte and 20 MB.");
                    return;
                  }
                  setFile(selected);
                  setAttachment(null);
                  setSendError("");
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={sending}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip size={14} />
                Attach
              </Button>
              <span className="hidden text-[10px] text-muted-foreground sm:inline">
                Enter to send · Shift + Enter for a new line
              </span>
              <Button
                className="ml-auto"
                size="sm"
                type="submit"
                disabled={sending || (!draft.trim() && !file)}
              >
                {sending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )
      )}
      {conversation?.kind === "group" && (
        <MembersDialog
          open={membersOpen}
          onOpenChange={setMembersOpen}
          conversation={id}
          members={conversation.members}
          me={me}
          directory={directory}
          canManage={isAdmin || conversation.role === "admin"}
          onChanged={() => {
            refreshRef.current();
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function ReadReceipt({
  message,
  conversation,
  me,
}: {
  message: ChatMessage;
  conversation: Conversation | null;
  me: string;
}) {
  const readers = conversation
    ? readersOf(message, conversation.members, me)
    : message.read_by;
  return (
    <span title={readers.join(", ")}>
      {readers.length ? `Read by ${readers.length}` : "Sent"}
    </span>
  );
}
