import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/__/firebase/init.json",
        destination: "/api/firebase-init",
      },
      {
        source: "/__/auth/:path*",
        destination: "https://distortion-tracker.firebaseapp.com/__/auth/:path*",
      },
    ];
  },
};

export default nextConfig;
