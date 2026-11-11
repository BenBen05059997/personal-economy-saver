import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/supabase-auth";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/login"],
      disallow: ["/api/", "/family/", "/join/", "/signing-in", "/account", "/canvas", "/add", "/bills", "/cards", "/clients", "/invoices", "/household", "/memory", "/onboarding", "/options", "/saving", "/settings", "/setup", "/spending", "/start", "/to-check", "/upload"],
    },
    sitemap: new URL("/sitemap.xml", appUrl()).toString(),
  };
}
