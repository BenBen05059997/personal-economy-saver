import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the toolkit (and its axios / MCP SDK dependencies) from node_modules instead of bundling it.
  serverExternalPackages: ["@paypal/agent-toolkit"],
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
