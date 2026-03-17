import React from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import Navigation from './components/Navigation';
import PDFUpload from './components/PDFUpload';
import PowerBlockList from './components/PowerBlockList';
import PowerBlockDetail from './components/PowerBlockDetail';
import SiteMapView from './components/SiteMapView';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import WorkLog from './components/WorkLog';
import Reports from './components/Reports';
import AuthScreen from './components/AuthScreen';
import IfcViewer from './components/IfcViewer';
import { AppProvider, useAppContext } from './context/AppContext';

function AppBoot() {
  const { booting, canAccessApp, currentUser, isAdmin, hasPermission } = useAppContext();

  if (booting) {
    return (
      <div className="app-boot-screen">
        <div className="app-boot-mark">Princess Trackers</div>
        <div className="app-boot-copy">Loading your trackers and session...</div>
      </div>
    );
  }

  if (!canAccessApp) {
    return <AuthScreen />;
  }

  return (
    <div className="app-shell">
      <Navigation />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/power-blocks" element={<PowerBlockList />} />
          <Route path="/power-block/:id" element={<PowerBlockDetail />} />
          <Route path="/site-map" element={<SiteMapView />} />
          <Route path="/worklog" element={<WorkLog />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/ifc/:id" element={<IfcViewer />} />
          <Route
            path="/upload"
            element={hasPermission('upload_pdf') ? <PDFUpload /> : <Navigate to="/" replace />}
          />
          <Route
            path="/admin"
            element={isAdmin || hasPermission('admin_settings') ? <AdminPanel /> : <Navigate to="/" replace />}
          />
        </Routes>
      </main>
      {currentUser ? <div className="app-shell-user-badge">Signed in as {currentUser.name}</div> : null}
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <Router>
        <AppBoot />
      </Router>
    </AppProvider>
  );
}

export default App;
