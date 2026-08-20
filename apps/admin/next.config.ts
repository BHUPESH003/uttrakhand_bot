import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // In production this app is reverse-proxied at /admin (same domain as
  // apps/bot, split by path — see deploy/nginx/app.conf.template) rather
  // than served from its own subdomain. `next build` always forces
  // NODE_ENV=production regardless of the shell's env, and `next dev`
  // always forces "development", so this stays off for local/ngrok dev
  // (DEMO.md's flow, served at each app's own root) and on for every real
  // deploy build without needing a separate flag.
  basePath: process.env.NODE_ENV === "production" ? "/admin" : "",

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
