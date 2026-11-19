import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@netmon/shared-types", "@netmon/shared-validation", "@netmon/network-core", "@netmon/router-adapters"],
  serverExternalPackages: ["@prisma/client", "bcryptjs", "ioredis", "bullmq", "net-snmp"],
  // Phase 4: the browser always talks to Socket.IO on the dashboard's own origin, so the
  // session cookie is first-party. In Docker, nginx proxies /socket.io; in local dev this rewrite does.
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      // Next needs inline scripts/styles for hydration; everything else is same-origin only.
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") + "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
    ];
    return [{ source: "/:path*", headers: security }, { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] }];
  },
  async rewrites() {
    const target = process.env.REALTIME_INTERNAL_URL ?? "http://localhost:4001";
    return [{ source: "/socket.io", destination: `${target}/socket.io` }, { source: "/socket.io/:path*", destination: `${target}/socket.io/:path*` }];
  },
};
export default config;
