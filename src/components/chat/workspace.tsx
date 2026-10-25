"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MessageSquare, Plus, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationList } from "./conversation-list";
import { NewGroupDialog, NewMessageDialog } from "./dialogs";
import { ConversationThread } from "./thread";
import { readChat } from "./client-api";
import {
  isUuid,
  type Conversation,
  type DirectoryPerson,
  type MessageReport,
} from "./helpers";

export type Overview = {
  conversations: Conversation[];
  review: Conversation[];
  reports: MessageReport[];
};

export function ChatWorkspace({
  me,
  meName,
  isAdmin,
  canCreateGroups,
  directDirectory,
  directory,
  projects,
  initialConversation,
}: {
  me: string;
  meName: string;
  isAdmin: boolean;
  canCreateGroups: boolean;
  directDirectory: DirectoryPerson[];
  directory: DirectoryPerson[];
  projects: { id: string; title: string }[];
  initialConversation: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState(initialConversation);
  const [focusTarget, setFocusTarget] = useState<{
    conversation: string;
    message?: string;
  }>();
  const [overview, setOverview] = useState<Overview>({
    conversations: [],
    review: [],
    reports: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [newMessage, setNewMessage] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    const id = params.get("c");
    setSelected(isUuid(id) ? id : null);
  }, [params]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const data = await readChat<Overview>(
          "/api/chat/overview",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setOverview(data);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load conversations.",
          );
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    refreshRef.current = () => void load();
    void load();
    const timer = window.setInterval(load, 10000);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      refreshRef.current = () => {};
    };
  }, [retry]);

  const open = (id: string, message?: string) => {
    setSelected(id);
    setFocusTarget({ conversation: id, message });
    router.replace("/chat?c=" + encodeURIComponent(id), { scroll: false });
  };
  const started = (id: string) => {
    refresh();
    open(id);
  };
  const back = () => {
    setSelected(null);
    setFocusTarget(undefined);
    router.replace("/chat", { scroll: false });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Team chat
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Message colleagues and keep team conversations together.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateGroups && (
            <Button variant="outline" onClick={() => setNewGroup(true)}>
              <Users size={15} />
              New group
            </Button>
          )}
          <Button onClick={() => setNewMessage(true)}>
            <Plus size={15} />
            New message
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm"
        >
          <p>{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={13} />
            Retry
          </Button>
        </div>
      )}
      <div className="flex h-[calc(100dvh-230px)] min-h-[440px] max-h-[900px] overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {loading ? (
          <div
            className={`${selected ? "hidden lg:flex" : "flex"} w-full shrink-0 items-center justify-center gap-2 text-sm text-muted-foreground lg:w-[320px] lg:border-r lg:border-border`}
            role="status"
          >
            <Loader2 size={17} className="animate-spin" />
            Loading conversations…
          </div>
        ) : (
          <ConversationList
            me={me}
            meName={meName}
            {...overview}
            selected={selected}
            onOpen={open}
            className={selected ? "hidden lg:flex" : "flex"}
          />
        )}
        {selected ? (
          <ConversationThread
            key={selected}
            id={selected}
            me={me}
            isAdmin={isAdmin}
            directory={directory}
            focusMessage={
              focusTarget?.conversation === selected
                ? focusTarget.message
                : undefined
            }
            draft={drafts[selected] || ""}
            onDraftChange={(value) =>
              setDrafts((current) => ({ ...current, [selected]: value }))
            }
            onBack={back}
            onChanged={refresh}
          />
        ) : (
          <div className="hidden min-w-0 flex-1 flex-col items-center justify-center px-8 text-center lg:flex">
            <span className="icon-tile mb-4 h-14 w-14">
              <MessageSquare size={26} />
            </span>
            <h2 className="font-display text-lg font-semibold">
              Choose a conversation
            </h2>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              Open a conversation on the left, or start a new message with a
              colleague.
            </p>
            <Button className="mt-5" onClick={() => setNewMessage(true)}>
              <Plus size={15} />
              New message
            </Button>
          </div>
        )}
      </div>
      <NewMessageDialog
        open={newMessage}
        onOpenChange={setNewMessage}
        directory={directDirectory}
        onStarted={started}
      />
      {canCreateGroups && (
        <NewGroupDialog
          open={newGroup}
          onOpenChange={setNewGroup}
          directory={directory}
          departments={Array.from(
            new Set(
              directory
                .map((person) => person.department)
                .filter((value): value is string => Boolean(value)),
            ),
          ).sort()}
          projects={projects}
          isAdmin={isAdmin}
          onCreated={started}
        />
      )}
    </div>
  );
}
