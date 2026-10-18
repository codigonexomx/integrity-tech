import { useEffect, useRef, useState } from 'react';

export function useSecureTimer({ initialServerTimeMs, endTimeMs, onTimeUp, enabled = true }: {
  initialServerTimeMs: number; endTimeMs: number; onTimeUp: () => void; enabled?: boolean;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const callback = useRef(onTimeUp);
  useEffect(() => { callback.current = onTimeUp; }, [onTimeUp]);
  useEffect(() => {
    if (!enabled || !endTimeMs || !initialServerTimeMs) return;
    const start = performance.now();
    let notified = false;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((endTimeMs - initialServerTimeMs - (performance.now() - start)) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0 && !notified) { notified = true; callback.current(); }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [initialServerTimeMs, endTimeMs, enabled]);
  const seconds = remainingSeconds ?? 0;
  return { remainingSeconds: seconds, formattedTime: remainingSeconds === null ? '—' : [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':'), isExpired: remainingSeconds === 0 };
}
