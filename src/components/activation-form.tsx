"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { activateAccount } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function ActivationForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (password !== confirmation) {
      setError("The passwords do not match. Re-enter your confirmation.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await activateAccount(token, password);
      if (!result.ok)
        throw Error(
          result.error || "Could not activate your account. Try again.",
        );
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect. Check your connection and try again.",
      );
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className="space-y-4">
        <div>
          <label htmlFor="activation-password">New password</label>
          <div className="relative">
            <input
              id="activation-password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}"
              aria-describedby="activation-password-help"
              value={password}
              className="pr-11"
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              aria-label={visible ? "Hide passwords" : "Show passwords"}
              aria-pressed={visible}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
              onClick={() => setVisible((value) => !value)}
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <p
            id="activation-password-help"
            className="mt-2 text-xs leading-5 text-muted-foreground"
          >
            Use 12–128 characters with an uppercase letter, a lowercase letter
            and a number.
          </p>
        </div>
        <div>
          <label htmlFor="activation-confirmation">Confirm password</label>
          <input
            id="activation-confirmation"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            required
            maxLength={128}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={busy}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? "Opening your workspace…" : "Activate and sign in"}
      </Button>
    </form>
  );
}
