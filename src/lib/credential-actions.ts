"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context, serviceDB } from "./database";
import { transaction } from "./postgres";
import { verifyPassword } from "./passwords";
import { sealPassword, openPassword, type SealedSecret } from "./vault";
import { credentialCategories } from "./credentials";

export type CredentialResult<T = undefined> = {
  ok: boolean;
  error?: string;
  data?: T;
};
// Errors are user-facing text from validation or the database. Passwords are
// never part of any message produced in this module.
async function guard<T>(fn: () => Promise<T>): Promise<CredentialResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    if (e instanceof z.ZodError)
      return { ok: false, error: e.errors.map((x) => x.message).join("; ") };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Request failed",
    };
  }
}
const uuid = z.string().uuid();
const password = z
  .string()
  .min(1, "Enter a password")
  .max(1024, "Password is too long");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || "");
const details = z
  .object({
    service_name: z.string().trim().min(1, "Enter the service name").max(120),
    category: z.enum(credentialCategories),
    login_url: optionalText(2048).refine(
      (v) => !v || /^https?:\/\/\S+$/i.test(v),
      "Login URL must start with http:// or https://",
    ),
    username: optionalText(320),
    account_id: optionalText(320),
    project_id: z
      .string()
      .optional()
      .transform((v) => v || "")
      .refine((v) => !v || uuid.safeParse(v).success, "Invalid project"),
    purpose: optionalText(2000),
    notes: optionalText(5000),
  })
  .strict();
const revalidate = (client: string) =>
  revalidatePath(`/modules/clients/${client}`);

export async function createCredential(input: {
  client: string;
  details: unknown;
  password: string;
}) {
  return guard(async () => {
    const { db } = await context();
    const client = uuid.parse(input.client);
    const d = details.parse(input.details);
    const secret = password.parse(input.password);
    const id = randomUUID();
    await db.rpc("create_credential", {
      p_id: id,
      p_client: client,
      p_data: d,
      p_secret: sealPassword(secret, id, 1),
    });
    revalidate(client);
    return id;
  });
}

export async function updateCredential(input: {
  id: string;
  client: string;
  rowVersion: number;
  details: unknown;
}) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("update_credential", {
      p_id: uuid.parse(input.id),
      p_row_version: z.number().int().positive().parse(input.rowVersion),
      p_data: details.parse(input.details),
    });
    revalidate(uuid.parse(input.client));
  });
}

export async function changeCredentialPassword(input: {
  id: string;
  client: string;
  rowVersion: number;
  currentVersion: number;
  password: string;
  reason?: string;
}) {
  return guard(async () => {
    const { db } = await context();
    const id = uuid.parse(input.id);
    const next = z.number().int().positive().parse(input.currentVersion) + 1;
    await db.rpc("change_credential_password", {
      p_id: id,
      p_row_version: z.number().int().positive().parse(input.rowVersion),
      p_new_version: next,
      p_secret: sealPassword(password.parse(input.password), id, next),
      p_reason: z.string().trim().max(500).parse(input.reason || ""),
    });
    revalidate(uuid.parse(input.client));
  });
}

/** Decrypts one password version for an authorized user. Every call is audited in the database. */
export async function readCredentialPassword(input: {
  id: string;
  version?: number | null;
  purpose: "reveal" | "copy";
}) {
  return guard(async () => {
    const { db } = await context();
    const id = uuid.parse(input.id);
    const sealed = await db.rpc<SealedSecret & { version: number }>(
      "credential_secret",
      {
        p_id: id,
        p_version:
          input.version == null
            ? null
            : z.number().int().positive().parse(input.version),
        p_purpose: z.enum(["reveal", "copy"]).parse(input.purpose),
      },
    );
    return openPassword(sealed, id, sealed.version);
  });
}

export type CredentialVersion = {
  version: number;
  created_at: string;
  created_by: string;
  replaced_at: string | null;
  replaced_by: string | null;
  reason: string;
  is_current: boolean;
};
export async function credentialHistory(id: string) {
  return guard(async () => {
    const { db } = await context();
    const [versions, unlockedUntil] = await Promise.all([
      db.rpc<CredentialVersion[]>("credential_versions", { p_id: uuid.parse(id) }),
      db.rpc<string | null>("vault_unlocked_until"),
    ]);
    return { versions, unlockedUntil };
  });
}

/** Re-confirms the signed-in user's password before previous passwords can be opened. */
export async function unlockCredentialHistory(input: { password: string }) {
  return guard(async () => {
    const { profile } = await context();
    const supplied = z.string().min(1, "Enter your password").max(200).parse(input.password);
    const hash = await transaction(
      async (c) =>
        (
          await c.query<{ password_hash: string }>(
            "select password_hash from private.accounts where id=$1",
            [profile.id],
          )
        ).rows[0]?.password_hash,
    );
    if (!hash || !(await verifyPassword(supplied, hash)))
      throw Error("That password is incorrect.");
    return serviceDB().rpc<string>("unlock_credential_vault", {
      p_user: profile.id,
      p_minutes: 10,
    });
  });
}

export async function archiveCredential(input: {
  id: string;
  client: string;
  archived: boolean;
}) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("archive_credential", {
      p_id: uuid.parse(input.id),
      p_archived: z.boolean().parse(input.archived),
    });
    revalidate(uuid.parse(input.client));
  });
}

export async function deleteCredential(input: {
  id: string;
  client: string;
  reason: string;
}) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("delete_credential", {
      p_id: uuid.parse(input.id),
      p_reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500).parse(input.reason),
    });
    revalidate(uuid.parse(input.client));
  });
}
