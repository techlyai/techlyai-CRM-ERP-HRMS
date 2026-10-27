import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { serviceDB } from "@/lib/database";
import { rupees, upiLink } from "@/lib/mmc";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { PaymentClaimForm } from "@/components/mmc/pay-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pay maintenance charge",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

type PayInfo = {
  client: { name: string; business_name: string; website_url: string; mmc_amount: number; site_active: boolean };
  owed: number;
  credit: number;
  dues: { month: string; due_date: string; balance: number; status: string }[];
  pending_claims: number;
  upi: { vpa?: string; payee_name?: string };
  contact: { name?: string; phone?: string; whatsapp?: string; email?: string };
};

/** Public UPI payment page sent to clients in WhatsApp messages. */
export default async function PayPage({ params }: { params: { token: string } }) {
  if (!/^[0-9a-f]{64}$/.test(params.token)) notFound();
  const info = await serviceDB().rpc<PayInfo | null>("mmc_pay_info", { p_token: params.token });
  if (!info) notFound();
  const amount = Number(info.owed) > 0 ? Number(info.owed) : Number(info.client.mmc_amount);
  const vpa = info.upi.vpa || "";
  const payee = info.upi.payee_name || info.contact.name || "";
  const months = info.dues.map((d) => d.month).join(", ");
  const link = vpa ? upiLink(vpa, payee, amount, `MMC ${info.client.name}${months ? " " + months : ""}`) : "";
  const qr = link ? await QRCode.toString(link, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" }) : "";
  return (
    <main className="relative min-h-dvh bg-background px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4 text-muted-foreground" />
      <div className="mx-auto max-w-md space-y-5">
        <div className="flex justify-center"><Logo size={26} /></div>
        <section className="panel p-6">
          <p className="text-xs text-muted-foreground">Monthly maintenance charge</p>
          <h1 className="mt-1 text-xl font-semibold">{info.client.business_name || info.client.name}</h1>
          {info.client.website_url && <p className="text-xs text-muted-foreground">{info.client.website_url}</p>}
          <div className="mt-5 rounded-xl bg-primary/5 p-4 text-center">
            <div className="text-xs text-muted-foreground">{Number(info.owed) > 0 ? "Amount due" : "Monthly charge (nothing due right now)"}</div>
            <div className="mt-1 text-3xl font-bold text-primary">{rupees(amount)}</div>
            {months && <div className="mt-1 text-xs text-muted-foreground">For {months}</div>}
            {!info.client.site_active && <div className="mt-2 text-xs font-medium text-danger">Your website is currently suspended. It is restored after payment is confirmed.</div>}
          </div>
          {info.pending_claims > 0 && (
            <p className="notice mt-4 text-xs">A payment you reported is waiting for confirmation. No need to pay again.</p>
          )}
          {link ? (
            <div className="mt-5 space-y-4">
              <a href={link} className="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
                Pay {rupees(amount)} with UPI app
              </a>
              <p className="text-center text-[11px] text-muted-foreground">Opens Google Pay, PhonePe, Paytm or your bank app on this phone.</p>
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
                <p className="text-[11px] text-muted-foreground">Or scan with any UPI app · UPI ID <span className="font-mono">{vpa}</span></p>
              </div>
            </div>
          ) : (
            <p className="error mt-5">Online payment is not set up yet. Please contact us.</p>
          )}
        </section>
        <section className="panel p-6">
          <h2 className="section-title">Already paid?</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">Enter the transaction ID from your UPI app so we can confirm it quickly.</p>
          <PaymentClaimForm token={params.token} amount={amount} />
        </section>
        {(info.contact.phone || info.contact.whatsapp || info.contact.email) && (
          <p className="text-center text-xs text-muted-foreground">
            Questions? {info.contact.name && <>{info.contact.name} · </>}
            {info.contact.whatsapp || info.contact.phone} {info.contact.email && <>· {info.contact.email}</>}
          </p>
        )}
      </div>
    </main>
  );
}
