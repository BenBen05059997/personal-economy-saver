import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load OpenNext's runtime natively in Next: its dev-only dynamic imports must
  // stay outside Turbopack's module graph. OpenNext bundles it for the Worker.
  serverExternalPackages: ["@opennextjs/cloudflare", "@paypal/agent-toolkit", "@supabase/supabase-js", "@supabase/ssr", "drizzle-orm", "postgres", "zod"],
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
