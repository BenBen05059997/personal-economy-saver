import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/supabase-auth";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/login", "/privacy", "/terms"].map((path) => ({ url: new URL(path, appUrl()).toString() }));
}
