import type { Prisma, CertificateType, ApplicationStatus } from "@prisma/client";
import { prisma } from "./client";

/**
 * "UK-BIRTH-000123" style — human-friendly enough to read back over
 * WhatsApp and type into Track Status.
 *
 * ponytail: count-based sequence per type — good enough for a demo's
 * traffic, but two concurrent creates of the same type could race onto the
 * same number. Upgrade to a DB sequence (or SELECT ... FOR UPDATE on a
 * counter row) if concurrent submissions become real.
 */
export async function generateReferenceNumber(type: CertificateType): Promise<string> {
  const count = await prisma.certificateApplication.count({ where: { type } });
  const sequence = String(count + 1).padStart(6, "0");
  return `UK-${type}-${sequence}`;
}

export interface CreateApplicationInput {
  type: CertificateType;
  applicantName: string;
  mobileNumber?: string | null;
  language: string;
  /** Flexible, demo-friendly form fields — callers shouldn't need to know Prisma's JSON typing to create an application. */
  formData: unknown;
  status?: ApplicationStatus;
}

export async function createApplication(input: CreateApplicationInput) {
  const referenceNumber = await generateReferenceNumber(input.type);
  return prisma.certificateApplication.create({
    data: {
      referenceNumber,
      type: input.type,
      applicantName: input.applicantName,
      mobileNumber: input.mobileNumber ?? null,
      language: input.language,
      formData: input.formData as Prisma.InputJsonValue,
      status: input.status ?? "SUBMITTED",
    },
  });
}

export async function getApplicationByReference(referenceNumber: string) {
  return prisma.certificateApplication.findUnique({ where: { referenceNumber } });
}

export async function getApplicationById(id: string) {
  return prisma.certificateApplication.findUnique({ where: { id } });
}

export interface ListApplicationsFilter {
  status?: ApplicationStatus;
  type?: CertificateType;
}

/** Admin dashboard listing — newest first, optionally narrowed by status/type. */
export async function listApplications(filter?: ListApplicationsFilter) {
  return prisma.certificateApplication.findMany({
    where: { status: filter?.status, type: filter?.type },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLatestApplicationForNumber(mobileNumber: string) {
  return prisma.certificateApplication.findFirst({
    where: { mobileNumber },
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdateApplicationStatusOptions {
  rejectionReason?: string;
  certificatePdfPath?: string;
  reviewedByName?: string;
}

export async function updateApplicationStatus(
  referenceNumber: string,
  status: ApplicationStatus,
  options?: UpdateApplicationStatusOptions,
) {
  return prisma.certificateApplication.update({
    where: { referenceNumber },
    data: {
      status,
      reviewedAt: new Date(),
      rejectionReason: options?.rejectionReason,
      certificatePdfPath: options?.certificatePdfPath,
      reviewedByName: options?.reviewedByName,
    },
  });
}
