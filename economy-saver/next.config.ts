import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let OpenNext bundle these SDKs once for the Worker, across all server routes.
  serverExternalPackages: ["@paypal/agent-toolkit", "@supabase/supabase-js", "@supabase/ssr", "drizzle-orm", "postgres", "zod"],
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
