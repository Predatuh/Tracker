import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { tracker_api } from '../api/apiClient';
import './PowerBlockList.css';

function PowerBlockList() {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [zoneFilter, setZoneFilter] = useState('');
  const [sortBy, setSortBy] = useState('default');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchPowerBlocks();
  }, []);

  const fetchPowerBlocks = async () => {
    try {
      const response = await tracker_api.getPowerBlocks();
      setBlocks(response.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error loading power blocks');
    } finally {
      setLoading(false);
    }
  };

  // Derive unique zones from blocks
  const zones = useMemo(() => {
    return [...new Set(blocks.map(b => b.zone).filter(Boolean))].sort();
  }, [blocks]);

  // Filtered + sorted blocks
  const filteredBlocks = useMemo(() => {
    let result = [...blocks];

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(b =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.zone || '').toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter === 'complete') {
      result = result.filter(b => b.is_completed);
    } else if (statusFilter === 'in-progress') {
      result = result.filter(b => !b.is_completed);
    }

    // Zone filter
    if (zoneFilter) {
      result = result.filter(b => b.zone === zoneFilter);
    }

    // Sort
    if (sortBy === 'zone') {
      result.sort((a, b) => {
        const za = a.zone || '\uFFFF', zb = b.zone || '\uFFFF';
        if (za !== zb) return za.localeCompare(zb);
        return (a.name || '').localeCompare(b.name || '');
      });
    } else if (sortBy === 'name') {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'lbd-count') {
      result.sort((a, b) => (b.lbd_count || 0) - (a.lbd_count || 0));
    }

    return result;
  }, [blocks, search, statusFilter, zoneFilter, sortBy]);

  const completedCount = blocks.filter(b => b.is_completed).length;
  const inProgressCount = blocks.length - completedCount;

  const getCompletionColor = (block) => {
    if (block.is_completed) return '#2ecc71';
    const stats = block.lbd_summary;
    if (!stats.total) return '#95a5a6';
    const completed = Object.values(stats).slice(1).reduce((a, b) => a + b, 0);
    const percentage = (completed / (stats.total * 6)) * 100;
    if (percentage > 75) return '#f39c12';
    if (percentage > 50) return '#e74c3c';
    return '#bdc3c7';
  };

  const getCompletionPercent = (block) => {
    const stats = block.lbd_summary;
    if (!stats || !stats.total) return 0;
    const entries = Object.entries(stats).filter(([k]) => k !== 'total');
    const totalSteps = entries.length * stats.total;
    const doneSteps = entries.reduce((sum, [, v]) => sum + v, 0);
    return totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="power-block-list container">
      <div className="pbl-header">
        <h1 className="section-title">Power Blocks</h1>
        <div className="pbl-summary">
          <span className="pbl-summary-chip pbl-chip-total">{blocks.length} total</span>
          <span className="pbl-summary-chip pbl-chip-done">{completedCount} done</span>
          <span className="pbl-summary-chip pbl-chip-progress">{inProgressCount} in progress</span>
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="pbl-filters-section">
          {/* Search bar — always visible */}
          <div className="pbl-search-row">
            <input
              type="text"
              className="pbl-search"
              placeholder="Search blocks..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button
              className={`pbl-filter-toggle ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              ☰ Filters {(statusFilter !== 'all' || zoneFilter || sortBy !== 'default') && <span className="pbl-filter-dot" />}
            </button>
          </div>

          {/* Quick status tabs */}
          <div className="pbl-status-tabs">
            {[
              { key: 'all', label: 'All' },
              { key: 'in-progress', label: 'In Progress' },
              { key: 'complete', label: 'Complete' },
            ].map(tab => (
              <button
                key={tab.key}
                className={`pbl-tab ${statusFilter === tab.key ? 'active' : ''}`}
                onClick={() => setStatusFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Expandable filter panel */}
          {showFilters && (
            <div className="pbl-filter-panel">
              {zones.length > 0 && (
                <div className="pbl-filter-group">
                  <label>Zone</label>
                  <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}>
                    <option value="">All Zones</option>
                    {zones.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
              )}
              <div className="pbl-filter-group">
                <label>Sort By</label>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="default">Default</option>
                  <option value="name">Name (A-Z)</option>
                  <option value="zone">Zone</option>
                  <option value="lbd-count">LBD Count</option>
                </select>
              </div>
              <button
                className="pbl-clear-btn"
                onClick={() => { setSearch(''); setStatusFilter('all'); setZoneFilter(''); setSortBy('default'); }}
              >
                Clear All
              </button>
            </div>
          )}
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="alert alert-info">
          No power blocks yet. <Link to="/upload">Upload a PDF</Link> to create power blocks.
        </div>
      ) : filteredBlocks.length === 0 ? (
        <div className="pbl-empty">No blocks match the current filters.</div>
      ) : (
        <div className="blocks-grid">
          {filteredBlocks.map(block => {
            const pct = getCompletionPercent(block);
            return (
              <Link
                key={block.id}
                to={`/power-block/${block.id}`}
                className="block-card"
                style={{ borderLeftColor: getCompletionColor(block) }}
              >
                <div className="block-header">
                  <div className="block-header-left">
                    <h3 className="block-title">{block.name}</h3>
                    {block.zone && <span className="block-zone-pill">{block.zone}</span>}
                  </div>
                  <span className="completion-badge" style={{ backgroundColor: getCompletionColor(block) }}>
                    {block.is_completed ? '✓ Done' : `${pct}%`}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="block-progress-bar">
                  <div
                    className="block-progress-fill"
                    style={{ width: `${pct}%`, backgroundColor: getCompletionColor(block) }}
                  />
                </div>

                {block.image_path && (
                  <div className="block-image-preview">
                    <img src={block.image_path} alt={block.name} />
                  </div>
                )}

                <div className="block-stats">
                  <div className="stat">
                    <span className="stat-label">LBDs</span>
                    <span className="stat-value">{block.lbd_count}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Page</span>
                    <span className="stat-value">{block.page_number || 'N/A'}</span>
                  </div>
                </div>

                <div className="status-summary">
                  {block.lbd_summary && (
                    <div className="status-items">
                      {Object.entries(block.lbd_summary).map(([key, value]) => (
                        key !== 'total' && value > 0 && (
                          <div key={key} className="status-item">
                            <span className="status-label">{key.replace(/_/g, ' ')}</span>
                            <span className="status-count">{value}/{block.lbd_summary.total}</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PowerBlockList;
