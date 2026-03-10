import React from 'react';
import { Link } from 'react-router-dom';
import './Navigation.css';

function Navigation() {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          🔌 LBD Tracker
        </Link>
        <ul className="nav-menu">
          <li><Link to="/">Dashboard</Link></li>
          <li><Link to="/upload">Upload PDF</Link></li>
          <li><Link to="/power-blocks">Power Blocks</Link></li>
          <li><Link to="/site-map">Site Map</Link></li>
          <li><Link to="/admin">⚙️ Admin</Link></li>
        </ul>
      </div>
    </nav>
  );
}

export default Navigation;
