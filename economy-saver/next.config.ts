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
  // D56: no other site may frame the app (the AI key field among it).
  // The policy has no nonce: a nonce forces every page to render per request, which cacheComponents and partial
  // prerendering exist to avoid. Next's own inline bootstrap needs 'unsafe-inline'; React refresh needs 'unsafe-eval' in dev only.
  async headers() {
    const dev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" },
    ] }, { source: "/family/:path*", headers: [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }];
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
