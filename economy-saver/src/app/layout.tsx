import type { Metadata } from "next";
import { APP_DESCRIPTION } from "@/lib/app-info";
import { appUrl } from "@/lib/supabase-auth";
import "./globals.css";

// The address comes from the APP_URL setting; a missing or invalid one stops with its own message.
export function generateMetadata(): Metadata {
  return {
    metadataBase: appUrl(),
    title: { default: "fipa", template: "%s · fipa" },
    description: APP_DESCRIPTION,
    openGraph: { type: "website", siteName: "fipa", title: "fipa", description: APP_DESCRIPTION, images: [{ url: "/og.png", width: 1200, height: 630, alt: "fipa" }] },
    twitter: { card: "summary_large_image", title: "fipa", description: APP_DESCRIPTION, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
