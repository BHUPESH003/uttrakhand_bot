import Link from "next/link";
import { listApplications } from "db";
import type { ApplicationStatus, Service } from "types";

const STATUSES: ApplicationStatus[] = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"];
const TYPES: Service[] = ["BIRTH", "DEATH"];

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  SUBMITTED: "bg-neutral-100 text-neutral-700",
  UNDER_REVIEW: "bg-navy-100 text-navy-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-error/10 text-error",
};

function parseStatus(value: string | undefined): ApplicationStatus | undefined {
  return STATUSES.includes(value as ApplicationStatus) ? (value as ApplicationStatus) : undefined;
}

function parseType(value: string | undefined): Service | undefined {
  return TYPES.includes(value as Service) ? (value as Service) : undefined;
}

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const status = parseStatus(typeof params.status === "string" ? params.status : undefined);
  const type = parseType(typeof params.type === "string" ? params.type : undefined);

  const applications = await listApplications({ status, type });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold text-navy-700">Applications</h1>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-neutral-300 px-3 py-2"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          Type
          <select
            name="type"
            defaultValue={type ?? ""}
            className="rounded-md border border-neutral-300 px-3 py-2"
          >
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-navy-700 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600"
        >
          Filter
        </button>
        {(status || type) && (
          <Link href="/" className="text-sm text-neutral-500 underline">
            Clear
          </Link>
        )}
      </form>

      <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-300 bg-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-300 bg-neutral-50 text-neutral-700">
            <tr>
              <th className="px-4 py-2">Reference</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Applicant</th>
              <th className="px-4 py-2">Mobile</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/applications/${application.id}`} className="font-medium text-navy-700 underline">
                    {application.referenceNumber}
                  </Link>
                </td>
                <td className="px-4 py-2">{application.type}</td>
                <td className="px-4 py-2">{application.applicantName}</td>
                <td className="px-4 py-2">{application.mobileNumber ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[application.status]}`}>
                    {application.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-neutral-500">
                  {application.createdAt.toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
            {applications.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  No applications match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
