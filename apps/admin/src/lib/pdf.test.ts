/**
 * Self-check for certificate PDF generation — renders one birth, one
 * death, and one domicile certificate against representative form data
 * (including a Devanagari applicant name, to exercise the font-switch path) and asserts
 * the output is a well-formed, non-trivial PDF. Not a visual/pixel check
 * (no framework for that here) — just enough to catch a crash or a
 * suspiciously empty/broken file before it ships. Run directly:
 *
 *   pnpm --filter admin test
 *
 * Sets fake env vars before importing anything that reads config.ts, since
 * config validation runs eagerly at import time.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { CertificateApplication } from "db";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.ADMIN_PASSWORD ??= "test-password";
process.env.INTERNAL_API_SECRET ??= "test-internal-secret";
process.env.BOT_INTERNAL_URL ??= "http://localhost:3001";
process.env.ADMIN_PUBLIC_URL ??= "http://localhost:3002";

function baseApplication(overrides: Partial<CertificateApplication>): CertificateApplication {
  const now = new Date();
  return {
    id: randomUUID(),
    referenceNumber: `UK-TEST-${randomUUID().slice(0, 8).toUpperCase()}`,
    type: "BIRTH",
    status: "APPROVED",
    applicantName: "Test Applicant",
    mobileNumber: "919999999999",
    language: "en",
    formData: {},
    certificatePdfPath: null,
    rejectionReason: null,
    reviewedAt: now,
    reviewedByName: "Test Registrar",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function main() {
  const { generateCertificatePdf } = await import("./pdf.js");

  // This suite is run repeatedly — clear out last run's throwaway files
  // rather than letting UK-TEST-*.pdf accumulate in a directory that's
  // otherwise real, publicly-served certificates.
  const certDir = path.join(process.cwd(), "public", "certificates");
  const previous = await readdir(certDir).catch(() => []);
  await Promise.all(
    previous.filter((name) => name.startsWith("UK-TEST-")).map((name) => unlink(path.join(certDir, name))),
  );

  const birthApp = baseApplication({
    type: "BIRTH",
    formData: {
      childName: "Gurparwaan Singh",
      sex: "MALE",
      dob: "2023-07-05",
      placeOfBirth: "Kashipur, Uttarakhand",
      fatherName: "Princepal Singh",
      fatherAadhaar: "123456789012",
      motherName: "Pawandeep Kaur",
      addressAtBirth: "Village Darha, Sitarganj, Udham Singh Nagar, Uttarakhand 262405",
      permanentAddress: "Village Darha, Sitarganj, Udham Singh Nagar, Uttarakhand 262405",
    },
  });

  const deathApp = baseApplication({
    type: "DEATH",
    // Exercises the Devanagari font-switch path for a value pdfkit's
    // built-in Helvetica can't render at all.
    applicantName: "कविता देवी",
    formData: {
      deceasedName: "Ram Prasad",
      deceasedSex: "MALE",
      deceasedAge: 74,
      dateOfDeath: "2026-06-02",
      placeOfDeath: "Haridwar",
      causeOfDeath: "Natural causes",
      fatherOrHusbandName: "Late Shyam Lal",
      informantName: "Kavita Devi",
      informantRelation: "Daughter",
      deceasedAddress: "Ward 4, Haridwar, Uttarakhand",
    },
  });

  const domicileApp = baseApplication({
    type: "DOMICILE",
    // Devanagari name, like the real reference certificate — exercises the
    // same font-switch path as the death cert above, plus the gender ->
    // honorific mapping in renderDomicileCertificate.
    applicantName: "विकास कुमार",
    reviewedByName: "Shipra Joshi",
    formData: {
      fatherHusbandName: "Narendra Kumar",
      motherName: "Hema Devi",
      gender: "MALE",
      dob: "1998-11-20",
      district: "ALMORA",
      tehsil: "Bhikiyasain",
      villageOrTown: "Saure",
      fullAddress: "Village-Saure, Post-Basot",
      // municipalBody intentionally omitted — exercises the "ना" fallback
      // the real certificate shows for a rural address with no municipal body.
      patwariCircle: "Basot",
      stayDurationYears: 27,
      ownsLandInUttarakhand: "YES",
      educatedInState: "YES",
      idProofType: "AADHAAR_CARD",
      residenceProofType: "LAND_REGISTRY",
    },
  });

  for (const application of [birthApp, deathApp, domicileApp]) {
    const url = await generateCertificatePdf(application);
    assert.match(url, /\/certificates\/UK-TEST-.+\.pdf$/);

    const filePath = path.join(process.cwd(), "public", "certificates", `${application.referenceNumber}.pdf`);
    const buffer = await readFile(filePath);
    assert.ok(
      buffer.length > 2000,
      `PDF for ${application.type} suspiciously small: ${buffer.length} bytes`,
    );
    assert.equal(
      buffer.subarray(0, 5).toString("latin1"),
      "%PDF-",
      "output is not a valid PDF header",
    );
  }

  console.log("ok — birth, death, and domicile certificate PDFs generated and look well-formed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
