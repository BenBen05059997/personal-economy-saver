import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/supabase-auth";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/login"],
      disallow: ["/api/", "/family/", "/join/", "/signing-in", "/account", "/activity", "/canvas", "/cards", "/clients", "/invoices", "/memory", "/onboarding", "/options", "/plan", "/settings", "/start", "/to-check", "/upload"],
    },
    sitemap: new URL("/sitemap.xml", appUrl()).toString(),
  };
}
