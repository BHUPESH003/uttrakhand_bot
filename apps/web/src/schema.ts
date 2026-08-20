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

export type BirthFormValues = z.infer<typeof birthFormSchema>;
export type DeathFormValues = z.infer<typeof deathFormSchema>;
