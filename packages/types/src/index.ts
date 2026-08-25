/**
 * Shared enums/shapes for the certificate flow. Zero runtime dependencies —
 * every app (bot, and later the web form) imports from here instead of
 * redefining these unions locally. packages/db's Prisma schema is the
 * source of truth for the *database* shape; keep the string values here in
 * sync with schema.prisma's enums (they're plain string enums, so the
 * values match 1:1 with no mapping needed).
 */
export type Service = "BIRTH" | "DEATH" | "DOMICILE";

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

export const GENDER_OPTIONS: FormFieldOption[] = [
  { value: "MALE", label: { en: "Male", hi: "पुरुष" } },
  { value: "FEMALE", label: { en: "Female", hi: "महिला" } },
  { value: "TRANSGENDER", label: { en: "Transgender", hi: "ट्रांसजेंडर" } },
];

export const YES_NO_OPTIONS: FormFieldOption[] = [
  { value: "YES", label: { en: "Yes", hi: "हाँ" } },
  { value: "NO", label: { en: "No", hi: "नहीं" } },
];

export const DISTRICT_OPTIONS: FormFieldOption[] = [
  { value: "ALMORA", label: { en: "Almora", hi: "अल्मोड़ा" } },
  { value: "BAGESHWAR", label: { en: "Bageshwar", hi: "बागेश्वर" } },
  { value: "CHAMOLI", label: { en: "Chamoli", hi: "चमोली" } },
  { value: "CHAMPAWAT", label: { en: "Champawat", hi: "चंपावत" } },
  { value: "DEHRADUN", label: { en: "Dehradun", hi: "देहरादून" } },
  { value: "HARIDWAR", label: { en: "Haridwar", hi: "हरिद्वार" } },
  { value: "NAINITAL", label: { en: "Nainital", hi: "नैनीताल" } },
  { value: "PAURI_GARHWAL", label: { en: "Pauri Garhwal", hi: "पौड़ी गढ़वाल" } },
  { value: "PITHORAGARH", label: { en: "Pithoragarh", hi: "पिथौरागढ़" } },
  { value: "RUDRAPRAYAG", label: { en: "Rudraprayag", hi: "रुद्रप्रयाग" } },
  { value: "TEHRI_GARHWAL", label: { en: "Tehri Garhwal", hi: "टिहरी गढ़वाल" } },
  { value: "UDHAM_SINGH_NAGAR", label: { en: "Udham Singh Nagar", hi: "उधम सिंह नगर" } },
  { value: "UTTARKASHI", label: { en: "Uttarkashi", hi: "उत्तरकाशी" } },
];

export const ID_PROOF_OPTIONS: FormFieldOption[] = [
  { value: "AADHAAR_CARD", label: { en: "Aadhaar Card", hi: "आधार कार्ड" } },
  { value: "VOTER_ID", label: { en: "Voter ID", hi: "वोटर आईडी" } },
  { value: "RATION_CARD", label: { en: "Ration Card", hi: "राशन कार्ड" } },
  { value: "PAN_CARD", label: { en: "PAN Card", hi: "पैन कार्ड" } },
];

export const RESIDENCE_PROOF_OPTIONS: FormFieldOption[] = [
  { value: "LAND_REGISTRY", label: { en: "Land Registry/Khatuni", hi: "भूमि रजिस्ट्री/खतौनी" } },
  { value: "ELECTRICITY_BILL", label: { en: "Electricity Bill", hi: "बिजली बिल" } },
  { value: "WATER_BILL", label: { en: "Water Bill", hi: "पानी का बिल" } },
  {
    value: "GRAM_PRADHAN_CERTIFICATE",
    label: { en: "Gram Pradhan Certificate", hi: "ग्राम प्रधान प्रमाणपत्र" },
  },
];

/** Order here is display order, both on the web form and the PDF. `applicantName` (shared across all three services) is rendered separately by the form/PDF, so it isn't repeated here. */
export const DOMICILE_FORM_FIELDS: FormFieldDef[] = [
  {
    key: "fatherHusbandName",
    label: { en: "Father's or Husband's Name", hi: "पिता या पति का नाम" },
    kind: "text",
  },
  { key: "motherName", label: { en: "Mother's Name", hi: "माता का नाम" }, kind: "text" },
  { key: "gender", label: { en: "Gender", hi: "लिंग" }, kind: "select", options: GENDER_OPTIONS },
  { key: "dob", label: { en: "Date of Birth", hi: "जन्म तिथि" }, kind: "date" },
  { key: "district", label: { en: "District", hi: "जिला" }, kind: "select", options: DISTRICT_OPTIONS },
  { key: "tehsil", label: { en: "Tehsil", hi: "तहसील" }, kind: "text" },
  { key: "villageOrTown", label: { en: "Village, Ward, or Town", hi: "गांव, वार्ड या कस्बा" }, kind: "text" },
  // ponytail: kind "textarea" (not the source spec's plain "text") so this
  // full address renders full-width on both the web form and the PDF,
  // matching how every other address field in this codebase is laid out.
  {
    key: "fullAddress",
    label: { en: "Complete Residential Address", hi: "पूर्ण आवासीय पता" },
    kind: "textarea",
  },
  {
    key: "municipalBody",
    label: { en: "Municipal Body (if applicable)", hi: "नगर निकाय (यदि लागू हो)" },
    kind: "text",
  },
  {
    key: "patwariCircle",
    label: { en: "Patwari Circle", hi: "पटवारी क्षेत्र" },
    kind: "text",
  },
  {
    key: "stayDurationYears",
    label: { en: "Duration of Continuous Stay (in Years)", hi: "निरंतर निवास की अवधि (वर्षों में)" },
    kind: "number",
  },
  {
    key: "ownsLandInUttarakhand",
    label: {
      en: "Do you or your family own land/property in Uttarakhand?",
      hi: "क्या आप या आपका परिवार उत्तराखंड में भूमि/संपत्ति के मालिक हैं?",
    },
    kind: "select",
    options: YES_NO_OPTIONS,
  },
  {
    key: "educatedInState",
    label: { en: "Did you complete your schooling in Uttarakhand?", hi: "क्या आपने उत्तराखंड में अपनी स्कूली शिक्षा पूरी की?" },
    kind: "select",
    options: YES_NO_OPTIONS,
  },
  {
    key: "idProofType",
    label: { en: "Identity Proof Type", hi: "पहचान प्रमाण प्रकार" },
    kind: "select",
    options: ID_PROOF_OPTIONS,
  },
  {
    key: "residenceProofType",
    label: { en: "Residence Proof Type", hi: "निवास प्रमाण प्रकार" },
    kind: "select",
    options: RESIDENCE_PROOF_OPTIONS,
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
