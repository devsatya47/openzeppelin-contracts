import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Landing page after Google/Facebook sign-in: stores the session from the URL fragment, then moves on. */
export default function AuthComplete() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    const next = params.get('next') ?? '/gallery';
    // Remove the token from the address bar and browser history straight away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) return void navigate('/login?error=' + encodeURIComponent('Sign-in did not complete. Please try again.'), { replace: true });
    tokenStore.set(token);
    refresh().then(() => navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/gallery', { replace: true }));
  }, [navigate, refresh]);

  return <Spinner label="Signing you in" />;
}
