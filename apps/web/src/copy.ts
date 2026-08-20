/**
 * Page-chrome copy — titles, buttons, errors, the success screen. Field
 * *labels* (child's name, date of birth, ...) live in packages/types'
 * BIRTH_FORM_FIELDS/DEATH_FORM_FIELDS instead, shared with apps/admin's PDF
 * renderer so the two can't drift apart. Components call t(lang, "key") —
 * never hardcode text — so this file is the only place to edit for
 * page-chrome copy changes.
 */
import type { Lang } from "types";

const en = {
  invalidTokenTitle: "Link expired or invalid",
  invalidTokenBody:
    "This application link has expired or is no longer valid. Please return to WhatsApp and request a new link from the main menu.",

  formSubtitle: "Please fill in accurate details as per official records. All fields are required unless marked optional.",

  applicantName: "Applicant Name",
  submit: "Submit Application",
  submitting: "Submitting...",
  submitError: "Something went wrong while submitting. Please try again.",
  sameAsAddressAbove: "Same as address above",
  aadhaarHint: "12-digit Aadhaar number, if available",

  successTitle: "Application Submitted!",
  successBody: "Your application has been received and is now under review.",
  successReferenceLabel: "Your Reference Number",
  successNote:
    "Save this number. You can check your application's status anytime on WhatsApp — just open the chat and tap ‘Track Status’ from the Main Menu.",

  birthFormTitle: "Birth Certificate Application",
  deathFormTitle: "Death Certificate Application",

  required: "This field is required",
} as const;

const hi: Record<keyof typeof en, string> = {
  invalidTokenTitle: "लिंक समाप्त या अमान्य है",
  invalidTokenBody:
    "यह आवेदन लिंक समाप्त हो चुका है या अब मान्य नहीं है। कृपया व्हाट्सएप पर वापस जाएं और मुख्य मेनू से एक नया लिंक प्राप्त करें।",

  formSubtitle: "कृपया आधिकारिक रिकॉर्ड के अनुसार सही विवरण भरें। जब तक वैकल्पिक न बताया जाए, सभी फ़ील्ड आवश्यक हैं।",

  applicantName: "आवेदक का नाम",
  submit: "आवेदन जमा करें",
  submitting: "जमा हो रहा है...",
  submitError: "जमा करते समय कुछ गलत हो गया। कृपया पुनः प्रयास करें।",
  sameAsAddressAbove: "ऊपर दिए पते के समान",
  aadhaarHint: "12-अंकों का आधार नंबर, यदि उपलब्ध हो",

  successTitle: "आवेदन सफलतापूर्वक जमा हुआ!",
  successBody: "आपका आवेदन प्राप्त हो गया है और अब समीक्षाधीन है।",
  successReferenceLabel: "आपकी संदर्भ संख्या",
  successNote:
    "इस नंबर को सुरक्षित रखें। आप व्हाट्सएप पर कभी भी अपने आवेदन की स्थिति जांच सकते हैं — बस चैट खोलें और मुख्य मेनू से 'स्थिति ट्रैक करें' पर टैप करें।",

  birthFormTitle: "जन्म प्रमाणपत्र आवेदन",
  deathFormTitle: "मृत्यु प्रमाणपत्र आवेदन",

  required: "यह फ़ील्ड आवश्यक है",
};

export const copy = { en, hi };
export type CopyKey = keyof typeof en;

export function t(lang: Lang, key: CopyKey): string {
  return copy[lang][key];
}
