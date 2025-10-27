import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export function useAuthGate() {
  const [status, setStatus] = useState<'idle'|'checking'|'authed'|'unauthed'>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        const me = await res.json();
        if (!cancelled) setStatus(me?.authenticated ? 'authed' : 'unauthed');
      } catch {
        if (!cancelled) setStatus('unauthed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { isAuthed: status === 'authed', status };
}