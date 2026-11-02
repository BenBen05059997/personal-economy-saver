import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Read-only incremental cache served from the Worker's static assets: prerendered pages
// (the home page) are read from there. No R2/KV needed. Revisit if a page needs revalidation.
const config = defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});

// postgres uses the Worker’s nodejs_compat sockets. OpenNext bundles the Node entry point
// before Wrangler resolves Worker built-ins.
config.cloudflare = { ...config.cloudflare, useWorkerdCondition: false };
export default config;
