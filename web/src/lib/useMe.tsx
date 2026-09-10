import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Me } from '@shared/types';
import { api } from './api';

interface MeApi {
  me: Me | null;
  setMe: (me: Me) => void;
  refresh: () => Promise<void>;
}

const MeContext = createContext<MeApi>({
  me: null,
  setMe: () => {},
  refresh: async () => {},
});

/**
 * The anonymous browser identity (SPEC §3.1). Held in context rather than
 * fetched per component: the cookie is minted server-side on first contact, so
 * a second caller would mean a second `/me` round trip for the same answer.
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      // A failed /me is not fatal — the login page will surface the real problem.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, setMe, refresh }), [me, refresh]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export const useMe = (): MeApi => useContext(MeContext);
