/**
 * Seeds a handful of sample applications so Track Status has something to
 * find during local testing. Uses upsert on referenceNumber so re-running
 * (`pnpm seed`) is safe.
 *
 *   pnpm --filter db seed
 *
 * Reference numbers are numbered per-type (UK-BIRTH-000001, UK-BIRTH-000002,
 * UK-DEATH-000001, ...) to match generateReferenceNumber()'s per-type COUNT
 * in src/applications.ts — a global counter across both types here would
 * make the very next createApplication() call collide with a seeded number.
 */
import { prisma } from "../src/client";

const applications = [
  {
    referenceNumber: "UK-BIRTH-000001",
    type: "BIRTH" as const,
    status: "SUBMITTED" as const,
    applicantName: "Aarav Sharma",
    mobileNumber: "919812345678",
    language: "en",
    formData: {
      dateOfBirth: "2024-03-12",
      placeOfBirth: "Dehradun",
      fatherName: "Manoj Sharma",
      motherName: "Sunita Sharma",
    },
  },
  {
    referenceNumber: "UK-DEATH-000001",
    type: "DEATH" as const,
    status: "UNDER_REVIEW" as const,
    applicantName: "Kavita Devi",
    mobileNumber: null,
    language: "hi",
    formData: {
      dateOfDeath: "2026-06-02",
      placeOfDeath: "Haridwar",
      deceasedName: "Ram Prasad",
    },
  },
  {
    referenceNumber: "UK-BIRTH-000002",
    type: "BIRTH" as const,
    status: "APPROVED" as const,
    applicantName: "Rohit Bisht",
    mobileNumber: "919911223344",
    language: "en",
    formData: {
      dateOfBirth: "2023-11-30",
      placeOfBirth: "Nainital",
      fatherName: "Suresh Bisht",
      motherName: "Geeta Bisht",
    },
    certificatePdfPath: "/certs/uk-birth-000002.pdf",
    reviewedAt: new Date("2026-07-15T10:00:00Z"),
  },
];

async function main() {
  for (const application of applications) {
    await prisma.certificateApplication.upsert({
      where: { referenceNumber: application.referenceNumber },
      create: application,
      update: application,
    });
    console.log(`seeded ${application.referenceNumber} (${application.status})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
