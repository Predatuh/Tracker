import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { tracker_api } from '../api/apiClient';
import './Dashboard.css';
import { useAppContext } from '../context/AppContext';

function Dashboard() {
  const navigate = useNavigate();
  const { trackers, currentTracker, currentTrackerId, setCurrentTrackerId, trackerSettings } = useAppContext();
  const [trackerCards, setTrackerCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadTrackerCards = async () => {
      if (!trackers.length) {
        if (mounted) {
          setTrackerCards([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const cards = await Promise.all(trackers.map(async (tracker) => {
          const response = await tracker_api.getPowerBlocks({ trackerId: tracker.id });
          const blocks = response.data.data || [];
          const totalBlocks = blocks.length;
          const completedBlocks = blocks.filter((block) => block.is_completed).length;
          const totalItems = blocks.reduce((sum, block) => sum + (block.lbd_count || 0), 0);
          const termedItems = blocks.reduce((sum, block) => sum + ((block.lbd_summary && block.lbd_summary.term) || 0), 0);
          const percentage = totalItems > 0 ? Math.round((termedItems / totalItems) * 100) : 0;
          return {
            ...tracker,
            blocks,
            totalBlocks,
            completedBlocks,
            totalItems,
            termedItems,
            percentage,
            recentBlocks: blocks.slice(0, 4),
          };
        }));

        if (mounted) {
          setTrackerCards(cards);
        }
      } catch (error) {
        if (mounted) {
          setTrackerCards([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadTrackerCards();

    return () => {
      mounted = false;
    };
  }, [trackers]);

  const activeCard = useMemo(() => {
    if (!trackerCards.length) return null;
    return trackerCards.find((card) => card.id === currentTrackerId) || trackerCards[0];
  }, [currentTrackerId, trackerCards]);

  const summary = useMemo(() => {
    return trackerCards.reduce((accumulator, card) => ({
      totalBlocks: accumulator.totalBlocks + card.totalBlocks,
      completedBlocks: accumulator.completedBlocks + card.completedBlocks,
      totalItems: accumulator.totalItems + card.totalItems,
      termedItems: accumulator.termedItems + card.termedItems,
    }), {
      totalBlocks: 0,
      completedBlocks: 0,
      totalItems: 0,
      termedItems: 0,
    });
  }, [trackerCards]);

  const globalPercentage = summary.totalItems > 0
    ? Math.round((summary.termedItems / summary.totalItems) * 100)
    : 0;

  const trackerCountLabel = `${trackers.length} tracker${trackers.length === 1 ? '' : 's'}`;

  const openTracker = (trackerId) => {
    setCurrentTrackerId(trackerId);
    navigate('/power-blocks');
  };

  return (
    <div className="dashboard-shell">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker">{currentTracker?.name || 'Tracker Overview'}</span>
          <div className="dashboard-title-wrap">
            <h1 className="section-title dashboard-hero-title">Keep work moving.</h1>
            <div className="dashboard-title-signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
          <p className="dashboard-subtitle">
            Check block progress, jump into the map, and pick up exactly where the crew left off.
          </p>
          <div className="dashboard-hero-actions">
            <button className="app-btn app-btn-primary" onClick={() => navigate('/power-blocks')}>
              Open {currentTracker?.name || 'current tracker'}
            </button>
            <Link to="/site-map" className="app-btn app-btn-secondary">Open map</Link>
          </div>
        </div>
        <div className="dashboard-hero-panel">
          <div className="hero-progress-chip">{globalPercentage}% complete</div>
          <div className="hero-grid">
            <div>
              <span>Total power blocks across {trackerCountLabel}</span>
              <strong>{summary.totalBlocks}</strong>
            </div>
            <div>
              <span>Completed blocks</span>
              <strong>{summary.completedBlocks}</strong>
            </div>
            <div>
              <span>Tracked LBDs</span>
              <strong>{summary.totalItems}</strong>
            </div>
            <div>
              <span>Termed items</span>
              <strong>{summary.termedItems}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-section dashboard-section--trackers container">
        <div className="dashboard-section-head">
          <div>
            <span className="dashboard-kicker">Trackers</span>
            <h2 className="section-title">Choose a tracker</h2>
          </div>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <div className="tracker-card-grid">
            {trackerCards.map((tracker) => (
              <article
                key={tracker.id}
                className={`tracker-card ${tracker.id === currentTrackerId ? 'tracker-card--active' : ''}`}
              >
                <div className="tracker-card-head">
                  <div className="tracker-card-icon">{tracker.icon || '📋'}</div>
                  <div>
                    <h3>{tracker.name}</h3>
                    <p>{tracker.stat_label || tracker.item_name_plural || 'Items'}</p>
                  </div>
                </div>
                <div className="tracker-card-progress-row">
                  <span>{tracker.percentage}% complete</span>
                  <span>{tracker.totalBlocks} blocks</span>
                </div>
                <div className="tracker-progress-bar">
                  <div className="tracker-progress-fill" style={{ width: `${tracker.percentage}%` }} />
                </div>
                <div className="tracker-card-stats">
                  <div>
                    <strong>{tracker.completedBlocks}</strong>
                    <span>Completed</span>
                  </div>
                  <div>
                    <strong>{tracker.totalItems}</strong>
                    <span>{tracker.item_name_plural || 'Items'}</span>
                  </div>
                  <div>
                    <strong>{tracker.termedItems}</strong>
                    <span>{tracker.dashboard_progress_label || 'Complete'}</span>
                  </div>
                </div>
                <button className="tracker-card-link" onClick={() => openTracker(tracker.id)}>
                  {tracker.dashboard_open_label || 'Open Tracker'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="dashboard-detail-grid">
        <div className="dashboard-section container">
          <div className="dashboard-section-head">
            <div>
              <span className="dashboard-kicker">Current Tracker</span>
              <h2 className="section-title">{activeCard?.name || 'No tracker selected'}</h2>
            </div>
            <button
              className="app-btn app-btn-secondary"
              onClick={() => currentTrackerId && navigate('/power-blocks')}
              disabled={!currentTrackerId}
            >
              View blocks
            </button>
          </div>
          <p className="dashboard-panel-copy">
            {trackerSettings?.ui_text?.sub_dashboard || 'Select a tracker to view and manage its progress.'}
          </p>
          <div className="dashboard-mini-grid">
            <div className="dashboard-mini-card">
              <span>Current progress</span>
              <strong>{activeCard?.percentage || 0}%</strong>
            </div>
            <div className="dashboard-mini-card">
              <span>Power blocks</span>
              <strong>{activeCard?.totalBlocks || 0}</strong>
            </div>
            <div className="dashboard-mini-card">
              <span>{activeCard?.item_name_plural || 'Items'}</span>
              <strong>{activeCard?.totalItems || 0}</strong>
            </div>
          </div>
        </div>

        <div className="dashboard-section container">
          <div className="dashboard-section-head">
            <div>
              <span className="dashboard-kicker">Recent Power Blocks</span>
              <h2 className="section-title">Recent activity</h2>
            </div>
            <Link to="/power-blocks" className="dashboard-inline-link">See all</Link>
          </div>

          {activeCard?.recentBlocks?.length ? (
            <div className="recent-block-list">
              {activeCard.recentBlocks.map((block) => (
                <Link key={block.id} to={`/power-block/${block.id}`} className="recent-block-item">
                  <div>
                    <strong>{block.name}</strong>
                    <span>{block.zone || 'No zone'} · {block.lbd_count || 0} LBDs</span>
                  </div>
                  <span>{block.is_completed ? 'Done' : 'In Progress'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="alert alert-info">No blocks loaded for this tracker yet.</div>
          )}
        </div>
      </section>

      <section className="dashboard-section container">
        <div className="dashboard-section-head">
          <div>
            <span className="dashboard-kicker">Quick Actions</span>
            <h2 className="section-title">Open a workspace</h2>
          </div>
        </div>
        <div className="dashboard-action-grid">
          <Link to="/power-blocks" className="dashboard-action-card">
            <span>01</span>
            <strong>{currentTracker?.dashboard_blocks_label || 'Power Blocks'}</strong>
            <p>Review claim status, open the current tracker, and continue work.</p>
          </Link>
          <Link to="/site-map" className="dashboard-action-card dashboard-action-card--map">
            <span>02</span>
            <strong>Map</strong>
            <p>Open the active site map and adjust labels or placements.</p>
          </Link>
          <Link to="/reports" className="dashboard-action-card dashboard-action-card--reports">
            <span>03</span>
            <strong>Reports</strong>
            <p>Review daily progress, logs, and generated reports.</p>
          </Link>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
