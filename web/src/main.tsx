import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { takeInvite } from './lib/inviteLink';
import './index.css';

// Before the first render, and deliberately not inside the login page: an invite QR
// carries an event password in the URL fragment, and it has to come out of the
// address bar whether or not a login page appears to consume it. Someone who already
// holds a role never sees one.
takeInvite();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

// The second boundary, and the outer one. `App` has one above its routes, but
// that one sits inside the router and the three providers, so it cannot catch
// what they throw themselves — a failing `MeProvider` fetch, a theme effect, the
// router's own setup — and those failures are exactly the ones that blank the
// whole page rather than one route. Nothing below `createRoot` is unguarded now.
createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
