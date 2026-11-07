import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Every page depends on the signed-in user's session cookie, so pages render per request.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
