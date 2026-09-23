import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone is for Docker; Vercel uses its own output
  output: process.env.VERCEL ? undefined : "standalone",
  // Keep Turbopack inside this checkout even when a developer has another lockfile above it.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
