-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('BIRTH', 'DEATH');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateTable
CREATE TABLE "certificate_applications" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "applicantName" TEXT NOT NULL,
    "mobileNumber" TEXT,
    "language" TEXT NOT NULL,
    "formData" JSONB NOT NULL,
    "certificatePdfPath" TEXT,
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_tokens" (
    "token" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "service" "CertificateType" NOT NULL,
    "language" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handoff_tokens_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "sessions" (
    "userId" TEXT NOT NULL,
    "currentStateKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "lastInboundAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "waMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificate_applications_referenceNumber_key" ON "certificate_applications"("referenceNumber");

-- CreateIndex
CREATE INDEX "certificate_applications_mobileNumber_createdAt_idx" ON "certificate_applications"("mobileNumber", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_mobileNumber_createdAt_idx" ON "message_logs"("mobileNumber", "createdAt");
