'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import type { NotificationRow } from '@/lib/types';
import { usePoll } from '@/lib/usePoll';

function typeStyle(type: string): string {
  switch (type) {
    case 'RESUME_READY':
      return 'border-emerald-700/60 bg-emerald-950/30';
    case 'MATCH_READY':
      return 'border-amber-700/60 bg-amber-950/20';
    case 'SCRAPE_ERROR':
    case 'SOURCE_ERROR':
      return 'border-red-800 bg-red-950/20';
    default:
      return 'border-zinc-800 bg-zinc-900/50';
  }
}

export default function NotificationsPage() {
  const { data, reload } = usePoll<NotificationRow[]>(
    () => api.get<NotificationRow[]>('/notifications?limit=100'),
    8000,
  );

  async function markRead(id: string) {
    await api.post(`/notifications/${id}/read`, {});
    reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Notificaciones</h1>
        <span className="text-xs text-zinc-500">Se actualizan solas cada 8 s</span>
      </div>
      <div className="flex flex-col gap-2">
        {(data ?? []).map((n) => (
          <div
            key={n.id}
            className={`flex items-start justify-between gap-4 rounded-xl border p-3 ${typeStyle(n.type)} ${
              n.readAt ? 'opacity-60' : ''
            }`}
          >
            <div className="min-w-0">
              <div className="font-medium">{n.title}</div>
              <div className="mt-0.5 text-sm text-zinc-400">{n.body}</div>
              <div className="mt-1 text-xs text-zinc-600">
                {new Date(n.createdAt).toLocaleString('es-CO')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {n.payload.vacancyId && (
                <Link
                  href={`/vacantes/${n.payload.vacancyId}`}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
                >
                  Ver
                </Link>
              )}
              {!n.readAt && (
                <button
                  onClick={() => void markRead(n.id)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Marcar leída
                </button>
              )}
            </div>
          </div>
        ))}
        {data && data.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">
            Sin notificaciones todavía. Cuando haya un match alto vas a ver la HV lista acá.
          </p>
        )}
      </div>
    </div>
  );
}
