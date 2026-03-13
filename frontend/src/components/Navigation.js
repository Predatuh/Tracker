import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navigation.css';

function Navigation() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = (path) => pathname === path ? 'nav-link--active' : '';
  const close = () => setMenuOpen(false);
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand" onClick={close}>
          ♛ Princess Trackers
        </Link>
        <button className="nav-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
        </button>
        <ul className={`nav-menu ${menuOpen ? 'nav-menu--open' : ''}`}>
          <li><Link to="/" className={active('/')} onClick={close}>Dashboard</Link></li>
          <li><Link to="/upload" className={active('/upload')} onClick={close}>Upload PDF</Link></li>
          <li><Link to="/power-blocks" className={active('/power-blocks')} onClick={close}>Power Blocks</Link></li>
          <li><Link to="/site-map" className={active('/site-map')} onClick={close}>Site Map</Link></li>
          <li><Link to="/worklog" className={active('/worklog')} onClick={close}>Work Log</Link></li>
          <li><Link to="/reports" className={active('/reports')} onClick={close}>Reports</Link></li>
          <li><Link to="/admin" className={active('/admin')} onClick={close}>Admin</Link></li>
        </ul>
      </div>
    </nav>
  );
}

export default Navigation;
