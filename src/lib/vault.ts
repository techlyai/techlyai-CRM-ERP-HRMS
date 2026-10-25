import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Server-only encryption for client credentials (AES-256-GCM).
 *
 * Keys live outside the database:
 *   CREDENTIALS_ENCRYPTION_KEY    current key, 32 bytes as base64 or 64 hex characters
 *   CREDENTIALS_PREVIOUS_KEYS     optional comma-separated older keys, kept for decryption after rotation
 *
 * Each ciphertext is bound to its credential and version through additional
 * authenticated data, so a ciphertext copied onto another credential or
 * version fails to decrypt.
 */
export type SealedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
  key_id: string;
};
type Key = { id: string; bytes: Buffer };

function parseKey(raw: string): Key {
  const value = raw.trim();
  const bytes = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (bytes.length !== 32)
    throw Error("Credential encryption key must be 32 bytes");
  return { id: createHash("sha256").update(bytes).digest("hex").slice(0, 16), bytes };
}
function keys(): { current: Key; all: Map<string, Key> } {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw)
    throw Error(
      "Credential storage is not configured. Set CREDENTIALS_ENCRYPTION_KEY on the server.",
    );
  const current = parseKey(raw);
  const all = new Map([[current.id, current]]);
  for (const old of (process.env.CREDENTIALS_PREVIOUS_KEYS || "").split(",")) {
    if (old.trim()) {
      const k = parseKey(old);
      all.set(k.id, k);
    }
  }
  return { current, all };
}
export function vaultConfigured() {
  try {
    keys();
    return true;
  } catch {
    return false;
  }
}
const aad = (credentialId: string, version: number) =>
  Buffer.from(`techly-credential:${credentialId}:${version}`, "utf8");

export function sealPassword(
  plaintext: string,
  credentialId: string,
  version: number,
): SealedSecret {
  const { current } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.bytes, iv);
  cipher.setAAD(aad(credentialId, version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    key_id: current.id,
  };
}
export function openPassword(
  sealed: SealedSecret,
  credentialId: string,
  version: number,
): string {
  const key = keys().all.get(sealed.key_id);
  if (!key)
    throw Error("The key for this password is no longer configured on the server.");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.bytes,
      Buffer.from(sealed.iv, "base64"),
    );
    decipher.setAAD(aad(credentialId, version));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Never echo ciphertext or partial output.
    throw Error("This password could not be decrypted. Contact your administrator.");
  }
}
