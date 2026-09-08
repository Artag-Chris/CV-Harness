import type { VacancyStatus } from '@/lib/types';

export const STATUS_LABEL: Record<VacancyStatus | 'ALL', string> = {
  RAW: 'Cruda',
  NORMALIZED: 'Normalizada',
  MATCHED: 'Match',
  RESUME_READY: 'HV lista',
  APPLIED: 'Aplicada',
  IGNORED: 'Ignorada',
  ALL: 'Todas',
};

const STATUS_STYLE: Record<VacancyStatus, string> = {
  RAW: 'bg-zinc-700/40 text-zinc-300',
  NORMALIZED: 'bg-sky-600/20 text-sky-300',
  MATCHED: 'bg-amber-600/20 text-amber-300',
  RESUME_READY: 'bg-emerald-600/20 text-emerald-300',
  APPLIED: 'bg-violet-600/20 text-violet-300',
  IGNORED: 'bg-zinc-800 text-zinc-500',
};

export function StatusBadge({ status }: { status: VacancyStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-zinc-600">—</span>;
  const color =
    score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  return <span className={`text-sm font-bold ${color}`}>{score}</span>;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>
      {children}
    </div>
  );
}
