"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getApplicationById, updateApplicationStatus } from "db";
import { requireAuth } from "@/lib/auth";
import { generateCertificatePdf } from "@/lib/pdf";
import { notifyApproved } from "@/lib/notifyBot";

export async function approveApplication(applicationId: string, formData: FormData) {
  await requireAuth();
  const application = await getApplicationById(applicationId);
  if (!application) redirect("/");

  const reviewerName = String(formData.get("reviewerName") ?? "").trim();
  if (!reviewerName) redirect(`/applications/${applicationId}?error=reviewer_required`);

  const certificatePdfPath = await generateCertificatePdf(application);
  await updateApplicationStatus(application.referenceNumber, "APPROVED", {
    certificatePdfPath,
    reviewedByName: reviewerName,
  });

  const notified = application.mobileNumber
    ? (await notifyApproved(application.id)).status
    : "no_mobile_number";

  revalidatePath(`/applications/${applicationId}`);
  redirect(`/applications/${applicationId}?notified=${notified}`);
}

export async function rejectApplication(applicationId: string, formData: FormData) {
  await requireAuth();
  const application = await getApplicationById(applicationId);
  if (!application) redirect("/");

  const reviewerName = String(formData.get("reviewerName") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reviewerName) redirect(`/applications/${applicationId}?error=reviewer_required`);
  if (!reason) redirect(`/applications/${applicationId}?error=reason_required`);

  await updateApplicationStatus(application.referenceNumber, "REJECTED", {
    rejectionReason: reason,
    reviewedByName: reviewerName,
  });

  revalidatePath(`/applications/${applicationId}`);
  redirect(`/applications/${applicationId}`);
}
