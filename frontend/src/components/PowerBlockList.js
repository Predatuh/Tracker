import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { tracker_api } from '../api/apiClient';
import './PowerBlockList.css';
import { useAppContext } from '../context/AppContext';

function PowerBlockList() {
  const { currentTracker, currentTrackerId, trackerSettings } = useAppContext();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [zoneFilter, setZoneFilter] = useState('');
  const [sortBy, setSortBy] = useState('default');
  const [showFilters, setShowFilters] = useState(false);

  const itemLabel = currentTracker?.item_name_plural || 'Items';
  const progressLabel = currentTracker?.dashboard_progress_label || 'Complete';

  const fetchPowerBlocks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await tracker_api.getPowerBlocks({ trackerId: currentTrackerId });
      setBlocks(response.data.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Error loading power blocks');
    } finally {
      setLoading(false);
    }
  }, [currentTrackerId]);

  useEffect(() => {
    fetchPowerBlocks();
  }, [fetchPowerBlocks]);

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
  const claimedCount = blocks.filter((block) => Boolean(block.claimed_label)).length;
  const totalItems = blocks.reduce((sum, block) => sum + (block.lbd_count || 0), 0);
  const progressedItems = blocks.reduce((sum, block) => {
    const summary = block.lbd_summary || {};
    return sum + Object.entries(summary)
      .filter(([key]) => key !== 'total')
      .reduce((value, [, count]) => value + count, 0);
  }, 0);

  const subtitle = trackerSettings?.ui_text?.sub_dashboard || 'Review block progress, claims, and zones from the selected tracker.';

  const getCompletionColor = (block) => {
    if (block.is_completed) return '#2ecc71';
    const stats = block.lbd_summary;
    if (!stats?.total) return '#95a5a6';
    const entries = Object.entries(stats).filter(([key]) => key !== 'total');
    const completed = entries.reduce((a, [, b]) => a + b, 0);
    const percentage = (completed / Math.max(1, stats.total * entries.length)) * 100;
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

  const toImagePath = (imagePath) => {
    if (!imagePath) return null;
    return `/${String(imagePath).replace(/\\/g, '/')}`;
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
    <div className="power-block-list pbl-shell">
      <section className="container pbl-hero">
        <div className="pbl-hero-copy">
          <span className="dashboard-kicker">{currentTracker?.name || 'Tracker'} Workflow</span>
          <h1 className="section-title">{currentTracker?.dashboard_blocks_label || 'Power Blocks'}</h1>
          <p className="pbl-hero-subtitle">{subtitle}</p>
        </div>
        <div className="pbl-hero-metrics">
          <div className="pbl-metric-card">
            <span>Total Blocks</span>
            <strong>{blocks.length}</strong>
          </div>
          <div className="pbl-metric-card">
            <span>{progressLabel}</span>
            <strong>{completedCount}</strong>
          </div>
          <div className="pbl-metric-card">
            <span>Claimed</span>
            <strong>{claimedCount}</strong>
          </div>
          <div className="pbl-metric-card">
            <span>{itemLabel}</span>
            <strong>{totalItems}</strong>
          </div>
        </div>
      </section>

      <section className="container pbl-toolbar-card">
        <div className="pbl-toolbar-row">
          <div className="pbl-search-wrap">
            <input
              type="text"
              className="pbl-search"
              placeholder={`Search ${currentTracker?.dashboard_blocks_label || 'power blocks'}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            className={`pbl-filter-toggle ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters {(statusFilter !== 'all' || zoneFilter || sortBy !== 'default') && <span className="pbl-filter-dot" />}
          </button>
        </div>

        <div className="pbl-status-tabs">
          {[
            { key: 'all', label: 'All' },
            { key: 'in-progress', label: 'In Progress' },
            { key: 'complete', label: progressLabel },
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
                <option value="name">Name</option>
                <option value="zone">Zone</option>
                <option value="lbd-count">LBD Count</option>
              </select>
            </div>
            <div className="pbl-filter-group pbl-filter-group--summary">
              <label>Progressed Steps</label>
              <div className="pbl-inline-stat">{progressedItems}</div>
            </div>
            <button
              className="pbl-clear-btn"
              onClick={() => { setSearch(''); setStatusFilter('all'); setZoneFilter(''); setSortBy('default'); }}
            >
              Clear All
            </button>
          </div>
        )}
      </section>

      <section className="container pbl-list-card">
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
              const color = getCompletionColor(block);
              const summaryItems = Object.entries(block.lbd_summary || {})
                .filter(([key, value]) => key !== 'total' && value > 0)
                .slice(0, 4);
              return (
                <Link
                  key={block.id}
                  to={`/power-block/${block.id}`}
                  className="block-card"
                  style={{ '--block-accent': color }}
                >
                  <div className="block-card-glow" />
                  <div className="block-header">
                    <div className="block-header-left">
                      <div className="block-title-row">
                        <h3 className="block-title">{block.name}</h3>
                        {block.zone && <span className="block-zone-pill">{block.zone}</span>}
                      </div>
                      <p className="block-subtitle">
                        {block.page_number ? `Page ${block.page_number}` : 'No page assigned'}
                        {block.claimed_label ? ` · Claimed by ${block.claimed_label}` : ' · Unclaimed'}
                      </p>
                    </div>
                    <span className="completion-badge" style={{ backgroundColor: color }}>
                      {block.is_completed ? 'Done' : `${pct}%`}
                    </span>
                  </div>

                  <div className="block-progress-bar">
                    <div
                      className="block-progress-fill"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>

                  {block.image_path && (
                    <div className="block-image-preview">
                      <img src={toImagePath(block.image_path)} alt={block.name} />
                    </div>
                  )}

                  <div className="block-stats">
                    <div className="stat">
                      <span className="stat-label">{itemLabel}</span>
                      <span className="stat-value">{block.lbd_count}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Updated</span>
                      <span className="stat-value stat-value--small">{block.last_updated_by || 'Pending'}</span>
                    </div>
                  </div>

                  <div className="status-summary">
                    <div className="status-summary-head">
                      <span>Status progress</span>
                      <strong>{progressLabel}</strong>
                    </div>
                    {summaryItems.length ? (
                      <div className="status-chip-row">
                        {summaryItems.map(([key, value]) => (
                          <div key={key} className="status-chip">
                            <span>{key.replace(/_/g, ' ')}</span>
                            <strong>{value}/{block.lbd_summary.total}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="status-empty">No status steps completed yet.</div>
                    )}
                  </div>

                  <div className="block-card-footer">
                    <span>{block.claimed_label ? 'Claim active' : 'Ready to claim'}</span>
                    <strong>Open Block</strong>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default PowerBlockList;
