-- N:M: sitios reutilizables por perfil (ProfileSource) + vacante↔perfil
-- (VacancyProfile) + MatchResult/ResumeDraft compuestos por perfil.
-- Backfill ordenado: primero se leen los datos viejos, después se dropea la
-- columna Source.profileId.

-- 1) Enum + tablas nuevas + uniques (necesarios para los ON CONFLICT del backfill)
CREATE TYPE "VacancyProfileStatus" AS ENUM ('PENDING', 'MATCHED', 'RESUME_READY', 'APPLIED', 'IGNORED');

CREATE TABLE "ProfileSource" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProfileSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VacancyProfile" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" "VacancyProfileStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VacancyProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileSource_profileId_sourceId_key" ON "ProfileSource"("profileId", "sourceId");
CREATE UNIQUE INDEX "VacancyProfile_vacancyId_profileId_key" ON "VacancyProfile"("vacancyId", "profileId");

-- 2) MatchResult → por perfil (la columna profileId empieza nullable para backfill)
ALTER TABLE "MatchResult" DROP CONSTRAINT IF EXISTS "MatchResult_vacancyId_key";
DROP INDEX IF EXISTS "MatchResult_vacancyId_key";
ALTER TABLE "MatchResult" ADD COLUMN "profileId" TEXT;

UPDATE "MatchResult" AS m
SET "profileId" = COALESCE(
    v."profileId",
    (SELECT p.id FROM "Profile" p WHERE p."isPrimary" IS TRUE LIMIT 1)
)
FROM "Vacancy" v
WHERE v.id = m."vacancyId";

ALTER TABLE "MatchResult" ALTER COLUMN "profileId" SET NOT NULL;

-- 3) ResumeDraft → unique compuesto
ALTER TABLE "ResumeDraft" DROP CONSTRAINT IF EXISTS "ResumeDraft_vacancyId_key";
DROP INDEX IF EXISTS "ResumeDraft_vacancyId_key";

-- 4) Backfill de selecciones perfil↔sitio desde la columna vieja Source.profileId
INSERT INTO "ProfileSource" ("id", "profileId", "sourceId", "enabled", "createdAt", "updatedAt")
SELECT md5(s.id || s."profileId"), s."profileId", s.id, true, now(), now()
FROM "Source" s
WHERE s."profileId" IS NOT NULL
ON CONFLICT ("profileId", "sourceId") DO NOTHING;

-- 5) Source queda como sitio reutilizable (sin dueño único)
ALTER TABLE "Source" DROP CONSTRAINT IF EXISTS "Source_profileId_fkey";
ALTER TABLE "Source" DROP COLUMN IF EXISTS "profileId";

-- 6) Backfill de VacancyProfile: cada vacante queda ligada a sus perfiles
-- (dueño histórico + perfiles con match/resume) con su estado derivado.
WITH candidates AS (
    SELECT v.id AS vacancy_id,
           COALESCE(v."profileId", (SELECT p.id FROM "Profile" p WHERE p."isPrimary" IS TRUE LIMIT 1)) AS profile_id
    FROM "Vacancy" v
    UNION
    SELECT m."vacancyId", m."profileId" FROM "MatchResult" m
    UNION
    SELECT d."vacancyId", d."profileId" FROM "ResumeDraft" d
)
INSERT INTO "VacancyProfile" ("id", "vacancyId", "profileId", "status", "appliedAt", "createdAt", "updatedAt")
SELECT md5(c.vacancy_id || c.profile_id),
       c.vacancy_id,
       c.profile_id,
       CASE
         WHEN v.status = 'APPLIED' THEN 'APPLIED'::"VacancyProfileStatus"
         WHEN v.status = 'IGNORED' THEN 'IGNORED'::"VacancyProfileStatus"
         WHEN EXISTS (SELECT 1 FROM "ResumeDraft" d WHERE d."vacancyId" = c.vacancy_id AND d."profileId" = c.profile_id) THEN 'RESUME_READY'::"VacancyProfileStatus"
         WHEN EXISTS (SELECT 1 FROM "MatchResult" m WHERE m."vacancyId" = c.vacancy_id AND m."profileId" = c.profile_id) THEN 'MATCHED'::"VacancyProfileStatus"
         ELSE 'PENDING'::"VacancyProfileStatus"
       END,
       CASE WHEN v.status = 'APPLIED' THEN v."appliedAt" ELSE NULL END,
       now(), now()
FROM candidates c
JOIN "Vacancy" v ON v.id = c.vacancy_id
ON CONFLICT ("vacancyId", "profileId") DO NOTHING;

-- 7) Índices nuevos (los uniques ya se crearon en la sección 1)
CREATE INDEX "ProfileSource_sourceId_enabled_idx" ON "ProfileSource"("sourceId", "enabled");
CREATE INDEX "VacancyProfile_profileId_status_idx" ON "VacancyProfile"("profileId", "status");
CREATE INDEX "VacancyProfile_vacancyId_status_idx" ON "VacancyProfile"("vacancyId", "status");
CREATE INDEX "MatchResult_profileId_idx" ON "MatchResult"("profileId");
CREATE UNIQUE INDEX "MatchResult_vacancyId_profileId_key" ON "MatchResult"("vacancyId", "profileId");
CREATE UNIQUE INDEX "ResumeDraft_vacancyId_profileId_key" ON "ResumeDraft"("vacancyId", "profileId");

-- 8) Foreign keys (condicionales: algunas ya existen desde la migración init)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProfileSource_profileId_fkey') THEN
    ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProfileSource_sourceId_fkey') THEN
    ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VacancyProfile_vacancyId_fkey') THEN
    ALTER TABLE "VacancyProfile" ADD CONSTRAINT "VacancyProfile_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VacancyProfile_profileId_fkey') THEN
    ALTER TABLE "VacancyProfile" ADD CONSTRAINT "VacancyProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MatchResult_profileId_fkey') THEN
    ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
