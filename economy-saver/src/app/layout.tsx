import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// next/font declares these custom properties on <html>, so globals.css and every component
// can use var(--display), var(--body) and var(--mono).
const display = Bricolage_Grotesque({
  variable: "--display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const body = Geist({
  variable: "--body",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Economy Saver",
  description:
    "Reads your bills, watches your PayPal income, tells you the cheapest money move when you need it, and acts through PayPal when you approve.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
