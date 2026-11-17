/**
 * GET/PUT the commerce-demo Flow flags. proxy.ts already redirects
 * unauthenticated requests to /login; this re-checks the cookie and answers
 * 401 JSON, since a fetch() caller can't use a redirect to a login page.
 */
import { cookies } from "next/headers";
import { AUTH_COOKIE, isAuthed } from "@/lib/auth";
import { getDemoConfig, putDemoConfig } from "@/lib/demoConfig";

async function authed(): Promise<boolean> {
  return isAuthed((await cookies()).get(AUTH_COOKIE)?.value);
}

function toResponse(result: Awaited<ReturnType<typeof getDemoConfig>>): Response {
  return result.ok ? Response.json({ config: result.config }) : Response.json({ error: result.error }, { status: result.status });
}

export async function GET(): Promise<Response> {
  if (!(await authed())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return toResponse(await getDemoConfig());
}

export async function PUT(request: Request): Promise<Response> {
  if (!(await authed())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  return toResponse(await putDemoConfig(body));
}
