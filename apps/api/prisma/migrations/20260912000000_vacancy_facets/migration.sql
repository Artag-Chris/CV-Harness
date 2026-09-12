-- Facets canónicos de vacante (modalidad y seniority) para filtros confiables.
-- El texto libre (`modality`, `enrichment.modality/seniority`) se conserva para
-- mostrarlo; estos campos son los que filtra el listado.

ALTER TABLE "Vacancy" ADD COLUMN     "seniorityLevel" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN     "modalityTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: deriva los facets del texto ya guardado. Los valores son los mismos
-- que produce `common/job-facets.ts` (se mantienen sincronizados a mano).
UPDATE "Vacancy" AS v
SET
  "modalityTypes" = b.modalities,
  "seniorityLevel" = b.seniority
FROM (
  SELECT
    id,
    array_remove(
      ARRAY[
        CASE WHEN blob ~ 'remot|teletrabajo|home ?office|work from home|wfh' THEN 'REMOTE' END,
        CASE WHEN blob ~ 'h[ií]brid|hybrid|mixt[oa]' THEN 'HYBRID' END,
        CASE WHEN blob ~ 'presencial|on ?site|in ?person' THEN 'ONSITE' END
      ],
      NULL
    ) AS modalities,
    CASE
      WHEN blob ~ 'semi ?senior|semisenior|\mssr\M' THEN 'SEMI_SENIOR'
      WHEN blob ~ '(tech|team) lead|\mlead\M|l[ií]der' THEN 'LEAD'
      WHEN blob ~ '\msenior\M|\msr\M' THEN 'SENIOR'
      WHEN blob ~ '\mjunior\M|\mjr\M' THEN 'JUNIOR'
      WHEN blob ~ 'trainee|intern|practicante|aprendiz|pasante' THEN 'TRAINEE'
    END AS seniority
  FROM (
    SELECT
      id,
      lower(
        coalesce(modality, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(enrichment ->> 'modality', '') || ' ' ||
        coalesce(enrichment ->> 'seniority', '')
      ) AS blob
    FROM "Vacancy"
  ) texts
) AS b
WHERE v.id = b.id;

-- Índices de los filtros nuevos.
CREATE INDEX "Vacancy_seniorityLevel_idx" ON "Vacancy"("seniorityLevel");
CREATE INDEX "Vacancy_modalityTypes_idx" ON "Vacancy" USING GIN ("modalityTypes");
