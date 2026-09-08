'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearToken, getToken } from '@/lib/api';
import { usePoll } from '@/lib/usePoll';

const NAV = [
  { href: '/vacantes', label: 'Vacantes' },
  { href: '/notificaciones', label: 'Notificaciones' },
  { href: '/perfiles', label: 'Perfiles & CV' },
  { href: '/fuentes', label: 'Fuentes' },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
      {count}
    </span>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  const { data: unread } = usePoll(() => api.get<number>('/notifications/unread-count'), 10000);

  function logout() {
    clearToken();
    router.replace('/login');
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Cargando…
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900/60 p-4">
        <div className="px-2 text-sm font-semibold tracking-wide">
          CV <span className="text-emerald-400">Harness</span>
        </div>
        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm ${
                  active
                    ? 'bg-emerald-600/15 font-medium text-emerald-300'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                {item.label}
                {item.href === '/notificaciones' && (
                  <Badge count={(unread as number | null) ?? 0} />
                )}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="mt-auto rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Salir
        </button>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
