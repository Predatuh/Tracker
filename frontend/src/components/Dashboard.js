import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { tracker_api } from '../api/apiClient';
import './Dashboard.css';

function Dashboard() {
  const [stats, setStats] = useState({
    totalBlocks: 0,
    completedBlocks: 0,
    totalLBDs: 0,
    completedLBDs: 0
  });
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await tracker_api.getPowerBlocks();
      const allBlocks = res.data.data;

      let totalLBDs = 0;
      let completedLBDs = 0;
      let completedBlocks = 0;

      allBlocks.forEach(block => {
        totalLBDs += block.lbd_count;
        if (block.is_completed) completedBlocks++;

        // Estimate completed LBDs (this is simplified)
        const blockTotal = block.lbd_count;
        if (blockTotal > 0 && block.lbd_summary) {
          const totalStatuses = blockTotal * 6; // 6 status types per LBD
          const completedStatuses = Object.values(block.lbd_summary)
            .slice(1)
            .reduce((a, b) => a + b, 0);
          completedLBDs += (completedStatuses / 6); // Rough estimate
        }
      });

      setStats({
        totalBlocks: allBlocks.length,
        completedBlocks,
        totalLBDs,
        completedLBDs: Math.round(completedLBDs)
      });
      setBlocks(allBlocks.slice(0, 5)); // Show 5 recent blocks
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <h1 className="section-title">Dashboard</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <div className="stat-label">Power Blocks</div>
            <div className="stat-value">{stats.totalBlocks}</div>
            <div className="stat-subtext">
              {stats.completedBlocks} completed
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🔌</div>
          <div className="stat-content">
            <div className="stat-label">Total LBDs</div>
            <div className="stat-value">{stats.totalLBDs}</div>
            <div className="stat-subtext">
              {stats.completedLBDs} completed
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-label">Overall Progress</div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: stats.totalLBDs > 0 
                    ? `${(stats.completedLBDs / stats.totalLBDs) * 100}%`
                    : '0%'
                }}
              ></div>
            </div>
            <div className="stat-subtext">
              {stats.totalLBDs > 0 
                ? `${Math.round((stats.completedLBDs / stats.totalLBDs) * 100)}%`
                : '0%'}
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="section-header">
          <h2 className="section-subtitle">Recent Power Blocks</h2>
          <Link to="/power-blocks" className="view-all-link">View All</Link>
        </div>

        {blocks.length === 0 ? (
          <div className="empty-state">
            <p>No power blocks yet.</p>
            <Link to="/upload" className="btn btn-success">
              Upload PDF to Get Started
            </Link>
          </div>
        ) : (
          <div className="block-preview-grid">
            {blocks.map(block => (
              <Link
                key={block.id}
                to={`/power-block/${block.id}`}
                className="block-preview"
              >
                <h3>{block.name}</h3>
                <p className="block-meta">
                  {block.lbd_count} LBDs • Page {block.page_number || 'N/A'}
                </p>
                <div className="progress-bar small">
                  <div
                    className="progress-fill"
                    style={{
                      width: block.lbd_count > 0 
                        ? `${Math.min(100, (block.lbd_count * 20))}%`
                        : '0%'
                    }}
                  ></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="dashboard-section">
        <h2 className="section-subtitle">Quick Actions</h2>
        <div className="actions-grid">
          <Link to="/upload" className="action-card">
            <div className="action-icon">📤</div>
            <h3>Upload PDF</h3>
            <p>Add new power block pages from PDF</p>
          </Link>

          <Link to="/power-blocks" className="action-card">
            <div className="action-icon">📋</div>
            <h3>Manage Blocks</h3>
            <p>View and edit power blocks and LBDs</p>
          </Link>

          <Link to="/site-map" className="action-card">
            <div className="action-icon">🗺️</div>
            <h3>View Site Map</h3>
            <p>Interactive site map visualization</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
