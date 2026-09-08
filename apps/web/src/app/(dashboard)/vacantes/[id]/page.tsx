'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { VacancyDetail } from '@/lib/types';
import { Card, ScoreBadge, StatusBadge } from '@/lib/ui';

function ListBlock({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-zinc-300">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-emerald-400">{title}</h2>
      {children}
    </Card>
  );
}

export default function VacancyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [vacancy, setVacancy] = useState<VacancyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api
      .get<VacancyDetail>(`/vacancies/${id}`)
      .then((v) => {
        setVacancy(v);
        setSummaryDraft((v.resume?.content.summary as string) ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!vacancy) return <p className="text-zinc-500">Cargando vacante…</p>;
  const current = vacancy;

  const enr = current.enrichment ?? {};
  const applyUrl = (current.raw as { applyUrl?: string }).applyUrl ?? current.url;

  async function setStatus(status: 'APPLIED' | 'IGNORED') {
    await api.post(`/vacancies/${current.id}/status`, { status });
    const v = await api.get<VacancyDetail>(`/vacancies/${current.id}`);
    setVacancy(v);
  }

  async function saveResumeSummary() {
    if (!current.resume) return;
    const content = { ...current.resume.content, summary: summaryDraft };
    await api.patch(`/resumes/${current.resume.id}`, { content });
    const v = await api.get<VacancyDetail>(`/vacancies/${current.id}`);
    setVacancy(v);
  }

  function copyMarkdown() {
    const md = (current.resume?.content as { markdown?: string }).markdown;
    if (!md) return;
    void navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/vacantes" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Vacantes
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{current.title}</h1>
        <StatusBadge status={current.status} />
        <ScoreBadge score={current.matchScore} />
      </div>
      <p className="text-sm text-zinc-500">
        {[current.company, current.location, current.salary, current.modality]
          .filter(Boolean)
          .join(' · ') || '—'}{' '}
        <span className="text-zinc-700">· {current.source.name}</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={applyUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
        >
          Aplicar ↗
        </a>
        {current.status !== 'APPLIED' && (
          <button
            onClick={() => void setStatus('APPLIED')}
            className="rounded-lg border border-violet-600 px-3 py-1.5 text-sm hover:bg-violet-600/20"
          >
            Marcar aplicada
          </button>
        )}
        {current.status !== 'IGNORED' && (
          <button
            onClick={() => void setStatus('IGNORED')}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            Ignorar
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <Section title="Vacante (enriquecida)">
            <div className="space-y-3">
              {enr.summary && <p className="text-sm text-zinc-300">{enr.summary}</p>}
              {enr.seniority && (
                <p className="text-xs text-zinc-500">Seniority: {enr.seniority}</p>
              )}
              <ListBlock title="Requisitos clave" items={enr.keyRequirements} />
              <ListBlock title="Deseables" items={enr.niceToHave} />
              <ListBlock title="Skills detectadas" items={enr.skills} />
            </div>
          </Section>
          <Section title="Descripción original">
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-400">
              {current.descriptionRaw.slice(0, 4000)}
            </pre>
          </Section>
        </div>

        <div>
          {current.match && (
            <>
              <Section title={`Match ${current.match.score}/100 · ${current.match.verdict}`}>
                <ListBlock title="Razones" items={current.match.reasons} />
                <div className="mt-3">
                  <ListBlock title="Brechas" items={current.match.gaps} />
                </div>
                <div className="mt-3 border-t border-zinc-800 pt-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Ángulo
                  </div>
                  <p className="mt-1 text-zinc-300">{current.match.applicationStrategy.angle}</p>
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Canal sugerido
                  </div>
                  <p className="mt-1 text-zinc-300">
                    {current.match.applicationStrategy.suggestedChannel}
                  </p>
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Keywords ATS
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {(current.match.applicationStrategy.keywords ?? []).join(', ')}
                  </p>
                </div>
                {current.match.coverLetterDraft && (
                  <div className="mt-3 border-t border-zinc-800 pt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Carta de presentación
                    </div>
                    <p className="mt-1 text-sm italic text-zinc-300">
                      {current.match.coverLetterDraft}
                    </p>
                  </div>
                )}
              </Section>
            </>
          )}

          {current.resume ? (
            <Section title={`Borrador de HV · v${current.resume.version}`}>
              <div className="mb-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Resumen (editable)
                </label>
                <textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => void saveResumeSummary()}
                  className="mt-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-500"
                >
                  Guardar resumen
                </button>
                <button
                  onClick={copyMarkdown}
                  className="ml-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  {copied ? '¡Copiado!' : 'Copiar markdown'}
                </button>
              </div>
              <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 font-sans text-xs leading-relaxed text-zinc-300">
                {(current.resume.content as { markdown?: string }).markdown ?? ''}
              </pre>
            </Section>
          ) : (
            current.matchScore !== null &&
            current.matchScore < 65 && (
              <Section title="Sin HV">
                <p className="text-sm text-zinc-400">
                  El score ({current.matchScore}/100) no supera el umbral de 65, así que no se
                  generó borrador. Podés aplicar igual con la fórmula de la izquierda.
                </p>
              </Section>
            )
          )}
        </div>
      </div>
    </div>
  );
}
