import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production image runs the traced server at `.next/standalone/server.js`.
  output: "standalone",
  allowedDevOrigins: [
    "127.0.0.1",
    "172.20.10.3",
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.app",
    "*.ngrok.io",
  ],
};

export default nextConfig;
