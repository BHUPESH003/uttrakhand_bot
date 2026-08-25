/**
 * Generates the certificate PDF and writes it under public/certificates so
 * Next serves it as a static asset — no separate route handler needed.
 * Returns the full public URL (ADMIN_PUBLIC_URL + path), since that's what
 * both apps/bot's WhatsApp sendDocument call and the admin UI need: a URL
 * Meta's servers can fetch directly.
 *
 * Birth/death certificates share one layout, modeled on a real Uttarakhand
 * birth certificate: bilingual legal citation + title, a certifying
 * statement, a two-column field grid (labels/order shared with apps/web's
 * form via packages/types, so the two can never show different data for the
 * same field), a signature block, and a QR code + disclaimer footer.
 *
 * Domicile certificates (renderDomicileCertificate) use a structurally
 * different layout, modeled on a real Uttarakhand "स्थाई निवास प्रमाण-पत्र":
 * QR top-left, a certifying declaration instead of a field grid, and a
 * digital-signature stamp instead of a facsimile signature line.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { CertificateApplication } from "db";
import {
  BIRTH_FORM_FIELDS,
  DEATH_FORM_FIELDS,
  DISTRICT_OPTIONS,
  type FormFieldDef,
  type FormFieldOption,
} from "types";
import { theme } from "theme";
import { config } from "../config";

type BirthOrDeath = "BIRTH" | "DEATH";

/** Per-certificate-type text and fields for the shared birth/death field-grid layout. */
const CERT_META: Record<
  BirthOrDeath,
  {
    citationEn: string;
    titleEn: string;
    titleHi: string;
    registrarEn: string;
    registrarHi: string;
    fields: FormFieldDef[];
  }
> = {
  BIRTH: {
    citationEn:
      "Issued under the Registration of Births & Deaths Act, 1969, and the Uttarakhand Registration of Births & Deaths Rules, 2003.",
    titleEn: "BIRTH CERTIFICATE",
    titleHi: "जन्म प्रमाण-पत्र",
    registrarEn: "Registrar (Birth & Death)",
    registrarHi: "रजिस्ट्रार (जन्म एवं मृत्यु)",
    fields: BIRTH_FORM_FIELDS,
  },
  DEATH: {
    citationEn:
      "Issued under the Registration of Births & Deaths Act, 1969, and the Uttarakhand Registration of Births & Deaths Rules, 2003.",
    titleEn: "DEATH CERTIFICATE",
    titleHi: "मृत्यु प्रमाण-पत्र",
    registrarEn: "Registrar (Birth & Death)",
    registrarHi: "रजिस्ट्रार (जन्म एवं मृत्यु)",
    fields: DEATH_FORM_FIELDS,
  },
};

const CERT_DIR = path.join(process.cwd(), "public", "certificates");
const LOGO_PATH = path.join(process.cwd(), "public", "logo_uk.jpg");
// Bundled (not a system font path) so this works wherever the app actually
// runs — pdfkit's built-in Helvetica has no Devanagari glyphs at all.
const DEVANAGARI_FONT_PATH = path.join(
  process.cwd(),
  "assets",
  "fonts",
  "NotoSansDevanagari-Regular.ttf",
);

const HEADER_HEIGHT = 80;
const ACCENT_HEIGHT = 4;
// logo_uk.jpg's actual pixel dimensions — it's a fixed bundled asset, not
// user-uploaded, so there's no need to probe this at runtime.
const LOGO_ASPECT_RATIO = 735 / 414;

const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

function resolveFont(text: string): string {
  return DEVANAGARI_RANGE.test(text) ? DEVANAGARI_FONT_PATH : "Helvetica";
}

/** Switches to the Devanagari font only for values that actually need it — most applicant-entered text is English, and pdfkit has no font fallback of its own. */
function fontFor(doc: PDFKit.PDFDocument, text: string): void {
  doc.font(resolveFont(text));
}

