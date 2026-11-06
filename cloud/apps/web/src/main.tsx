import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ApiError } from './api';
import { RequireAuth } from './auth';
import { AppShell } from './layout';
import './styles.css';
import { ConfirmProvider, Loading } from './ui';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const Overview = lazy(() => import('./pages/Overview'));
const Devices = lazy(() => import('./pages/Devices'));
const DeviceDetail = lazy(() => import('./pages/DeviceDetail'));
const DeviceMap = lazy(() => import('./pages/DeviceMap'));
const Enroll = lazy(() => import('./pages/Enroll'));
const Groups = lazy(() => import('./pages/Groups'));
const Commands = lazy(() => import('./pages/Commands'));
const Scheduler = lazy(() => import('./pages/Scheduler'));
const Signage = lazy(() => import('./pages/Signage'));
const PlaylistDetail = lazy(() => import('./pages/PlaylistDetail'));
const Profiles = lazy(() => import('./pages/Profiles'));
const Apps = lazy(() => import('./pages/Apps'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const Screenshots = lazy(() => import('./pages/Screenshots'));
const Alerts = lazy(() => import('./pages/Alerts'));
const GettingStarted = lazy(() => import('./pages/GettingStarted'));
const Settings = lazy(() => import('./pages/Settings'));

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      // A session that ended while a page was open
      if (error instanceof ApiError && error.status === 401 && window.location.pathname.startsWith('/quan-ly')) {
        window.location.assign('/dang-nhap');
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/dang-nhap" element={<Login />} />
              <Route path="/doi-mat-khau" element={<RequireAuth><ChangePassword /></RequireAuth>} />
              <Route path="/quan-ly" element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<Suspense fallback={<Loading />}><Overview /></Suspense>} />
                <Route path="thiet-bi" element={<Suspense fallback={<Loading />}><Devices /></Suspense>} />
                <Route path="thiet-bi/them" element={<Suspense fallback={<Loading />}><Enroll /></Suspense>} />
                <Route path="thiet-bi/:id" element={<Suspense fallback={<Loading />}><DeviceDetail /></Suspense>} />
                <Route path="ban-do" element={<Suspense fallback={<Loading />}><DeviceMap /></Suspense>} />
                <Route path="nhom" element={<Suspense fallback={<Loading />}><Groups /></Suspense>} />
                <Route path="lenh" element={<Suspense fallback={<Loading />}><Commands /></Suspense>} />
                <Route path="lich" element={<Suspense fallback={<Loading />}><Scheduler /></Suspense>} />
                <Route path="bang-hieu" element={<Suspense fallback={<Loading />}><Signage /></Suspense>} />
                <Route path="bang-hieu/:id" element={<Suspense fallback={<Loading />}><PlaylistDetail /></Suspense>} />
                <Route path="ho-so" element={<Suspense fallback={<Loading />}><Profiles /></Suspense>} />
                <Route path="ung-dung" element={<Suspense fallback={<Loading />}><Apps /></Suspense>} />
                <Route path="nhat-ky" element={<Suspense fallback={<Loading />}><ActivityLog /></Suspense>} />
                <Route path="anh-man-hinh" element={<Suspense fallback={<Loading />}><Screenshots /></Suspense>} />
                <Route path="canh-bao" element={<Suspense fallback={<Loading />}><Alerts /></Suspense>} />
                <Route path="bat-dau" element={<Suspense fallback={<Loading />}><GettingStarted /></Suspense>} />
                <Route path="cai-dat" element={<Suspense fallback={<Loading />}><Settings /></Suspense>} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster richColors position="top-right" closeButton />
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
