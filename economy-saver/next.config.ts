import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load OpenNext's runtime natively in Next: its dev-only dynamic imports must
  // stay outside Turbopack's module graph. OpenNext bundles it for the Worker.
  serverExternalPackages: ["@opennextjs/cloudflare", "@paypal/agent-toolkit", "@supabase/supabase-js", "@supabase/ssr", "drizzle-orm", "postgres", "zod"],
  // Dev only: APP_URL and the HTTP suites use 127.0.0.1, which next dev otherwise treats as cross-origin and
  // blocks from its dev resources, so the page never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
  // Dev only: the route indicator's default bottom-left corner covers the sidebar's person and the phone's microphone;
  // top-left and top-right hold the menu, bell and Add. Bottom-right is the one free corner.
  devIndicators: { position: "bottom-right" },
  // D52: the family view is opened from a shared link: never cached, never indexed, never sent on as a referrer.
  async headers() {
    return [{ source: "/family/:path*", headers: [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }];
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
