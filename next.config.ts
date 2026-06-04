import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://distortion-tracker.firebaseapp.com/__/auth/:path*",
      },
    ];
  },
};

export default nextConfig;