/**
 * Draws a Devanagari label immediately followed by a value that might be
 * pure Latin (a reference number, an English-typed tehsil name) — same
 * one-font-can't-cover-both-scripts problem drawLabeledField works around
 * below, but for an inline "label: value" line rather than a stacked
 * label/value block. Uses pdfkit's continued-text chaining, which flows
 * mixed-font segments correctly for left-aligned or justified text.
 *
 * Do NOT use this for `align: "right"`/`"center"` — pdfkit's continued-text
 * chaining overlaps segments instead of flowing them once a font switch is
 * combined with either alignment (confirmed by testing); use
 * drawAlignedMixedLine for those instead.
 */
function drawInlineLabelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  options?: PDFKit.Mixins.TextOptions,
): void {
  doc.font(DEVANAGARI_FONT_PATH).text(label, x, y, { ...options, continued: true });
  fontFor(doc, value);
  doc.text(value);
}

/**
 * Draws a line built from multiple font-tagged segments end-to-end, with
 * the whole line right- or center-aligned as one unit — computes each
 * segment's width up front and positions them manually, since pdfkit's
 * continued-text chaining can't do this reliably (see drawInlineLabelValue).
 */
function drawAlignedMixedLine(
  doc: PDFKit.PDFDocument,
  segments: Array<{ text: string; font: string }>,
  x: number,
  y: number,
  width: number,
  align: "right" | "center",
): void {
  const widths = segments.map((segment) => {
    doc.font(segment.font);
    return doc.widthOfString(segment.text);
  });
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  let cursorX = align === "right" ? x + width - totalWidth : x + (width - totalWidth) / 2;

  segments.forEach((segment, i) => {
    doc.font(segment.font).text(segment.text, cursorX, y, { lineBreak: false });
    cursorX += widths[i]!;
  });
}

/** Navy band + logo + site name — same colors/asset as the web header, from the shared theme package. */
function drawHeader(doc: PDFKit.PDFDocument): void {
  const pageWidth = doc.page.width;

  doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(theme.colors.navy[700]);
  doc.rect(0, HEADER_HEIGHT, pageWidth, ACCENT_HEIGHT).fill(theme.colors.green[600]);

  const logoX = 40;
  const logoHeight = 44;
  const logoWidth = logoHeight * LOGO_ASPECT_RATIO;
  doc.image(LOGO_PATH, logoX, (HEADER_HEIGHT - logoHeight) / 2, { height: logoHeight });

  // Text starts clear of the logo's actual rendered width, not a guessed
  // fixed offset — this image isn't square, a hardcoded x overlapped it.
  const textX = logoX + logoWidth + 16;
  doc
    .font("Helvetica")
    .fillColor("#ffffff")
    .fontSize(16)
    .text(theme.siteName.en, textX, 22, { lineBreak: false });
  doc
    .font(DEVANAGARI_FONT_PATH)
    .fillColor(theme.colors.navy[100])
    .fontSize(11)
    .text(theme.siteName.hi, textX, 44, { lineBreak: false });
  doc.font("Helvetica");

  doc.fillColor("#000000");
  doc.x = doc.page.margins.left;
  doc.y = HEADER_HEIGHT + ACCENT_HEIGHT + 20;
}

/** Bilingual legal citation + the big certificate title, styled after the reference certificate (green, centered, bilingual). */
function drawTitleBlock(doc: PDFKit.PDFDocument, type: BirthOrDeath): void {
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const meta = CERT_META[type];

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(theme.colors.neutral[500])
    .text(meta.citationEn, doc.page.margins.left, doc.y, { width: contentWidth, align: "center" });

  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(theme.colors.green[700]);
  doc.text(meta.titleEn, doc.page.margins.left, doc.y, { width: contentWidth, align: "center" });
  doc.font(DEVANAGARI_FONT_PATH).fontSize(14);
  doc.text(meta.titleHi, doc.page.margins.left, doc.y, { width: contentWidth, align: "center" });

  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  doc.text(
    "This is to certify that the following details have been taken from the official record maintained by the Government of Uttarakhand.",
    doc.page.margins.left,
    doc.y,
    { width: contentWidth, align: "center" },
  );
  doc.moveDown(1);
}

