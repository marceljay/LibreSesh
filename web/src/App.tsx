import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProposalBoard } from './components/ProposalBoard';
import { ToastProvider } from './components/ui';
import { AdminPage } from './pages/AdminPage';
import { AgendaPage } from './pages/AgendaPage';
import { EventListPage } from './pages/EventListPage';
import { LandingPage } from './pages/LandingPage';
import { NewEventPage } from './pages/NewEventPage';
import { ImportPage } from './pages/ImportPage';
import { ProfilePage } from './pages/ProfilePage';
import { SchedulePage } from './pages/SchedulePage';
import { SearchPage } from './pages/SearchPage';
import { MeProvider } from './lib/useMe';

export function App() {
  return (
    <BrowserRouter>
      <MeProvider>
      <ToastProvider>
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
      </ToastProvider>
      </MeProvider>
    </BrowserRouter>
  );
}
