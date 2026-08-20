import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplicationById, listMessagesForNumber } from "db";
import { summarizeMessage } from "@/lib/messageSummary";
import { approveApplication, rejectApplication } from "./actions";

export const metadata: Metadata = { title: "Application — Admin" };

const NOTIFY_LABEL: Record<string, string> = {
  sent: "Approved. The certificate was sent to the applicant on WhatsApp.",
  outside_window: "Approved, but the applicant is outside the 24h WhatsApp window — a template message is needed to notify them.",
  no_mobile_number: "Approved. No mobile number on file, so no WhatsApp notification was sent.",
  error: "Approved, but notifying the applicant on WhatsApp failed. See the bot service logs.",
};

interface ApplicationPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notified?: string; error?: string }>;
}

export default async function ApplicationPage({ params, searchParams }: ApplicationPageProps) {
  const { id } = await params;
  const { notified, error } = await searchParams;

  const application = await getApplicationById(id);
  if (!application) notFound();

  const messages = application.mobileNumber
    ? await listMessagesForNumber(application.mobileNumber)
    : [];

  const canReview = application.status === "SUBMITTED" || application.status === "UNDER_REVIEW";
  const formData = (application.formData as Record<string, unknown> | null) ?? {};

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="text-sm text-navy-700 underline">
        ← Back to Applications
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-navy-700">{application.referenceNumber}</h1>
      <p className="mt-1 text-neutral-600">
        {application.type} · Status: <span className="font-medium">{application.status}</span>
      </p>

      {notified && (
        <p className="mt-4 rounded-md border border-navy-200 bg-navy-50 px-4 py-3 text-sm text-navy-700">
          {NOTIFY_LABEL[notified] ?? notified}
        </p>
      )}
      {error === "reason_required" && (
        <p className="mt-4 rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          A reason is required to reject an application.
        </p>
      )}
      {error === "reviewer_required" && (
        <p className="mt-4 rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          Your name is required to approve or reject an application.
        </p>
      )}

      <section className="mt-6 rounded-lg border border-neutral-300 bg-surface p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900">Applicant</h2>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-500">Name</dt>
          <dd>{application.applicantName}</dd>
          <dt className="text-neutral-500">Mobile</dt>
          <dd>{application.mobileNumber ?? "—"}</dd>
          <dt className="text-neutral-500">Language</dt>
          <dd>{application.language}</dd>
          <dt className="text-neutral-500">Submitted</dt>
          <dd>{application.createdAt.toLocaleString("en-IN")}</dd>
          {application.reviewedByName && (
            <>
              <dt className="text-neutral-500">Reviewed by</dt>
              <dd>{application.reviewedByName}</dd>
            </>
          )}
          {application.rejectionReason && (
            <>
              <dt className="text-neutral-500">Rejection reason</dt>
              <dd>{application.rejectionReason}</dd>
            </>
          )}
          {application.certificatePdfPath && (
            <>
              <dt className="text-neutral-500">Certificate</dt>
              <dd>
                <a href={application.certificatePdfPath} className="text-navy-700 underline" target="_blank">
                  View PDF
                </a>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-neutral-300 bg-surface p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900">Form Data</h2>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {Object.entries(formData).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-neutral-500">{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {canReview && (
        <section className="mt-6 flex flex-wrap gap-4">
          <form
            action={approveApplication.bind(null, application.id)}
            className="flex flex-wrap items-start gap-2"
          >
            <input
              type="text"
              name="reviewerName"
              placeholder="Your name"
              required
              className="min-w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700"
            >
              Approve
            </button>
          </form>

          <form
            action={rejectApplication.bind(null, application.id)}
            className="flex flex-1 flex-wrap items-start gap-2"
          >
            <input
              type="text"
              name="reviewerName"
              placeholder="Your name"
              required
              className="min-w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              name="reason"
              placeholder="Reason for rejection"
              required
              className="min-w-[16rem] flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md border border-error px-4 py-2 font-semibold text-error hover:bg-error/10"
            >
              Reject
            </button>
          </form>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-neutral-300 bg-surface p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900">Conversation History</h2>
        {!application.mobileNumber && (
          <p className="mt-2 text-sm text-neutral-500">No mobile number on file.</p>
        )}
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                message.direction === "INCOMING"
                  ? "self-start bg-neutral-100"
                  : "self-end bg-navy-50"
              }`}
            >
              <p>{summarizeMessage(message.type, message.payload)}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {message.direction} · {message.createdAt.toLocaleString("en-IN")}
              </p>
            </li>
          ))}
          {application.mobileNumber && messages.length === 0 && (
            <li className="text-neutral-500">No messages logged yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
