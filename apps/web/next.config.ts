import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Without this, Next's dev server blocks cross-origin requests for its JS
  // bundle/HMR socket when opened through a tunnel — the page renders but
  // never hydrates, so the apply form silently falls back to a native GET
  // submit (wiping the token/service query params instead of POSTing).
  allowedDevOrigins: ["*.ngrok-free.app"],
};

export default nextConfig;
