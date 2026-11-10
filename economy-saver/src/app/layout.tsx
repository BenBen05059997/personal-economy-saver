import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fipa",
  description: "See what you can spend, what’s due, and who can pay you through PayPal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
