import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navigation.css';

function Navigation() {
  const { pathname } = useLocation();
  const active = (path) => pathname === path ? 'nav-link--active' : '';
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          🔌 LBD Tracker
        </Link>
        <ul className="nav-menu">
          <li><Link to="/" className={active('/')}>Dashboard</Link></li>
          <li><Link to="/upload" className={active('/upload')}>Upload PDF</Link></li>
          <li><Link to="/power-blocks" className={active('/power-blocks')}>Power Blocks</Link></li>
          <li><Link to="/site-map" className={active('/site-map')}>Site Map</Link></li>
          <li><Link to="/worklog" className={active('/worklog')}>📋 Work Log</Link></li>
          <li><Link to="/reports" className={active('/reports')}>📊 Reports</Link></li>
          <li><Link to="/admin" className={active('/admin')}>⚙️ Admin</Link></li>
        </ul>
      </div>
    </nav>
  );
}

export default Navigation;
