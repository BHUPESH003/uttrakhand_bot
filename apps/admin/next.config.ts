import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit's fontkit dependency ships a bundle that isn't compatible with
  // Turbopack's RSC bundling (it references an @swc/helpers export that
  // doesn't exist post-bundle) — opt it out and let Node's native require
  // load it instead.
  serverExternalPackages: ["pdfkit"],

  // Accessed through an ngrok tunnel for the WhatsApp demo — without this,
  // Next's dev server blocks cross-origin JS bundle/HMR requests, so the
  // page never hydrates when opened through the tunnel.
  allowedDevOrigins: ["*.ngrok-free.app"],
};

export default nextConfig;
