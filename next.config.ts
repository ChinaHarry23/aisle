import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image runs `.next/standalone/server.js`; Vercel builds its own serverless output.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
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
