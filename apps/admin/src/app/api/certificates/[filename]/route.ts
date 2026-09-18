/**
 * Serves a generated certificate PDF straight from disk on every request,
 * instead of Next's default public/ static-file serving (see lib/pdf.ts's
 * CERT_DIR, where these are written). That static path has shown a real,
 * reproducible bug: a certificate requested (e.g. by WhatsApp fetching it
 * moments after approval) right before its write is visible to Next's
 * static resolver gets a 404 that then sticks for that exact path even
 * after the file exists — only an admin restart clears it. Route Handlers
 * are dynamic by default (no `dynamic = "force-static"` here), so this
 * reads the filesystem fresh every time and has no such cache to get stuck.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const CERT_DIR = path.join(process.cwd(), "public", "certificates");
// Certificate filenames are always "<referenceNumber>.pdf" (see pdf.ts's
// generateCertificatePdf) — reject anything else outright. Trust boundary:
// `filename` comes straight from the URL.
const SAFE_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
): Promise<Response> {
  const { filename } = await params;
  if (!SAFE_FILENAME.test(filename)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const pdf = await readFile(path.join(CERT_DIR, filename));
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
