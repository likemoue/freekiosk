import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import { Loading } from './ui';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside the signed-in area');
  return me;
}

/** What this person may do: the server decides, this only hides what would be refused */
export function useCan() {
  const me = useMe();
  return { operate: me.role !== 'VIEWER', admin: me.role === 'ADMIN' };
}

export function useSignOut() {
  const client = useQueryClient();
  return async () => {
    await api.post('/api/admin/auth/logout').catch(() => {});
    client.clear();
    window.location.assign('/dang-nhap');
  };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, error, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/admin/auth/me'),
    retry: false,
    staleTime: 60_000,
  });
  if (isLoading) return <Loading />;
  if (error instanceof ApiError && error.status === 401) {
    return <Navigate to="/dang-nhap" replace state={{ from: location.pathname }} />;
  }
  if (!data) return <Navigate to="/dang-nhap" replace />;
  if (data.mustChangePassword && location.pathname !== '/doi-mat-khau') return <Navigate to="/doi-mat-khau" replace />;
  return <MeContext.Provider value={data}>{children}</MeContext.Provider>;
}
