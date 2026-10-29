"use client";
import { useEffect, useState } from "react";

/**
 * Opens a specific UPI app with the same payment details as the generic upi:// link.
 * Android shows an app chooser for upi:// itself; iPhones need each app's own scheme.
 */
export function UpiAppButtons({ link }: { link: string }) {
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent)), []);
  const query = link.slice(link.indexOf("?"));
  const apps = [
    { name: "Google Pay", href: (ios ? "gpay://upi/pay" : "tez://upi/pay") + query },
    { name: "PhonePe", href: "phonepe://pay" + query },
    { name: "Paytm", href: "paytmmp://pay" + query },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {apps.map((a) => (
        <a key={a.name} href={a.href} className="flex h-10 items-center justify-center rounded-lg border border-border bg-card text-xs font-medium hover:border-primary/40 hover:bg-muted">
          {a.name}
        </a>
      ))}
    </div>
  );
}
