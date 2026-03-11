import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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

function App() {
  return (
    <Router>
      <div className="App">
        <Navigation />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<PDFUpload />} />
            <Route path="/power-blocks" element={<PowerBlockList />} />
            <Route path="/power-block/:id" element={<PowerBlockDetail />} />
            <Route path="/site-map" element={<SiteMapView />} />
            <Route path="/worklog" element={<WorkLog />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={<AdminPanel />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
