import { z } from "zod";

const requiredText = z.string().trim().min(1, "This field is required");
const requiredName = z.string().trim().min(2, "Enter a valid name");

/** Aadhaar is 12 digits, but optional here — a newborn often doesn't have one yet. */
const optionalAadhaar = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || /^\d{12}$/.test(value), {
    message: "Aadhaar number must be exactly 12 digits",
  });

function notFutureDate(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
}

const pastOrTodayDate = requiredText.refine(notFutureDate, {
  message: "Date cannot be in the future",
});

const sexSchema = z.enum(["MALE", "FEMALE", "OTHER"]);
const genderSchema = z.enum(["MALE", "FEMALE", "TRANSGENDER"]);
const yesNoSchema = z.enum(["YES", "NO"]);
const districtSchema = z.enum([
  "ALMORA",
  "BAGESHWAR",
  "CHAMOLI",
  "CHAMPAWAT",
  "DEHRADUN",
  "HARIDWAR",
  "NAINITAL",
  "PAURI_GARHWAL",
  "PITHORAGARH",
  "RUDRAPRAYAG",
  "TEHRI_GARHWAL",
  "UDHAM_SINGH_NAGAR",
  "UTTARKASHI",
]);
const idProofSchema = z.enum(["AADHAAR_CARD", "VOTER_ID", "RATION_CARD", "PAN_CARD"]);
const residenceProofSchema = z.enum([
  "LAND_REGISTRY",
  "ELECTRICITY_BILL",
  "WATER_BILL",
  "GRAM_PRADHAN_CERTIFICATE",
]);

export const birthFormSchema = z.object({
  applicantName: requiredName,
  childName: requiredName,
  sex: sexSchema,
  dob: pastOrTodayDate,
  placeOfBirth: requiredText,
  fatherName: requiredName,
  fatherAadhaar: optionalAadhaar,
  motherName: requiredName,
  motherAadhaar: optionalAadhaar,
  addressAtBirth: requiredText,
  permanentAddress: requiredText,
});

export const deathFormSchema = z.object({
  applicantName: requiredName,
  deceasedName: requiredName,
  deceasedSex: sexSchema,
  // Kept as a plain number (not z.coerce) so the form-values type matches
  // what register(..., { valueAsNumber: true }) produces on both sides of
  // the resolver — z.coerce's input/output type split otherwise conflicts
  // with useForm<DeathFormValues>'s single type parameter.
  deceasedAge: z.number().int().min(0, "Age must be 0 or more").max(130, "Enter a realistic age"),
  dateOfDeath: pastOrTodayDate,
  placeOfDeath: requiredText,
  causeOfDeath: requiredText,
  fatherOrHusbandName: requiredName,
  informantName: requiredName,
  informantRelation: requiredText,
  deceasedAddress: requiredText,
});

export const domicileFormSchema = z.object({
  applicantName: requiredName,
  fatherHusbandName: requiredName,
  motherName: requiredName,
  gender: genderSchema,
  dob: pastOrTodayDate,
  district: districtSchema,
  tehsil: requiredText,
  villageOrTown: requiredText,
  fullAddress: requiredText,
  // No municipal body applies to most rural applicants — optional, unlike every other domicile field.
  municipalBody: z.string().trim().optional(),
  patwariCircle: requiredText,
  stayDurationYears: z.number().int().min(0, "Enter a valid number of years"),
  ownsLandInUttarakhand: yesNoSchema,
  educatedInState: yesNoSchema,
  idProofType: idProofSchema,
  residenceProofType: residenceProofSchema,
});

export type BirthFormValues = z.infer<typeof birthFormSchema>;
export type DeathFormValues = z.infer<typeof deathFormSchema>;
export type DomicileFormValues = z.infer<typeof domicileFormSchema>;