/**
 * A value has an English rendering and, for select fields (sex), a fixed
 * Hindi one too. Kept as two separate strings rather than one combined
 * "en / hi" line — see drawLabeledField for why: a single font can't cover
 * both scripts on the same line, so each piece needs to be drawn with the
 * font it actually has glyphs for.
 */
function formatFieldValue(field: FormFieldDef, raw: unknown): { en: string; hi?: string } {
  if (raw === undefined || raw === null || raw === "") return { en: "—" };

  if (field.kind === "select") {
    const option = field.options?.find((candidate) => candidate.value === raw);
    return option ? { en: option.label.en, hi: option.label.hi } : { en: String(raw) };
  }

  if (field.kind === "date") {
    const parsed = new Date(String(raw));
    if (!Number.isNaN(parsed.getTime())) {
      return { en: parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) };
    }
  }

  return { en: String(raw) };
}

/**
 * Draws one label+value block: English label, Hindi label, then the value
 * (font-detected per fontFor, since a free-text value the applicant typed
 * in Hindi is itself pure-script and safe to auto-detect — only combined
 * "en / hi" strings are unsafe, which is why formatFieldValue never
 * produces one). Returns the y just below the block, so the caller can
 * size rows by however tall the content actually was.
 */
function drawLabeledField(
  doc: PDFKit.PDFDocument,
  field: FormFieldDef,
  value: { en: string; hi?: string },
  x: number,
  y: number,
  width: number,
): number {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(theme.colors.neutral[500]);
  doc.text(field.label.en, x, y, { width });
  doc.font(DEVANAGARI_FONT_PATH).fontSize(8);
  doc.text(field.label.hi, x, y + 10, { width });

  const valueY = y + 22;
  fontFor(doc, value.en);
  doc.fontSize(11).fillColor("#000000");
  doc.text(value.en, x, valueY, { width });

  if (!value.hi) return valueY + 14;

  doc.font(DEVANAGARI_FONT_PATH).fontSize(10).fillColor(theme.colors.neutral[700]);
  doc.text(value.hi, x, valueY + 14, { width });
  return valueY + 28;
}

/** Two fields per row (short fields only — addresses are drawn full-width separately so long text has room to wrap). */
function drawFieldGrid(
  doc: PDFKit.PDFDocument,
  fields: FormFieldDef[],
  formData: Record<string, unknown>,
): void {
  const leftX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = contentWidth / 2 - 12;
  const rightX = leftX + colWidth + 24;

  for (let i = 0; i < fields.length; i += 2) {
    const y = doc.y;
    const leftField = fields[i];
    const rightField = fields[i + 1];
    const leftBottom = leftField
      ? drawLabeledField(doc, leftField, formatFieldValue(leftField, formData[leftField.key]), leftX, y, colWidth)
      : y;
    const rightBottom = rightField
      ? drawLabeledField(doc, rightField, formatFieldValue(rightField, formData[rightField.key]), rightX, y, colWidth)
      : y;
    doc.y = Math.max(leftBottom, rightBottom) + 10;
  }
}

/** Address-style fields — full page width, own row, so wrapped text never collides with a neighboring column. */
function drawFullWidthFields(
  doc: PDFKit.PDFDocument,
  fields: FormFieldDef[],
  formData: Record<string, unknown>,
): void {
  const leftX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const field of fields) {
    const value = formatFieldValue(field, formData[field.key]);
    const bottom = drawLabeledField(doc, field, value, leftX, doc.y, contentWidth);
    doc.y = bottom + 10;
  }
}

