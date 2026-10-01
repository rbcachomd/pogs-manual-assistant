import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POGS Administrative Manual Assistant",
  description:
    "Ask questions about the POGS Administrative Manual 2026 and get cited answers grounded in the source document.",
  authors: [{ name: "Richard Ronald B. Cacho, MD, MHA, Public Relations Officer (2026)" }],
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
