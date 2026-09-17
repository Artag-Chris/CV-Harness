-- Dedup de vacantes: URL canónica, clave de contenido y marca de duplicado.
-- Aditiva: el backfill de `canonicalUrl`/`dupKey` lo hace el pase de dedup
-- (reutiliza las mismas funciones TS, para no duplicar la normalización en SQL).

ALTER TABLE "Vacancy" ADD COLUMN "canonicalUrl" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN "dupKey" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN "duplicateOfId" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN "dupDismissed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Vacancy_canonicalUrl_idx" ON "Vacancy"("canonicalUrl");
CREATE INDEX "Vacancy_dupKey_idx" ON "Vacancy"("dupKey");
CREATE INDEX "Vacancy_duplicateOfId_idx" ON "Vacancy"("duplicateOfId");
CREATE INDEX "Vacancy_sourceId_externalId_idx" ON "Vacancy"("sourceId", "externalId");

ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Vacancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
