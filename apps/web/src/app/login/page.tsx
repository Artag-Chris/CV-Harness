'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@cvharness.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push('/vacantes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <h1 className="text-xl font-semibold">CV Harness</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Vacantes → match con IA → hoja de vida
        </p>
        <label className="mt-6 block text-sm font-medium text-zinc-300">Email</label>
        <input
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <label className="mt-4 block text-sm font-medium text-zinc-300">Contraseña</label>
        <input
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <button
          disabled={busy || !password}
          className="mt-6 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy ? 'Entrando…' : 'Ingresar'}
        </button>
        <p className="mt-4 text-xs text-zinc-500">
          Usuario sembrado: {email} / admin1234
        </p>
      </form>
    </main>
  );
}
