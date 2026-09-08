'use client';

import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import type { ProfileRow, ResumeRow } from '@/lib/types';
import { usePoll } from '@/lib/usePoll';
import { Card } from '@/lib/ui';

const RESUME_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pendiente', cls: 'bg-zinc-700/40 text-zinc-300' },
  EMBEDDING: { label: 'Indexando…', cls: 'bg-sky-600/20 text-sky-300' },
  READY: { label: 'Lista (vectores)', cls: 'bg-emerald-600/20 text-emerald-300' },
  FAILED: { label: 'Error', cls: 'bg-red-600/20 text-red-300' },
};

function statusBadge(status: string) {
  const s = RESUME_STATUS[status] ?? RESUME_STATUS.PENDING;
  return <span className={`rounded-full px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>;
}

export default function ProfilesPage() {
  const { data: profiles, reload } = usePoll<ProfileRow[]>(
    () => api.get<ProfileRow[]>('/profiles'),
    10000,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Estado del upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pasteName, setPasteName] = useState('');
  const [pasteContent, setPasteContent] = useState('');

  const profile = profiles?.find((p) => p.id === selectedId) ?? profiles?.[0] ?? null;
  const { data: resumes, reload: reloadResumes } = usePoll<ResumeRow[]>(
    () => (profile ? api.get<ResumeRow[]>(`/resumes?profileId=${profile.id}`) : Promise.resolve([])),
    profile ? 5000 : 60000,
    [profile?.id],
  );

  async function saveSchedule() {
    if (!profile) return;
    setBusy(true);
    setMsg(null);
    try {
      const minutes = schedule.trim() ? Math.max(5, Number(schedule)) : null;
      if (minutes === null || Number.isFinite(minutes)) {
        await api.patch(`/profiles/${profile.id}/schedule`, { scheduleMinutes: minutes });
        setMsg(minutes ? `Cron del perfil: cada ${minutes} min.` : 'Cron del perfil desactivado.');
        reload();
      } else {
        setMsg('Ingresá un número en minutos (o vacío para desactivar).');
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runProfile() {
    if (!profile) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ dispatched: number }>(`/profiles/${profile.id}/run`, {});
      setMsg(`Búsqueda despachada: ${res.dispatched} fuente(s). El pipeline corre async.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitPdf(e: FormEvent) {
    e.preventDefault();
    if (!profile || !uploadFile) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      form.append('profileId', profile.id);
      const created = await api.upload<{ id: string }>('/resumes/upload', form);
      setMsg(`PDF "${uploadFile.name}" recibido — indexando (${created.id.slice(0, 8)}…)`);
      setUploadFile(null);
      reloadResumes();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitText(e: FormEvent) {
    e.preventDefault();
    if (!profile || !pasteContent.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const created = await api.post<{ id: string }>('/resumes/text', {
        profileId: profile.id,
        name: pasteName,
        content: pasteContent,
      });
      setMsg(`Texto guardado — indexando (${created.id.slice(0, 8)}…)`);
      setPasteContent('');
      setPasteName('');
      reloadResumes();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function activate(resumeId: string) {
    if (!profile) return;
    await api.post(`/resumes/${resumeId}/activate`, { profileId: profile.id });
    reloadResumes();
  }

  async function removeResume(resumeId: string) {
    if (!profile) return;
    await api.del(`/resumes/${resumeId}?profileId=${profile.id}`);
    reloadResumes();
  }

  if (!profiles || profiles.length === 0) {
    return <p className="text-zinc-500">Sin perfiles (corré el seed).</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-lg font-semibold">Perfiles & Hojas de vida</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Cada perfil tiene su cron, sus fuentes y su HV activa en pgvector para el match semántico.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSelectedId(p.id);
              setMsg(null);
            }}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              profile?.id === p.id
                ? 'border-emerald-600 bg-emerald-600/15 text-emerald-300'
                : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {p.name}
            {p.isPrimary && ' ★'}
          </button>
        ))}
      </div>

      {profile && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-emerald-400">Cron del perfil</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={5}
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder={
                    profile.scheduleMinutes ? String(profile.scheduleMinutes) : 'minutos (vacío = off)'
                  }
                  className="w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => void saveSchedule()}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  Guardar cadencia
                </button>
                <button
                  onClick={() => void runProfile()}
                  disabled={busy}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Buscar ahora
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {profile.scheduleMinutes
                  ? `Activo: cada ${profile.scheduleMinutes} min · próximo ${profile.nextRunAt ? new Date(profile.nextRunAt).toLocaleString('es-CO') : '—'}`
                  : 'Inactivo: solo corre cuando sus fuentes vencen o con «Buscar ahora».'}
                {' · '}
                {profile._count.sources} fuente(s) · {profile._count.skills} skills
              </p>
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-emerald-400">Subir hoja de vida</h2>
              <form onSubmit={submitPdf} className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-zinc-400 file:mr-2 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:text-zinc-200"
                />
                <button
                  disabled={!uploadFile || busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  Indexar PDF
                </button>
              </form>
              <div className="my-3 border-t border-zinc-800" />
              <form onSubmit={submitText} className="space-y-2">
                <input
                  value={pasteName}
                  onChange={(e) => setPasteName(e.target.value)}
                  placeholder="Nombre (opcional)"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                />
                <textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="O pegá tu hoja de vida en texto / markdown…"
                  rows={6}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500"
                />
                <button
                  disabled={!pasteContent.trim() || busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  Indexar texto
                </button>
              </form>
              <p className="mt-2 text-xs text-zinc-500">
                {msg ?? 'La IA genera los vectores y los guarda en pgvector.'}
              </p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-emerald-400">
              Hojas de vida de {profile.name}
            </h2>
            <div className="flex flex-col gap-2">
              {(resumes ?? []).map((r) => (
                <div
                  key={r.id}
                  className={`rounded-lg border p-3 ${
                    r.active ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {r.name}
                        {r.active && <span className="ml-2 text-xs text-emerald-400">● activa</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {r.kind} · {r.chunkCount} chunks ·{' '}
                        {new Date(r.createdAt).toLocaleDateString('es-CO')}
                      </div>
                      {r.error && <div className="mt-1 text-xs text-red-400">{r.error}</div>}
                    </div>
                    {statusBadge(r.status)}
                    <div className="flex shrink-0 gap-1">
                      {!r.active && r.status === 'READY' && (
                        <button
                          onClick={() => void activate(r.id)}
                          className="rounded-lg bg-emerald-600 px-2 py-1 text-xs"
                        >
                          Activar
                        </button>
                      )}
                      <button
                        onClick={() => void removeResume(r.id)}
                        className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                      >
                        Borrar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {resumes && resumes.length === 0 && (
                <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-600">
                  Todavía no cargaste una HV para este perfil.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {msg && profile && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
    </div>
  );
}
