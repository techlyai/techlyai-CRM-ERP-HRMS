"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context } from "./database";

export type PermissionResult<T = undefined> = { ok: boolean; error?: string; data?: T };
async function guard<T>(fn: () => Promise<T>): Promise<PermissionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    if (e instanceof z.ZodError)
      return { ok: false, error: e.errors.map((x) => x.message).join("; ") };
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
const uuid = z.string().uuid();
const item = z
  .object({
    module: z.string().regex(/^[a-z_]{1,40}$/),
    action: z.string().regex(/^[a-z_]{1,40}$/),
    scope: z.enum(["none", "self", "team", "department", "all"]),
  })
  .strict();
const items = z.array(item).max(500);
const reason = z.string().trim().max(1000).optional().transform((v) => v || "");
const done = () => {
  revalidatePath("/settings/roles");
  revalidatePath("/users");
  revalidatePath("/", "layout");
};

/** Saves the listed permissions for one user; the database checks delegation limits. */
export async function saveUserPermissions(input: { user: string; items: unknown; reason?: string }) {
  return guard(async () => {
    const { db } = await context();
    const n = await db.rpc<number>("save_user_permissions", {
      p_user: uuid.parse(input.user),
      p_items: items.parse(input.items),
      p_reason: reason.parse(input.reason),
    });
    done();
    return n;
  });
}
export async function resetUserPermissions(input: { user: string; reason?: string }) {
  return guard(async () => {
    const { db } = await context();
    const n = await db.rpc<number>("reset_user_permissions", {
      p_user: uuid.parse(input.user),
      p_reason: reason.parse(input.reason),
    });
    done();
    return n;
  });
}
export async function copyUserPermissions(input: { from: string; to: string; reason?: string }) {
  return guard(async () => {
    const { db } = await context();
    const n = await db.rpc<number>("copy_user_permissions", {
      p_from: uuid.parse(input.from),
      p_to: uuid.parse(input.to),
      p_reason: reason.parse(input.reason),
    });
    done();
    return n;
  });
}
/** Loads another user's effective access (for "copy from" previews). */
export async function loadEffectivePermissions(user: string) {
  return guard(async () => {
    const { db } = await context();
    return db.rpc<{ module: string; action: string; scope: string }[]>("effective_permissions", {
      p_user: uuid.parse(user),
    });
  });
}
export async function saveRolePermissions(input: {
  role: string;
  items: unknown;
  apply: string;
  reason?: string;
}) {
  return guard(async () => {
    const { db } = await context();
    const n = await db.rpc<number>("save_role_permissions", {
      p_role: z.enum(["employee", "manager"]).parse(input.role),
      p_items: items.parse(input.items),
      p_apply: z.enum(["all", "new_only"]).parse(input.apply),
      p_reason: reason.parse(input.reason),
    });
    done();
    return n;
  });
}
export async function savePermissionTemplate(input: {
  id?: string;
  name: string;
  description?: string;
  items: unknown;
}) {
  return guard(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("save_permission_template", {
      p_id: input.id ? uuid.parse(input.id) : null,
      p_name: z.string().trim().min(1, "Name the template").max(80).parse(input.name),
      p_description: z.string().trim().max(500).parse(input.description || ""),
      p_items: items.parse(input.items),
    });
    done();
    return id;
  });
}
export async function deletePermissionTemplate(id: string) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("delete_permission_template", { p_id: uuid.parse(id) });
    done();
  });
}
export async function applyPermissionTemplate(input: { template: string; users: string[]; reason?: string }) {
  return guard(async () => {
    const { db } = await context();
    const n = await db.rpc<number>("apply_permission_template", {
      p_template: uuid.parse(input.template),
      p_users: z.array(uuid).min(1, "Select at least one person").max(200).parse(input.users),
      p_reason: reason.parse(input.reason),
    });
    done();
    return n;
  });
}
