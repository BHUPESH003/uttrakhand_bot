/**
 * Shared enums/shapes for the certificate flow. Zero runtime dependencies —
 * every app (bot, and later the web form) imports from here instead of
 * redefining these unions locally. packages/db's Prisma schema is the
 * source of truth for the *database* shape; keep the string values here in
 * sync with schema.prisma's enums (they're plain string enums, so the
 * values match 1:1 with no mapping needed).
 */
export type Service = "BIRTH" | "DEATH";

export type ApplicationStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED";

export type MessageDirection = "INCOMING" | "OUTGOING";

export type Lang = "en" | "hi";

/** Mirrors packages/db's CertificateApplication model. */
export interface CertificateApplication {
  id: string;
  referenceNumber: string;
  type: Service;
  status: ApplicationStatus;
  applicantName: string;
  mobileNumber: string | null;
  language: string;
  formData: unknown;
  certificatePdfPath: string | null;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Metadata for one field of a certificate's `formData` — label, rendering
 * hint, and (for selects) options. Single source of truth shared by
 * apps/web (renders the actual form) and apps/admin (labels the same
 * fields on the generated certificate PDF), so the two can never drift
 * out of sync. Validation rules (required/regex/range) stay in apps/web's
 * zod schema — this is presentation metadata only, not a validator.
 */
export interface FormFieldOption {
  value: string;
  label: { en: string; hi: string };
}

export interface FormFieldDef {
  key: string;
  label: { en: string; hi: string };
  kind: "text" | "textarea" | "date" | "number" | "select";
  options?: FormFieldOption[];
}

export const SEX_OPTIONS: FormFieldOption[] = [
  { value: "MALE", label: { en: "Male", hi: "पुरुष" } },
  { value: "FEMALE", label: { en: "Female", hi: "महिला" } },
  { value: "OTHER", label: { en: "Other", hi: "अन्य" } },
];

/** Order here is display order, both on the web form and the PDF. */
export const BIRTH_FORM_FIELDS: FormFieldDef[] = [
  { key: "childName", label: { en: "Child's Name", hi: "बच्चे का नाम" }, kind: "text" },
  { key: "sex", label: { en: "Sex", hi: "लिंग" }, kind: "select", options: SEX_OPTIONS },
  { key: "dob", label: { en: "Date of Birth", hi: "जन्म तिथि" }, kind: "date" },
  { key: "placeOfBirth", label: { en: "Place of Birth", hi: "जन्म स्थान" }, kind: "text" },
  { key: "fatherName", label: { en: "Father's Name", hi: "पिता का नाम" }, kind: "text" },
  {
    key: "fatherAadhaar",
    label: { en: "Father's Aadhaar No. (optional)", hi: "पिता का आधार नंबर (वैकल्पिक)" },
    kind: "text",
  },
  { key: "motherName", label: { en: "Mother's Name", hi: "माता का नाम" }, kind: "text" },
  {
    key: "motherAadhaar",
    label: { en: "Mother's Aadhaar No. (optional)", hi: "माता का आधार नंबर (वैकल्पिक)" },
    kind: "text",
  },
  {
    key: "addressAtBirth",
    label: { en: "Address at Time of Birth", hi: "जन्म के समय का पता" },
    kind: "textarea",
  },
  {
    key: "permanentAddress",
    label: { en: "Permanent Address", hi: "स्थायी पता" },
    kind: "textarea",
  },
];

export const DEATH_FORM_FIELDS: FormFieldDef[] = [
  { key: "deceasedName", label: { en: "Deceased's Name", hi: "मृतक का नाम" }, kind: "text" },
  { key: "deceasedSex", label: { en: "Sex", hi: "लिंग" }, kind: "select", options: SEX_OPTIONS },
  { key: "deceasedAge", label: { en: "Age at Death", hi: "मृत्यु के समय आयु" }, kind: "number" },
  { key: "dateOfDeath", label: { en: "Date of Death", hi: "मृत्यु तिथि" }, kind: "date" },
  { key: "placeOfDeath", label: { en: "Place of Death", hi: "मृत्यु स्थान" }, kind: "text" },
  { key: "causeOfDeath", label: { en: "Cause of Death", hi: "मृत्यु का कारण" }, kind: "text" },
  {
    key: "fatherOrHusbandName",
    label: { en: "Father's/Husband's Name", hi: "पिता/पति का नाम" },
    kind: "text",
  },
  { key: "informantName", label: { en: "Informant's Name", hi: "सूचनादाता का नाम" }, kind: "text" },
  {
    key: "informantRelation",
    label: { en: "Informant's Relation to Deceased", hi: "मृतक से सूचनादाता का संबंध" },
    kind: "text",
  },
  {
    key: "deceasedAddress",
    label: { en: "Permanent Address", hi: "स्थायी पता" },
    kind: "textarea",
  },
];
