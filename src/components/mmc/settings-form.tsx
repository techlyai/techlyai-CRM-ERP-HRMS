"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveMmcSettings } from "@/lib/mmc-actions";
import { adminPushEvents, fillTemplate, mmcEvents, templateVariables, type MmcSettings } from "@/lib/mmc";
import { Button } from "../ui/button";

const sample = { client_name: "Ravi Kumar", amount: "500", due_date: "05 Nov 2026", website: "https://ravistore.in", days_overdue: "7", receipt_link: "https://orbit.example/api/mmc/receipt/…", pay_link: "https://orbit.example/pay/…" };

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
        <h2 className="section-title">Admin push notifications</h2>
        <p className="mt-1 text-xs text-muted-foreground">Delivered to the notification bell and, on devices enrolled under Settings → Notifications, as web push.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {adminPushEvents.map((e) => (
            <label key={e.key} className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={s.admin_push[e.key] ?? true} onChange={(x) => setS({ ...s, admin_push: { ...s.admin_push, [e.key]: x.target.checked } })} />
              {e.label}
            </label>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="section-title">Client messages (MSG91)</h2>
        <div className="notice mt-3 text-xs leading-5">
          Server configuration: auth key {env.authKey ? "✓" : "✗ missing"} · SMS sender ID {env.sender ? "✓" : "✗ missing"} · WhatsApp number {env.whatsapp ? "✓" : "✗ missing"}
          {env.templateIds.length > 0 && <> · SMS template IDs from environment for: {env.templateIds.join(", ")}</>}
          <br />
          SMS text is fixed by the DLT-approved template: put the Flow template ID here and use variables named{" "}
          {templateVariables.map((v) => `##${v}##`).join(", ")}. WhatsApp uses your approved template name; list its body variables in order.
          The text below is used for previews and the message log.
        </div>
        <div className="mt-4 space-y-5">
          {mmcEvents.map((ev) => {
            const t = s.templates[ev.key] || { enabled: false, text: "", sms_template_id: "", whatsapp_template: "", whatsapp_vars: [] };
            const set = (patch: Partial<typeof t>) => setS({ ...s, templates: { ...s.templates, [ev.key]: { ...t, ...patch } } });
            return (
              <div key={ev.key} className="rounded-lg border border-border p-4">
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={t.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {ev.label}
                </label>
                <div className="grid gap-3 sm:grid-cols-5">
                  <div className="field sm:col-span-5">
                    <label htmlFor={"tt-" + ev.key}>Message text</label>
                    <input id={"tt-" + ev.key} value={t.text} maxLength={1000} onChange={(e) => set({ text: e.target.value })} />
                    <p className="text-[11px] text-muted-foreground">Preview: {fillTemplate(t.text, sample)}</p>
                  </div>
                  <div className="field">
                    <label htmlFor={"ts-" + ev.key}>SMS Flow template ID</label>
                    <input id={"ts-" + ev.key} value={t.sms_template_id} onChange={(e) => set({ sms_template_id: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={"tw-" + ev.key}>WhatsApp template name</label>
                    <input id={"tw-" + ev.key} value={t.whatsapp_template} onChange={(e) => set({ whatsapp_template: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={"tb-" + ev.key}>WhatsApp URL button</label>
                    <select id={"tb-" + ev.key} value={t.whatsapp_button || ""} onChange={(e) => set({ whatsapp_button: (e.target.value || undefined) as MmcSettings["templates"]["reminder"]["whatsapp_button"] })}>
                      <option value="">None</option>
                      <option value="pay_token">Pay now → /pay/{"{{1}}"}</option>
                      <option value="receipt_token">Receipt → /api/mmc/receipt/{"{{1}}"}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={"tl-" + ev.key}>Template language</label>
                    <input id={"tl-" + ev.key} placeholder="en" value={t.whatsapp_language || ""} onChange={(e) => set({ whatsapp_language: e.target.value || undefined })} />
                  </div>
                  <div className="field">
                    <label htmlFor={"tv-" + ev.key}>WhatsApp variables, in order</label>
                    <input
                      id={"tv-" + ev.key}
                      value={t.whatsapp_vars.join(", ")}
                      onChange={(e) => set({ whatsapp_vars: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Variables: {templateVariables.map((v) => `{{${v}}}`).join(" ")}</p>
      </section>
      {error && <p className="error">{error}</p>}
      {msg && <p className="notice">{msg}</p>}
      <div className="flex justify-end">
        <Button disabled={busy} onClick={save}>{busy && <Loader2 size={15} className="animate-spin" />} Save settings</Button>
      </div>
    </div>
  );
}
