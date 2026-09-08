'use client';

import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import type { ProfileRow, SourceRow, SourceTemplate } from '@/lib/types';
import { usePoll } from '@/lib/usePoll';

export default function SourcesPage() {
  const { data, error, reload } = usePoll<SourceRow[]>(
    () => api.get<SourceRow[]>('/sources'),
    10000,
  );
  const { data: templates } = usePoll<SourceTemplate[]>(
    () => api.get<SourceTemplate[]>('/sources/templates'),
    60000,
  );
  const { data: profiles } = usePoll<ProfileRow[]>(() => api.get<ProfileRow[]>('/profiles'), 60000);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [listUrl, setListUrl] = useState('');
  const [profileId, setProfileId] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('1440');

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

  async function createSource(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !listUrl.trim() || !templateId) return;
    try {
      const created = await api.post<SourceRow>('/sources', {
        name: name.trim(),
        templateId,
        listUrl: listUrl.trim(),
        profileId: profileId || null,
        intervalMinutes: Math.max(5, Number(intervalMinutes) || 1440),
      });
      setMsg(`Fuente creada: ${created.name}. Despachala o esperá el cron.`);
      setName('');
      setListUrl('');
      reload();
      setShowForm(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Fuentes de vacantes</h1>
          <span className="text-xs text-zinc-500">
            Plantilla + URL del listado · el cron despacha las habilitadas y vencidas
          </span>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
        >
          {showForm ? 'Cerrar' : '+ Nueva fuente'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={createSource}
          className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (ej. Computrabajo React)"
            required
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          >
            <option value="">Plantilla…</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            value={listUrl}
            onChange={(e) => setListUrl(e.target.value)}
            placeholder="URL del listado (la que scrapea el cron)"
            required
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500 sm:col-span-2"
          />
          {templates?.find((t) => t.id === templateId) && (
            <p className="text-xs text-zinc-500 sm:col-span-2">
              {templates.find((t) => t.id === templateId)?.hint}
            </p>
          )}
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          >
            <option value="">Perfil (compartida)</option>
            {(profiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={5}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            placeholder="Intervalo (min)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium sm:col-span-2">
            Crear fuente
          </button>
        </form>
      )}

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
                {s.profile && (
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {s.profile.name}
                  </span>
                )}
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
            No hay fuentes. Creá una con «+ Nueva fuente».
          </p>
        )}
      </div>
    </div>
  );
}
