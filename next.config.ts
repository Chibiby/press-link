import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The export routes read these with fs.readFileSync (lib/export/letterhead.ts)
  // at a path built from a variable, which the build's static file tracer can
  // miss — list them explicitly so every export route bundles them.
  outputFileTracingIncludes: {
    "/*": [
      "public/logo-deped-matatag.png",
      "public/logo-bagong-pilipinas.png",
      "public/logo-deped-sarangani.png",
      "public/aspajccjsi-mark.png",
    ],
  },
};

export default nextConfig;
