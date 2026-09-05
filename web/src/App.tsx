import { type ComponentType, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConfirmProvider, Spinner, ToastProvider } from './components/ui';
import { MeProvider } from './lib/useMe';
import { useFollowSystemTheme } from './lib/useTheme';

/**
 * Every route is a separate chunk. The app used to ship as one file, so a
 * viewer opening the schedule downloaded the admin pages, every modal and the
 * whole component library before the grid could paint — slow on the venue wifi
 * this is used on. Now first paint pulls only the shell plus the one route asked
 * for; admin, search, the board and the rest arrive when navigated to.
 *
 * The components are named exports, so each import maps its name onto `default`
 * for `React.lazy`.
 */
const named = <T extends string>(
  loader: () => Promise<Record<T, ComponentType<object>>>,
  name: T,
) => lazy(() => loader().then((m) => ({ default: m[name] })));

const LandingPage = named(() => import('./pages/LandingPage'), 'LandingPage');
const EventListPage = named(() => import('./pages/EventListPage'), 'EventListPage');
const NewEventPage = named(() => import('./pages/NewEventPage'), 'NewEventPage');
const ImportPage = named(() => import('./pages/ImportPage'), 'ImportPage');
const SchedulePage = named(() => import('./pages/SchedulePage'), 'SchedulePage');
const SearchPage = named(() => import('./pages/SearchPage'), 'SearchPage');
const AgendaPage = named(() => import('./pages/AgendaPage'), 'AgendaPage');
const ProposalBoard = named(() => import('./components/ProposalBoard'), 'ProposalBoard');
const ProfilePage = named(() => import('./pages/ProfilePage'), 'ProfilePage');
const AdminPage = named(() => import('./pages/AdminPage'), 'AdminPage');

export function App() {
  // Always mounted, so a sunset (or another tab's toggle) reaches every page.
  useFollowSystemTheme();
  return (
    <BrowserRouter>
      <MeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Suspense fallback={<Spinner />}>
              <Routes>
                {/* `/` says what this is; the list of every event on the instance
                    is a page you choose to open, not the front door. A public box
                    published its whole event list to anyone who loaded the root. */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/events" element={<EventListPage />} />
                <Route path="/new" element={<NewEventPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/e/:slug" element={<SchedulePage />} />
                {/* Session detail is deep-linkable and renders over the schedule. */}
                <Route path="/e/:slug/s/:sessionId" element={<SchedulePage />} />
                {/* The same page: it holds every handler the detail needs, and
                    renders the session full-width instead of as a panel. */}
                <Route path="/e/:slug/s/:sessionId/full" element={<SchedulePage />} />
                {/* Search spans the whole programme, so it is its own page rather
                    than something the day-scoped schedule can show. */}
                <Route path="/e/:slug/search" element={<SearchPage />} />
                {/* Your starred sessions, the whole event at once. A page rather
                    than a panel for the same reason search is one: it spans every
                    day, and the schedule is day-scoped by construction. */}
                <Route path="/e/:slug/agenda" element={<AgendaPage />} />
                <Route path="/e/:slug/proposals" element={<ProposalBoard />} />
                <Route path="/e/:slug/p/:personId" element={<ProfilePage />} />
                <Route path="/e/:slug/admin" element={<AdminPage />} />
                {/* Home is `/`, the same place the logo goes, and a URL that no
                    longer resolves is most often a stale or mistyped event link —
                    answered better by the page that explains what to do with an
                    event link than by a list of events that are not yours. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ConfirmProvider>
        </ToastProvider>
      </MeProvider>
    </BrowserRouter>
  );
}
