'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { SourceRow } from '@/lib/types';
import { usePoll } from '@/lib/usePoll';

export default function SourcesPage() {
  const { data, error, reload } = usePoll<SourceRow[]>(
    () => api.get<SourceRow[]>('/sources'),
    10000,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(source: SourceRow) {
    await api.patch(`/sources/${source.id}`, { enabled: !source.enabled });
    reload();
  }

  async function run(source: SourceRow) {
    setBusyId(source.id);
    setMsg(null);
    try {
      const res = await api.post<{ requestId: string }>(`/sources/${source.id}/run`, {});
      setMsg(`${source.name}: despachado (${res.requestId.slice(0, 8)}…). El scraper lo procesa async.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fuentes de vacantes</h1>
        <span className="text-xs text-zinc-500">El cron despacha las habilitadas y vencidas</span>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {msg && <p className="mb-3 text-sm text-emerald-400">{msg}</p>}

      <div className="flex flex-col gap-2">
        {(data ?? []).map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                <span className="font-medium">{s.name}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">{s.listUrl}</div>
              <div className="mt-1 text-xs text-zinc-600">
                cada {s.intervalMinutes} min · {s._count?.vacancies ?? 0} vacantes ·{' '}
                {s.lastRunAt ? `última corrida ${new Date(s.lastRunAt).toLocaleString('es-CO')}` : 'sin corridas'}
              </div>
            </div>
            <button
              onClick={() => void toggle(s)}
              disabled={busyId === s.id}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                s.enabled
                  ? 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {s.enabled ? 'Deshabilitar' : 'Habilitar'}
            </button>
            <button
              onClick={() => void run(s)}
              disabled={busyId === s.id || !s.enabled}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              {busyId === s.id ? '…' : 'Correr ahora'}
            </button>
          </div>
        ))}
        {data && data.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">
            No hay fuentes. Creá una por API (POST /api/sources) con su receta de selectores.
          </p>
        )}
      </div>
    </div>
  );
}
