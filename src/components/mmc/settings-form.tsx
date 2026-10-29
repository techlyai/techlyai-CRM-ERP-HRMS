"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveMmcSettings } from "@/lib/mmc-actions";
import { mmcEvents, type MmcSettings } from "@/lib/mmc";
import { Button } from "../ui/button";

export function MmcSettingsForm({ initial, env }: { initial: MmcSettings; env: { authKey: boolean; sender: boolean; whatsapp: boolean; templateIds: string[] } }) {
  const router = useRouter();
  const [s, setS] = useState<MmcSettings>({ ...initial, upi: initial.upi || { vpa: "", payee_name: "" } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const num = (k: keyof MmcSettings, label: string, min: number, max: number, hint?: string) => (
    <div className="field">
      <label htmlFor={"ms-" + k}>{label}</label>
      <input id={"ms-" + k} type="number" min={min} max={max} value={s[k] as number} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
  async function save() {
    setBusy(true);
    setError("");
    setMsg("");
    const r = await saveMmcSettings(s);
    setBusy(false);
    if (!r.ok) return setError(r.error || "Could not save");
    setMsg("Settings saved.");
    router.refresh();
  }
  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h2 className="section-title">Auto mode</h2>
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-2 font-normal">
            <input type="checkbox" className="mt-0.5" checked={s.auto_suspend_enabled} onChange={(e) => setS({ ...s, auto_suspend_enabled: e.target.checked })} />
            <span>Auto-suspend sites unpaid beyond their grace period<span className="block text-[11px] text-muted-foreground">Only for clients with auto-suspend ticked on their profile.</span></span>
          </label>
          <label className="flex items-start gap-2 font-normal">
            <input type="checkbox" className="mt-0.5" checked={s.auto_reactivate_enabled} onChange={(e) => setS({ ...s, auto_reactivate_enabled: e.target.checked })} />
            <span>Auto-reactivate when payment clears the overdue amount<span className="block text-[11px] text-muted-foreground">Only sites the system switched off; a site you turned off by hand stays off.</span></span>
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {num("default_grace_days", "Default grace period (days)", 0, 60, "Pre-filled for new clients.")}
          {num("reminder_days_before", "Reminder before due date (days)", 0, 30)}
          {num("overdue_repeat_days", "Repeat overdue reminder every (days)", 1, 30)}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="section-title">UPI payments</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every client gets a payment link (/pay/…) showing what they owe, a UPI button and a QR code. It is sent with reminders through the WhatsApp &quot;Pay now&quot; button.
          A business/merchant UPI ID is recommended: some UPI apps limit or block pre-filled payments to personal UPI IDs.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="ms-vpa">UPI ID</label>
            <input id="ms-vpa" placeholder="name@okaxis" value={s.upi.vpa} onChange={(e) => setS({ ...s, upi: { ...s.upi, vpa: e.target.value } })} />
          </div>
          <div className="field">
            <label htmlFor="ms-payee">Payee name shown in UPI apps</label>
            <input id="ms-payee" maxLength={80} value={s.upi.payee_name} onChange={(e) => setS({ ...s, upi: { ...s.upi, payee_name: e.target.value } })} />
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="section-title">Site Suspended page</h2>
        <p className="mt-1 text-xs text-muted-foreground">Shown by the client snippets with HTTP 503. Regenerate or re-copy snippets after changing it.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="ms-title">Title</label>
            <input id="ms-title" value={s.suspended_title} onChange={(e) => setS({ ...s, suspended_title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ms-cname">Your name / company</label>
            <input id="ms-cname" value={s.contact.name} onChange={(e) => setS({ ...s, contact: { ...s.contact, name: e.target.value } })} />
          </div>
          <div className="field sm:col-span-2">
            <label htmlFor="ms-msg">Message (also returned by the API)</label>
            <input id="ms-msg" value={s.suspended_message} onChange={(e) => setS({ ...s, suspended_message: e.target.value })} />
          </div>
          {(["phone", "whatsapp", "email"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={"ms-c-" + k}>Contact {k}</label>
              <input id={"ms-c-" + k} value={s.contact[k]} onChange={(e) => setS({ ...s, contact: { ...s.contact, [k]: e.target.value } })} />
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="section-title">WhatsApp messages</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sent with your approved MSG91 templates. Switch a message on only after its template is approved.
          {!(env.authKey && env.whatsapp) && <span className="text-danger"> MSG91 auth key or WhatsApp number is missing on the server.</span>}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {mmcEvents.map((ev) => {
            const t = s.templates[ev.key];
            if (!t) return null;
            return (
              <label key={ev.key} className="flex items-center gap-2 font-normal">
                <input type="checkbox" checked={t.enabled} onChange={(e) => setS({ ...s, templates: { ...s.templates, [ev.key]: { ...t, enabled: e.target.checked } } })} />
                {ev.label} <span className="font-mono text-[11px] text-muted-foreground">{t.whatsapp_template}</span>
              </label>
            );
          })}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {msg && <p className="notice">{msg}</p>}
      <div className="flex justify-end">
        <Button disabled={busy} onClick={save}>{busy && <Loader2 size={15} className="animate-spin" />} Save settings</Button>
      </div>
    </div>
  );
}
