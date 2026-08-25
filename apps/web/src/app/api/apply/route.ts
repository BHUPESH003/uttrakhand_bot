import { NextResponse } from "next/server";
import { createApplication, attachApplicationToToken } from "db";
import { birthFormSchema, deathFormSchema, domicileFormSchema } from "@/schema";
import { resolveValidToken } from "@/token";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.token !== "string" || typeof body.formData !== "object") {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const tokenRow = await resolveValidToken(body.token);
  if (!tokenRow) {
    return NextResponse.json({ error: "Token missing or expired" }, { status: 400 });
  }

  const schema =
    tokenRow.service === "BIRTH"
      ? birthFormSchema
      : tokenRow.service === "DEATH"
        ? deathFormSchema
        : domicileFormSchema;
  const parsed = schema.safeParse(body.formData);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const application = await createApplication({
    type: tokenRow.service,
    applicantName: parsed.data.applicantName,
    mobileNumber: tokenRow.mobileNumber,
    language: tokenRow.language,
    formData: parsed.data,
  });

  await attachApplicationToToken(tokenRow.token, application.id);

  // Best-effort: the applicant still sees their reference number on this
  // page even if the WhatsApp confirmation fails to send (e.g. outside the
  // 24h window) — this should never block the response. Still logged
  // (rather than silently swallowed) so a wrong BOT_INTERNAL_URL or a
  // stale INTERNAL_API_SECRET shows up in Vercel's function logs instead
  // of just looking like "the message never arrived" with no trace of why.
  try {
    const res = await fetch(`${process.env.BOT_INTERNAL_URL}/internal/notify-submitted`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({ applicationId: application.id }),
    });
    if (!res.ok) {
      console.error(
        `notify-submitted failed: ${res.status} ${res.statusText} — ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.error("notify-submitted request failed", err);
  }

  return NextResponse.json({ referenceNumber: application.referenceNumber });
}
