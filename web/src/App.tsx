import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProposalBoard } from './components/ProposalBoard';
import { ToastProvider } from './components/ui';
import { AdminPage } from './pages/AdminPage';
import { EventListPage } from './pages/EventListPage';
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
          <Route path="/" element={<EventListPage />} />
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
          <Route path="/e/:slug/proposals" element={<ProposalBoard />} />
          <Route path="/e/:slug/p/:personId" element={<ProfilePage />} />
          <Route path="/e/:slug/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
      </MeProvider>
    </BrowserRouter>
  );
}
