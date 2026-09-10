import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { takeInvite } from './lib/inviteLink';
import './index.css';

// Before the first render, and deliberately not inside the login page: an invite QR
// carries an event password in the URL fragment, and it has to come out of the
// address bar whether or not a login page appears to consume it. Someone who already
// holds a role never sees one.
takeInvite();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
