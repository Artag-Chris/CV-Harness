import { useEffect, useRef, useState } from 'react';

/** Polling simple cada `intervalMs` (patrón del dashboard de atiende). */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const value = await fnRef.current();
        if (alive) {
          setData(value);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    const id = window.setInterval(() => void run(), intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [intervalMs, version]);

  return { data, error, reload: () => setVersion((v) => v + 1) };
}
