'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { VacancyListRow, VacancyStatus } from '@/lib/types';
import { usePoll } from '@/lib/usePoll';
import { ScoreBadge, StatusBadge } from '@/lib/ui';

interface ListResponse {
  rows: VacancyListRow[];
  total: number;
}

export default function VacanciesPage() {
  const [status, setStatus] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ status });
  if (q.trim()) query.set('q', q.trim());

  const { data, error, reload } = usePoll<ListResponse>(
    () => api.get<ListResponse>(`/vacancies?${query.toString()}`),
    15000,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Vacantes</h1>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            reload();
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="ALL">Todas</option>
          <option value="RAW">Crudas</option>
          <option value="NORMALIZED">Normalizadas</option>
          <option value="MATCHED">Con match</option>
          <option value="RESUME_READY">HV lista</option>
          <option value="APPLIED">Aplicadas</option>
          <option value="IGNORED">Ignoradas</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reload()}
          placeholder="Buscar…"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
        />
        <span className="text-xs text-zinc-500">{data?.total ?? 0} resultados</span>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-2">
        {(data?.rows ?? []).map((v) => (
          <Link
            key={v.id}
            href={`/vacantes/${v.id}`}
            className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 hover:border-emerald-700"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{v.title}</div>
              <div className="truncate text-sm text-zinc-500">
                {[v.company, v.location, v.salary].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="hidden w-40 truncate text-right text-xs text-zinc-600 sm:block">
              {v.source.name}
            </div>
            <StatusBadge status={v.status as VacancyStatus} />
            <div className="w-10 text-right">
              <ScoreBadge score={v.matchScore} />
            </div>
          </Link>
        ))}
        {data && data.rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">
            Sin vacantes con este filtro. Dispará una fuente en «Fuentes» o esperá el cron.
          </p>
        )}
      </div>
    </div>
  );
}
