import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image runs `.next/standalone/server.js`; Vercel builds its own serverless output.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  images: {
    // The landing photograph is shown at about 1104px. Cap the optimizer so a
    // wide viewport does not download a 3840px file.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
  },
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
