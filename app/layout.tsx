import type { Metadata, Viewport } from "next";
import { Libre_Caslon_Display, Libre_Caslon_Text } from "next/font/google";
import "./globals.css";

const displaySerif = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display-serif",
  display: "swap",
});

const bodySerif = Libre_Caslon_Text({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-body-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "POGS Administrative Manual Assistant",
  description:
    "Ask questions about the POGS Administrative Manual 2026 and get cited answers grounded in the source document.",
  authors: [{ name: "Richard Ronald B. Cacho, MD, MHA, Public Relations Officer (2026)" }],
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displaySerif.variable} ${bodySerif.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
