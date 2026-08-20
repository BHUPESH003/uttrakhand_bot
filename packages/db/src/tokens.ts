import type { CertificateType } from "@prisma/client";
import { prisma } from "./client";

export interface CreateTokenInput {
  token: string;
  mobileNumber: string;
  service: CertificateType;
  language: string;
  applicantName: string;
  expiresAt: Date;
}

export async function createToken(input: CreateTokenInput) {
  return prisma.handoffToken.create({ data: input });
}

export async function resolveToken(token: string) {
  return prisma.handoffToken.findUnique({ where: { token } });
}

/** Called once the web form (not built yet) submits and creates the application this token was for. */
export async function attachApplicationToToken(token: string, applicationId: string) {
  return prisma.handoffToken.update({ where: { token }, data: { applicationId } });
}
