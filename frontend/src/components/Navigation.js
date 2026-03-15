import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navigation.css';
import { useAppContext } from '../context/AppContext';

function Navigation() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    currentTracker,
    currentTrackerId,
    setCurrentTrackerId,
    currentUser,
    isAdmin,
    hasPermission,
    trackers,
    accessMode,
    logout,
  } = useAppContext();
  const active = (path) => pathname === path ? 'nav-link--active' : '';
  const close = () => setMenuOpen(false);

  const navItems = [
    { to: '/', label: 'Dashboard' },
    { to: '/power-blocks', label: currentTracker?.dashboard_blocks_label || 'Power Blocks' },
    { to: '/site-map', label: 'Map' },
    { to: '/worklog', label: 'Work Log' },
    { to: '/reports', label: 'Reports' },
  ];

  if (hasPermission('upload_pdf')) {
    navItems.splice(1, 0, { to: '/upload', label: 'Upload PDF' });
  }

  if (isAdmin || hasPermission('admin_settings')) {
    navItems.push({ to: '/admin', label: 'Admin' });
  }

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand" onClick={close}>
          <span className="navbar-brand-mark">♛</span>
          <span>
            <strong>Princess</strong> Trackers
          </span>
        </Link>
        <div className="nav-tracker-strip">
          <label className="nav-tracker-label" htmlFor="tracker-select">Tracker</label>
          <select
            id="tracker-select"
            className="nav-tracker-select"
            value={currentTrackerId || ''}
            onChange={(event) => setCurrentTrackerId(event.target.value ? Number(event.target.value) : null)}
          >
            {trackers.map((tracker) => (
              <option key={tracker.id} value={tracker.id}>{tracker.name}</option>
            ))}
          </select>
        </div>
        <button className="nav-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
        </button>
        <ul className={`nav-menu ${menuOpen ? 'nav-menu--open' : ''}`}>
          {navItems.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={active(item.to)} onClick={close}>{item.label}</Link>
            </li>
          ))}
        </ul>
        <div className="nav-user-panel">
          <div className="nav-user-copy">
            <span className="nav-user-mode">{accessMode === 'guest' ? 'Guest view' : 'Signed in'}</span>
            <strong>{currentUser?.name || 'View Only'}</strong>
          </div>
          <button className="nav-logout-btn" onClick={() => { close(); logout(); }}>
            {accessMode === 'guest' ? 'Exit' : 'Log out'}
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;