/** Issue date (left) + a facsimile signature line, the reviewer's name, and issuing-authority text (right), mirroring the reference certificate's registrar block. */
function drawSignatureBlock(doc: PDFKit.PDFDocument, type: BirthOrDeath, reviewerName: string | null): void {
  doc.moveDown(1);
  const leftX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.y;

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(theme.colors.neutral[500])
    .text("Date of Issue", leftX, y);
  doc
    .fontSize(11)
    .fillColor("#000000")
    .text(new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }), leftX, y + 12);

  const signX = leftX + contentWidth - 200;
  doc
    .moveTo(signX, y + 30)
    .lineTo(signX + 200, y + 30)
    .strokeColor(theme.colors.neutral[300])
    .stroke();

  const signatoryName = reviewerName || "Registrar";
  fontFor(doc, signatoryName);
  doc
    .fontSize(10)
    .fillColor("#000000")
    .text(signatoryName, signX, y + 34, { width: 200, align: "center" });
  const meta = CERT_META[type];
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(theme.colors.navy[700])
    .text(meta.registrarEn, signX, y + 48, { width: 200, align: "center" });
  doc
    .font(DEVANAGARI_FONT_PATH)
    .fontSize(8)
    .fillColor(theme.colors.neutral[500])
    .text(meta.registrarHi, signX, y + 60, { width: 200, align: "center" });

  doc.y = y + 80;
}

/** QR code (left) encoding the reference number for quick lookup, + the same computer-generated disclaimer real certificates carry. Drawn on whichever page is current when called. */
async function drawFooter(doc: PDFKit.PDFDocument, application: CertificateApplication): Promise<void> {
  const { width: pageWidth, height: pageHeight } = doc.page;
  const footerTop = pageHeight - 110;

  doc
    .moveTo(40, footerTop)
    .lineTo(pageWidth - 40, footerTop)
    .strokeColor(theme.colors.neutral[300])
    .stroke();

  const qrBuffer = await QRCode.toBuffer(
    `UK-CERT|ref=${application.referenceNumber}|type=${application.type}|issued=${new Date().toISOString().slice(0, 10)}`,
    { margin: 1, width: 70 },
  );
  doc.image(qrBuffer, 40, footerTop + 12, { width: 60, height: 60 });

  // Text this close to the page edge otherwise trips pdfkit's own
  // auto-page-break (it adds a blank page rather than clipping).
  doc.page.margins.bottom = 0;

  const disclaimerX = 40 + 60 + 16;
  const disclaimerWidth = pageWidth - disclaimerX - 40;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(theme.colors.neutral[500])
    .text(
      "This is a computer-generated certificate and does not require a physical signature. Scan the QR code to verify the reference number.",
      disclaimerX,
      footerTop + 14,
      { width: disclaimerWidth },
    );
  doc
    .font(DEVANAGARI_FONT_PATH)
    .fontSize(8)
    .text(
      "यह एक कंप्यूटर जनित प्रमाणपत्र है और इसके लिए हस्ताक्षर की आवश्यकता नहीं है।",
      disclaimerX,
      footerTop + 42,
      { width: disclaimerWidth },
    );

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(theme.colors.neutral[500])
    .text(`© ${new Date().getFullYear()} ${theme.siteName.en} — demo service, not for official use.`, 40, footerTop + 78, {
      width: pageWidth - 80,
      align: "center",
    });
}

const GENDER_HONORIFIC: Record<string, string> = { MALE: "श्री", FEMALE: "श्रीमती" };

function selectLabelHi(options: FormFieldOption[], value: unknown): string {
  return options.find((option) => option.value === value)?.label.hi ?? String(value ?? "");
}

/** The real certificate prints "ना" for an inapplicable optional field (e.g. no municipal body for a rural address) rather than leaving the row blank. */
function domicileValueOrNone(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || "ना";
}

/** "27-March-2022", matching the reference certificate's issue-date format. */
function formatIssueDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleDateString("en-IN", { month: "long" });
  return `${day}-${month}-${date.getFullYear()}`;
}

/** Faint background emblem + outer frame — the same logo asset as the header, huge and mostly transparent, matching the real certificate's translucent diamond-seal watermark. */
function drawDomicileWatermark(doc: PDFKit.PDFDocument): void {
  const { width: pageWidth, height: pageHeight } = doc.page;
  const watermarkWidth = 320;
  const watermarkHeight = watermarkWidth / LOGO_ASPECT_RATIO;

  doc.opacity(0.06);
  doc.image(LOGO_PATH, pageWidth / 2 - watermarkWidth / 2, pageHeight / 2 - watermarkHeight / 2, {
    width: watermarkWidth,
    height: watermarkHeight,
  });
  doc.opacity(1);

  doc
    .rect(24, 24, pageWidth - 48, pageHeight - 48)
    .lineWidth(1)
    .strokeColor(theme.colors.neutral[300])
    .stroke();
}

