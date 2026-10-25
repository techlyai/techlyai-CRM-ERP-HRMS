"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { login, changePassword } from "@/lib/actions";
import { Button } from "./ui/button";
export function LoginForm({
  configured,
  change = false,
}: {
  configured: boolean;
  change?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <form
      method="post"
      className="mt-8 space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setError("");
        setBusy(true);
        const data = new FormData(e.currentTarget);
        const password = String(data.get("password"));
        if (change && password !== data.get("confirm")) {
          setError("Passwords do not match");
          setBusy(false);
          return;
        }
        try {
          const result = change
            ? await changePassword(password)
            : await login({ phone: String(data.get("phone")), password });
          if (!result.ok) setError(result.error || "Sign-in failed");
          else {
            router.push("/");
            router.refresh();
          }
        } catch {
          setError("We couldn’t connect. Check your connection and try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {!change && (
        <div>
          <label htmlFor="phone">Phone number</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="username"
            placeholder="+91 98765 43210"
            required
            disabled={!configured}
            className="h-11"
          />
        </div>
      )}
      <div>
        <label htmlFor="password">{change ? "New password" : "Password"}</label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete={change ? "new-password" : "current-password"}
            placeholder={
              change ? "At least 12 characters" : "Enter your password"
            }
            required
            minLength={change ? 12 : 1}
            disabled={!configured}
            className="h-11 pr-12"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      {change && (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            Use at least 12 characters with uppercase and lowercase letters and
            a number.
          </p>
          <div>
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              className="h-11"
            />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || !configured}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        {busy
          ? change
            ? "Saving password…"
            : "Signing in…"
          : change
            ? "Set password and continue"
            : "Sign in"}
        {!busy && <ArrowRight size={16} />}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {change
          ? "Your temporary password must be changed before continuing."
          : "Need access? Contact your Orbit administrator."}
      </p>
    </form>
  );
}
