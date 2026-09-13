-- Preparación de entrevista por (vacante, perfil): plan de estudio/repaso,
-- preguntas probables y capciosas, checklist. Se genera a pedido cuando la
-- postulación está APPLIED. `content` guarda el plan y el avance del usuario.

CREATE TABLE "InterviewPrep" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'ia',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InterviewPrep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InterviewPrep_vacancyId_profileId_key" ON "InterviewPrep"("vacancyId", "profileId");
CREATE INDEX "InterviewPrep_profileId_idx" ON "InterviewPrep"("profileId");

ALTER TABLE "InterviewPrep" ADD CONSTRAINT "InterviewPrep_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewPrep" ADD CONSTRAINT "InterviewPrep_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
