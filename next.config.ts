import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Enables forbidden(), so STAFF hitting an ADMIN route gets a real 403
  // rather than a redirect or a 500 (spec §9, Gate 1).
  experimental: { authInterrupts: true },
  // Security headers are set by nginx (spec §9), in one place only. See
  // /etc/nginx/sites-available/ops.rfsupplements.com.
};

export default nextConfig;