/**
 * The narrative-declaration "स्थाई निवास प्रमाण-पत्र" layout real Uttarakhand
 * SDM offices issue — nothing like the birth/death field grid. Only the
 * facts the real certificate actually states get a row here; eligibility
 * inputs (stay duration, land ownership, schooling, ID/residence proof
 * type) are verification inputs for the office, not printed on the
 * certificate itself.
 */
async function renderDomicileCertificate(
  doc: PDFKit.PDFDocument,
  application: CertificateApplication,
): Promise<void> {
  const formData = (application.formData as Record<string, unknown> | null) ?? {};
  const { width: pageWidth, height: pageHeight } = doc.page;
  const marginX = doc.page.margins.left;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  const districtHi = selectLabelHi(DISTRICT_OPTIONS, formData.district);
  const tehsil = String(formData.tehsil ?? "");

  drawDomicileWatermark(doc);

  const topY = doc.y;
  const qrBuffer = await QRCode.toBuffer(
    `UK-CERT|ref=${application.referenceNumber}|type=DOMICILE|issued=${new Date().toISOString().slice(0, 10)}`,
    { margin: 1, width: 70 },
  );
  doc.image(qrBuffer, marginX, topY, { width: 55, height: 55 });
  doc.fontSize(9).fillColor("#000000");
  drawAlignedMixedLine(
    doc,
    [
      { text: "प्रमाण-पत्र संख्या : ", font: DEVANAGARI_FONT_PATH },
      { text: application.referenceNumber, font: resolveFont(application.referenceNumber) },
    ],
    marginX,
    topY,
    contentWidth,
    "right",
  );

  const logoHeight = 55;
  const logoWidth = logoHeight * LOGO_ASPECT_RATIO;
  doc.image(LOGO_PATH, marginX + contentWidth / 2 - logoWidth / 2, topY, { height: logoHeight });

  doc.x = marginX;
  doc.y = topY + logoHeight + 14;

  doc.font(DEVANAGARI_FONT_PATH).fontSize(20).fillColor("#000000");
  doc.text("उत्तराखण्ड सरकार", marginX, doc.y, { width: contentWidth, align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(12);
  doc.text("कार्यालय उप जिलाधिकारी द्वारा प्रदत्त", marginX, doc.y, { width: contentWidth, align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(16);
  doc.text("स्थाई निवास प्रमाण-पत्र", marginX, doc.y, { width: contentWidth, align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(theme.colors.neutral[500]);
  doc.text(
    "(शासनादेश संख्या 2588/एक-4/सा0प्रा0/2001 दिनांक 20, नवंबर, 2001 के आधार पर जारी)",
    marginX,
    doc.y,
    { width: contentWidth, align: "center" },
  );
  doc.moveDown(1.2);

  const colWidth = contentWidth / 2;
  let y = doc.y;
  doc.fontSize(10).fillColor("#000000");
  drawInlineLabelValue(doc, "जिला : ", districtHi, marginX, y, { width: colWidth });
  drawInlineLabelValue(doc, "आवेदन पत्र संख्या : ", application.referenceNumber, marginX + colWidth, y, {
    width: colWidth,
  });
  y += 16;
  drawInlineLabelValue(doc, "उप जिलाधिकारी : ", tehsil, marginX, y, { width: colWidth });
  drawInlineLabelValue(doc, "जारी दिनांक : ", formatIssueDate(new Date()), marginX + colWidth, y, {
    width: colWidth,
  });
  y += 30;

  doc.font(DEVANAGARI_FONT_PATH).fontSize(11);
  doc.text("प्रमाणित किया जाता है कि", marginX, y, { width: contentWidth });
  y = doc.y + 8;

  const honorific = GENDER_HONORIFIC[String(formData.gender)] ?? "";
  const rows: Array<[string, string]> = [
    ["", `${honorific} ${application.applicantName}`.trim()],
    ["पिता/पति का नाम", String(formData.fatherHusbandName ?? "")],
    ["माता का नाम", String(formData.motherName ?? "")],
    ["ग्राम/मोहल्ला/वार्ड", String(formData.villageOrTown ?? "")],
    ["पता", String(formData.fullAddress ?? "")],
    ["तहसील", tehsil],
    ["नगर निकाय", domicileValueOrNone(formData.municipalBody)],
    ["पटवारी क्षेत्र", String(formData.patwariCircle ?? "")],
    ["जिला", districtHi],
  ];

  const labelX = marginX + 20;
  const labelWidth = 150;
  const valueX = labelX + labelWidth + 10;
  const valueWidth = marginX + contentWidth - valueX;

  for (const [label, value] of rows) {
    if (label) {
      doc.font(DEVANAGARI_FONT_PATH).fontSize(10).fillColor("#000000");
      doc.text(label, labelX, y, { width: labelWidth });
    }
    fontFor(doc, value);
    doc.fontSize(10).fillColor("#000000");
    doc.text(value, valueX, y, { width: valueWidth });
    y += Math.max(18, doc.heightOfString(value, { width: valueWidth }) + 6);
  }

  y += 10;
  doc.font(DEVANAGARI_FONT_PATH).fontSize(10).fillColor("#000000");
  doc.text("उत्तराखंड के स्थायी निवासी हैं।", marginX, y, { width: contentWidth });
  y = doc.y + 4;
  // Continued-text chain (see drawInlineLabelValue) since `tehsil` — a
  // value typed by the applicant — sits mid-sentence inside an otherwise
  // Devanagari, wrapped/justified paragraph.
  doc.font(DEVANAGARI_FONT_PATH).text(
    "यह भी प्रमाणित किया जाता हैं कि उक्त प्रमाण-पत्र निर्गत करने से पूर्व निर्धारित मानदंडों को भली भांति जांच कर ली गयी हैं। और मैं जांच से पूर्णतया संतुष्ट हूँ। यह प्रमाण पत्र तहसीलदार ",
    marginX,
    y,
    { width: contentWidth, align: "justify", continued: true },
  );
  fontFor(doc, tehsil);
  doc.text(tehsil, { continued: true });
  doc.font(DEVANAGARI_FONT_PATH);
  doc.text(" के आख्या के आधार पर निर्गत किया गया है।");

  // ponytail: footer/signature pinned to a fixed offset from the bottom
  // (same simplification as the birth/death footer) rather than flowing
  // after the paragraph above — fine for this cert's field count, which
  // never realistically grows tall enough to reach it.
  const footerY = pageHeight - 170;
  doc.fontSize(10).fillColor("#000000");
  fontFor(doc, tehsil);
  doc.text(tehsil, marginX, footerY);
  doc.font(DEVANAGARI_FONT_PATH);
  doc.text(districtHi, marginX, footerY + 14);

  const stampWidth = 170;
  const stampX = marginX + contentWidth - stampWidth;
  doc.roundedRect(stampX, footerY - 6, stampWidth, 62, 6).fillColor(theme.colors.green[50]).fill();
  doc.fillColor(theme.colors.green[700]).font("Helvetica").fontSize(7);
  doc.text("Digitally Signed", stampX + 8, footerY, { width: stampWidth - 16 });
  const signatoryName = application.reviewedByName || "Sub-Divisional Magistrate";
  doc.text(`Signed by: ${signatoryName}`, stampX + 8, doc.y + 1, { width: stampWidth - 16 });
  const now = new Date();
  doc.text(`Date: ${formatIssueDate(now)}`, stampX + 8, doc.y + 1, { width: stampWidth - 16 });
  doc.text(`Time: ${now.toLocaleTimeString("en-IN")}`, stampX + 8, doc.y + 1, { width: stampWidth - 16 });

  doc.font(DEVANAGARI_FONT_PATH).fontSize(9).fillColor("#000000");
  doc.text("उप जिला अधिकारी", stampX, footerY + 66, { width: stampWidth, align: "center" });
  doc.fontSize(8).fillColor(theme.colors.neutral[700]);
  fontFor(doc, tehsil);
  doc.text(tehsil, stampX, doc.y + 1, { width: stampWidth, align: "center" });
  doc.font(DEVANAGARI_FONT_PATH);
  doc.text(districtHi, stampX, doc.y + 1, { width: stampWidth, align: "center" });

  // Text this close to the page edge otherwise trips pdfkit's own
  // auto-page-break (it adds a blank page rather than clipping).
  doc.page.margins.bottom = 0;
  const disclaimerY = pageHeight - 66;
  doc.fontSize(8).fillColor(theme.colors.neutral[500]);
  doc.font(DEVANAGARI_FONT_PATH).text("यह प्रमाण पत्र डिजिटली हस्ताक्षरित है एवं विधि मान्य है।", marginX, disclaimerY, {
    width: contentWidth,
    align: "center",
  });
  // drawAlignedMixedLine, not a continued-text chain — the verification URL
  // is Latin inside an otherwise Devanagari, centered line (see its note).
  drawAlignedMixedLine(
    doc,
    [
      { text: "इस प्रमाणपत्र को आवेदन पत्र संख्या का उपयोग कर ", font: DEVANAGARI_FONT_PATH },
      { text: "https://eservices.uk.gov.in", font: "Helvetica" },
      { text: " से सत्यापित किया जा सकता है", font: DEVANAGARI_FONT_PATH },
    ],
    marginX,
    disclaimerY + 14,
    contentWidth,
    "center",
  );
}

async function renderPdf(application: CertificateApplication): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // ponytail: footer is only drawn on the last page (see below) — fine for
    // this form's field count, which never realistically overflows a page.
    doc.on("pageAdded", () => {
      if (application.type !== "DOMICILE") drawHeader(doc);
    });

    void (async () => {
      try {
        if (application.type === "DOMICILE") {
          await renderDomicileCertificate(doc, application);
          doc.end();
          return;
        }

        drawHeader(doc);
        drawTitleBlock(doc, application.type);

        const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.font("Helvetica-Bold").fontSize(9).fillColor(theme.colors.neutral[500]);
        doc.text("Reference Number", doc.page.margins.left, doc.y, { width: contentWidth / 2 });
        const refY = doc.y;
        doc.font("Helvetica-Bold").fontSize(13).fillColor(theme.colors.navy[700]);
        doc.text(application.referenceNumber, doc.page.margins.left, refY, { width: contentWidth / 2 });
        doc.font("Helvetica-Bold").fontSize(9).fillColor(theme.colors.neutral[500]);
        doc.text("Applicant Name", doc.page.margins.left + contentWidth / 2, refY - 13, {
          width: contentWidth / 2,
        });
        fontFor(doc, application.applicantName);
        doc.fontSize(13).fillColor("#000000");
        doc.text(application.applicantName, doc.page.margins.left + contentWidth / 2, refY, {
          width: contentWidth / 2,
        });
        doc.y = refY + 24;
        doc.moveDown(1);

        const fields = CERT_META[application.type].fields;
        const gridFields = fields.filter((field) => field.kind !== "textarea");
        const fullWidthFields = fields.filter((field) => field.kind === "textarea");
        const formData = (application.formData as Record<string, unknown> | null) ?? {};

        drawFieldGrid(doc, gridFields, formData);
        doc.moveDown(0.5);
        drawFullWidthFields(doc, fullWidthFields, formData);

        drawSignatureBlock(doc, application.type, application.reviewedByName);
        await drawFooter(doc, application);

        doc.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

export async function generateCertificatePdf(application: CertificateApplication): Promise<string> {
  await mkdir(CERT_DIR, { recursive: true });
  const buffer = await renderPdf(application);
  const filename = `${application.referenceNumber}.pdf`;
  await writeFile(path.join(CERT_DIR, filename), buffer);
  return `${config.ADMIN_PUBLIC_URL}/certificates/${filename}`;
}
