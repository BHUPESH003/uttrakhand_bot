/**
 * Generates the certificate PDF and writes it under public/certificates so
 * Next serves it as a static asset — no separate route handler needed.
 * Returns the full public URL (ADMIN_PUBLIC_URL + path), since that's what
 * both apps/bot's WhatsApp sendDocument call and the admin UI need: a URL
 * Meta's servers can fetch directly.
 *
 * Layout is modeled on a real Uttarakhand birth certificate: bilingual
 * legal citation + title, a certifying statement, a two-column field grid
 * (labels/order shared with apps/web's form via packages/types, so the two
 * can never show different data for the same field), a signature block,
 * and a QR code + disclaimer footer.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { CertificateApplication } from "db";
import { BIRTH_FORM_FIELDS, DEATH_FORM_FIELDS, type FormFieldDef } from "types";
import { theme } from "theme";
import { config } from "../config";

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

/** Switches to the Devanagari font only for values that actually need it — most applicant-entered text is English, and pdfkit has no font fallback of its own. */
function fontFor(doc: PDFKit.PDFDocument, text: string): void {
  doc.font(DEVANAGARI_RANGE.test(text) ? DEVANAGARI_FONT_PATH : "Helvetica");
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
function drawTitleBlock(doc: PDFKit.PDFDocument, type: "BIRTH" | "DEATH"): void {
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(theme.colors.neutral[500])
    .text(
      "Issued under the Registration of Births & Deaths Act, 1969, and the Uttarakhand Registration of Births & Deaths Rules, 2003.",
      doc.page.margins.left,
      doc.y,
      { width: contentWidth, align: "center" },
    );

  doc.moveDown(0.6);
  const titleEn = type === "BIRTH" ? "BIRTH CERTIFICATE" : "DEATH CERTIFICATE";
  const titleHi = type === "BIRTH" ? "जन्म प्रमाण-पत्र" : "मृत्यु प्रमाण-पत्र";
  doc.font("Helvetica-Bold").fontSize(18).fillColor(theme.colors.green[700]);
  doc.text(titleEn, doc.page.margins.left, doc.y, { width: contentWidth, align: "center" });
  doc.font(DEVANAGARI_FONT_PATH).fontSize(14);
  doc.text(titleHi, doc.page.margins.left, doc.y, { width: contentWidth, align: "center" });

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
function drawSignatureBlock(doc: PDFKit.PDFDocument, reviewerName: string | null): void {
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
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(theme.colors.navy[700])
    .text("Registrar (Birth & Death)", signX, y + 48, { width: 200, align: "center" });
  doc
    .font(DEVANAGARI_FONT_PATH)
    .fontSize(8)
    .fillColor(theme.colors.neutral[500])
    .text("रजिस्ट्रार (जन्म एवं मृत्यु)", signX, y + 60, { width: 200, align: "center" });

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

async function renderPdf(application: CertificateApplication): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // ponytail: footer is only drawn on the last page (see below) — fine for
    // this form's field count, which never realistically overflows a page.
    doc.on("pageAdded", () => drawHeader(doc));

    void (async () => {
      try {
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

        const fields = application.type === "BIRTH" ? BIRTH_FORM_FIELDS : DEATH_FORM_FIELDS;
        const gridFields = fields.filter((field) => field.kind !== "textarea");
        const fullWidthFields = fields.filter((field) => field.kind === "textarea");
        const formData = (application.formData as Record<string, unknown> | null) ?? {};

        drawFieldGrid(doc, gridFields, formData);
        doc.moveDown(0.5);
        drawFullWidthFields(doc, fullWidthFields, formData);

        drawSignatureBlock(doc, application.reviewedByName);
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
