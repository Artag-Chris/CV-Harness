-- Extension vectorial (pgvector) — necesaria para el tipo vector(1536)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ResumeStatus" AS ENUM ('PENDING', 'EMBEDDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ResumeKind" AS ENUM ('PDF', 'MARKDOWN', 'TEXT');

-- AlterTable
ALTER TABLE "MatchResult" ADD COLUMN     "analysisScore" INTEGER,
ADD COLUMN     "semanticScore" INTEGER;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "scheduleMinutes" INTEGER;

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ResumeKind" NOT NULL,
    "filename" TEXT,
    "rawText" TEXT NOT NULL,
    "status" "ResumeStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeChunk" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "ResumeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resume_profileId_active_idx" ON "Resume"("profileId", "active");

-- CreateIndex
CREATE INDEX "ResumeChunk_resumeId_index_idx" ON "ResumeChunk"("resumeId", "index");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeChunk" ADD CONSTRAINT "ResumeChunk_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
