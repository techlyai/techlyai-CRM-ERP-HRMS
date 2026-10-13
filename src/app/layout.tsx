import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Techly · Workspace", template: "%s · Techly" },
  description:
    "One connected workspace for Techly’s people, customers, and operations.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Techly", statusBarStyle: "default" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
