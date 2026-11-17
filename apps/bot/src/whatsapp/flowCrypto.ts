/**
 * WhatsApp Flows data-endpoint crypto, following Meta's Node sample exactly:
 * https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 *
 *   request:  AES key = RSA-OAEP(SHA-256) decrypt of encrypted_aes_key
 *             payload = AES-128-GCM decrypt of encrypted_flow_data with
 *                       initial_vector; last 16 bytes are the auth tag
 *   response: AES-128-GCM with the same key and the IV with every bit
 *             inverted; ciphertext + tag, base64, sent as plain text
 *
 * Plus X-Hub-Signature-256 verification (HMAC-SHA256 of the raw body with
 * the app secret). Pure functions, node:crypto only.
 */
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  privateDecrypt,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";

export interface EncryptedFlowRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

const TAG_LENGTH = 16;

export function isEncryptedFlowRequest(body: unknown): body is EncryptedFlowRequest {
  const b = body as Partial<EncryptedFlowRequest> | null;
  return (
    typeof b === "object" &&
    b !== null &&
    typeof b.encrypted_flow_data === "string" &&
    typeof b.encrypted_aes_key === "string" &&
    typeof b.initial_vector === "string"
  );
}

/** Throws on any failure (wrong key, tampered data, bad JSON) — the route maps that to HTTP 421. */
export function decryptFlowRequest(
  body: EncryptedFlowRequest,
  privateKey: KeyObject,
): { payload: unknown; aesKey: Buffer; iv: Buffer } {
  const aesKey = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(body.encrypted_aes_key, "base64"),
  );
  const data = Buffer.from(body.encrypted_flow_data, "base64");
  const iv = Buffer.from(body.initial_vector, "base64");
  const decipher = createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(data.subarray(-TAG_LENGTH));
  const json = Buffer.concat([decipher.update(data.subarray(0, -TAG_LENGTH)), decipher.final()]).toString("utf-8");
  return { payload: JSON.parse(json), aesKey, iv };
}

/** Same as Meta's sample: `~byte` per IV byte (XOR 0xFF). */
export function flipIv(iv: Buffer): Buffer {
  return Buffer.from(iv.map((byte) => byte ^ 0xff));
}

export function encryptFlowResponse(response: unknown, aesKey: Buffer, iv: Buffer): string {
  const cipher = createCipheriv("aes-128-gcm", aesKey, flipIv(iv));
  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

/** `header` is the raw X-Hub-Signature-256 value, "sha256=<hex>". */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
