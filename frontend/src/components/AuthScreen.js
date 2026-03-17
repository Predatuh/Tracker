import React, { useState } from 'react';
import './AuthScreen.css';
import { useAppContext } from '../context/AppContext';

function AuthScreen() {
  const { continueAsGuest, login, register } = useAppContext();
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [jobToken, setJobToken] = useState('');
  const [guestToken, setGuestToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = { name: name.trim(), pin: pin.trim() };
      if (!payload.name || !payload.pin) {
        throw new Error('Please enter your name and PIN.');
      }
      if (mode === 'register') {
        payload.job_token = jobToken.trim();
        await register(payload);
      } else {
        await login(payload);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || 'Unable to continue.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitGuest = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload = { job_token: guestToken.trim() };
      if (!payload.job_token) {
        throw new Error('Please enter a site token to continue as guest.');
      }
      await continueAsGuest(payload);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || 'Unable to continue as guest.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-screen-glow auth-screen-glow--left" />
      <div className="auth-screen-glow auth-screen-glow--right" />
      <section className="auth-showcase">
        <span className="auth-kicker">Princess Trackers</span>
        <h1>Bring the same tracker-first flow from the app to the desktop and web.</h1>
        <p>
          Sign in with your existing name and 4-digit PIN. The goal of this redesign is to make switching
          between surfaces feel familiar, so the dashboard, tracker selection, and claims workflow stay aligned.
        </p>
        <div className="auth-feature-list">
          <div>
            <strong>Tracker-first dashboard</strong>
            <span>Start from the same tracker hub instead of a separate desktop-only layout.</span>
          </div>
          <div>
            <strong>Shared visual language</strong>
            <span>App-like cards, spacing, labels, and navigation reduce context switching.</span>
          </div>
          <div>
            <strong>Guest visibility</strong>
            <span>Continue in view mode when you only need to check progress.</span>
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign In</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create Account</button>
        </div>
        <div className="auth-heading">
          <span className="auth-badge">♛</span>
          <div>
            <h2>{mode === 'signin' ? 'Welcome back' : 'Set up your tracker access'}</h2>
            <p>{mode === 'signin' ? 'Use the same name and PIN you already use on the team.' : 'Create a regular worker account with a 4-digit PIN.'}</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <label>
            <span>Your Name</span>
            <input
              className="app-input"
              type="text"
              autoComplete="off"
              placeholder="e.g. John Smith"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>4-Digit PIN</span>
            <input
              className="app-input auth-pin-input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              placeholder="••••"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>
          {mode === 'register' && (
            <label>
              <span>Site Token</span>
              <input
                className="app-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Enter your site token"
                value={jobToken}
                onChange={(event) => setJobToken(event.target.value.replace(/\D/g, ''))}
              />
            </label>
          )}
          <button className="app-btn app-btn-primary auth-submit-btn" type="submit" disabled={submitting}>
            {submitting ? 'Working...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <div className="auth-guest-panel">
          <label>
            <span>Guest Site Token</span>
            <input
              className="app-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Enter a site token to view as guest"
              value={guestToken}
              onChange={(event) => setGuestToken(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button className="app-btn app-btn-secondary auth-guest-btn" onClick={submitGuest} disabled={submitting}>
            {submitting ? 'Working...' : 'Continue as guest'}
          </button>
        </div>
        <p className="auth-admin-note">Admin uses the name Admin with the configured admin PIN.</p>
      </section>
    </div>
  );
}

export default AuthScreen;