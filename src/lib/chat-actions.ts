"use server";
import { context } from "./database";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Result } from "./actions";
const uuid = z.string().uuid();
async function safely(fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return {
      ok: false,
      error:
        e instanceof z.ZodError
          ? e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : "Request failed",
    };
  }
}
export async function startDirect(userId: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("start_direct_conversation", {
      p_user: uuid.parse(userId),
    });
    revalidatePath("/");
    return { ok: true, id };
  });
}
export async function createGroup(input: {
  name: string;
  members: string[];
  department?: string | null;
  project?: string | null;
  official?: boolean;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("create_group", {
      p_name: z.string().trim().min(1).max(120).parse(input.name),
      p_members: z.array(uuid).max(500).parse(input.members || []),
      p_department: input.department
        ? z.string().trim().max(120).parse(input.department)
        : null,
      p_project: input.project ? uuid.parse(input.project) : null,
      p_official: z.boolean().parse(Boolean(input.official)),
    });
    revalidatePath("/");
    return { ok: true, id };
  });
}
export async function updateMembers(input: {
  conversation: string;
  add?: string[];
  remove?: string[];
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const add = z.array(uuid).max(500).parse(input.add || []);
    const remove = z.array(uuid).max(500).parse(input.remove || []);
    if (!add.length && !remove.length) throw Error("Choose people to add or remove");
    await db.rpc("update_group_members", {
      p_conversation: uuid.parse(input.conversation),
      p_add: add,
      p_remove: remove,
    });
    revalidatePath("/");
    return { ok: true };
  });
}
const attachmentSchema = z
  .object({
    path: z
      .string()
      .regex(
        /^[0-9a-f-]{36}\/chat\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/,
        "Invalid attachment",
      ),
    name: z.string().min(1).max(255),
    mime: z.string().min(1).max(255),
    size: z.number().int().positive(),
  })
  .strict();
export async function sendMessage(input: {
  conversation: string;
  body: string;
  replyTo?: string | null;
  attachment?: {
    path: string;
    name: string;
    mime: string;
    size: number;
  } | null;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const body = z.string().max(10000).parse(input.body ?? "");
    const attachment = input.attachment
      ? attachmentSchema.parse(input.attachment)
      : null;
    if (!body.trim() && !attachment) throw Error("Type a message or add a file");
    const id = await db.rpc<string>("send_message", {
      p_conversation: uuid.parse(input.conversation),
      p_body: body,
      p_reply_to: input.replyTo ? uuid.parse(input.replyTo) : null,
      p_attachment: attachment,
    });
    revalidatePath("/");
    return { ok: true, id };
  });
}
export async function editMessage(id: string, body: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("edit_message", {
      p_id: uuid.parse(id),
      p_body: z.string().trim().min(1).max(10000).parse(body),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function deleteMessage(id: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("delete_message", { p_id: uuid.parse(id) });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function pinMessage(id: string, pinned: boolean): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("pin_message", {
      p_id: uuid.parse(id),
      p_pinned: z.boolean().parse(pinned),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function setConversationPrefs(input: {
  conversation: string;
  muted?: boolean;
  pinned?: boolean;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("set_conversation_prefs", {
      p_conversation: uuid.parse(input.conversation),
      p_muted:
        input.muted === undefined ? null : z.boolean().parse(input.muted),
      p_pinned:
        input.pinned === undefined ? null : z.boolean().parse(input.pinned),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
/** Marks everything in the conversation read; also clears its chat notification. */
export async function markRead(conversation: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("mark_conversation_read", {
      p_conversation: uuid.parse(conversation),
    });
    return { ok: true };
  });
}
/** Presence ping; pass the conversation being typed in, or null. Called every ~10s. */
export async function heartbeat(typing: string | null): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("heartbeat", { p_typing: typing ? uuid.parse(typing) : null });
    return { ok: true };
  });
}
export async function reportMessage(id: string, reason: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("report_message", {
      p_id: uuid.parse(id),
      p_reason: z.string().trim().min(1).max(1000).parse(reason),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function resolveReport(
  id: string,
  status: "dismissed" | "actioned",
): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("resolve_report", {
      p_id: uuid.parse(id),
      p_status: z.enum(["dismissed", "actioned"]).parse(status),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
/**
 * Admin review: records an audit entry before a non-member Super Admin opens a
 * conversation. Members pass through without writing anything.
 */
export async function reviewConversation(conversation: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("audit_conversation_access", {
      p_conversation: uuid.parse(conversation),
    });
    return { ok: true };
  });
}
