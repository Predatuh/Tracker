import React, { useEffect, useState, useCallback } from 'react';
import { admin_api, auth_api } from '../api/apiClient';
import './AdminPanel.css';
import { useAppContext } from '../context/AppContext';

const BASE_TABS = ['Colors', 'Column Names', 'Columns', 'Map Labels'];

function AdminPanel() {
  const { currentTracker, currentTrackerId, isAdmin } = useAppContext();
  const [activeTab, setActiveTab] = useState('Colors');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [userAdminData, setUserAdminData] = useState({ users: [], job_sites: [] });
  const [siteDrafts, setSiteDrafts] = useState({});

  // Local edit buffers
  const [colors, setColors] = useState({});
  const [names, setNames] = useState({});
  const [fontSize, setFontSize] = useState(14);

  // New column form
  const [newCol, setNewCol] = useState({ key: '', label: '', color: '#888888' });

  const fetchSettings = useCallback(async () => {
    try {
      const res = await admin_api.getTrackerSettings(currentTrackerId);
      const d = res.data.data;
      setSettings(d);
      setColors(d.colors || {});
      setNames(d.names || {});
      setFontSize(d.pb_label_font_size || 14);
    } catch (e) {
      setError('Failed to load admin settings');
    } finally {
      setLoading(false);
    }
  }, [currentTrackerId]);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setUsersLoading(true);
    try {
      const res = await auth_api.listUsers();
      const users = res.data.users || [];
      const jobSites = res.data.job_sites || [];
      setUserAdminData({ users, job_sites: jobSites });
      setSiteDrafts(
        users.reduce((acc, user) => {
          const matchingSite = jobSites.find((site) => site.name === user.job_site_name);
          acc[user.id] = matchingSite?.token || '';
          return acc;
        }, {})
      );
    } catch (e) {
      flash('Failed to load user access', true);
    } finally {
      setUsersLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const flash = (msg, isError = false) => {
    if (isError) { setError(msg); setSuccess(''); }
    else { setSuccess(msg); setError(''); }
    setTimeout(() => { setError(''); setSuccess(''); }, 3500);
  };

  // ---- Save colors ----
  const saveColors = async () => {
    setSaving(true);
    try {
      await admin_api.updateColors(colors, currentTrackerId);
      flash('Colors saved!');
      fetchSettings();
    } catch (e) {
      flash(e.response?.data?.error || 'Error saving colors', true);
    } finally { setSaving(false); }
  };

  // ---- Save names ----
  const saveNames = async () => {
    setSaving(true);
    try {
      await admin_api.updateNames(names, currentTrackerId);
      flash('Names saved!');
      fetchSettings();
    } catch (e) {
      flash(e.response?.data?.error || 'Error saving names', true);
    } finally { setSaving(false); }
  };

  // ---- Save font size ----
  const saveFontSize = async () => {
    setSaving(true);
    try {
      await admin_api.updateFontSize(fontSize, currentTrackerId);
      flash('Font size saved!');
      fetchSettings();
    } catch (e) {
      flash(e.response?.data?.error || 'Error saving font size', true);
    } finally { setSaving(false); }
  };

  // ---- Add column ----
  const addColumn = async () => {
    if (!newCol.key || !newCol.label) {
      flash('Key and label are required', true);
      return;
    }
    setSaving(true);
    try {
      await admin_api.addColumn(newCol.key, newCol.label, newCol.color, currentTrackerId);
      flash(`Column "${newCol.label}" added!`);
      setNewCol({ key: '', label: '', color: '#888888' });
      fetchSettings();
    } catch (e) {
      flash(e.response?.data?.error || 'Error adding column', true);
    } finally { setSaving(false); }
  };

  // ---- Delete column ----
  const deleteColumn = async (key) => {
    if (!window.confirm(`Delete column "${names[key] || key}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await admin_api.deleteColumn(key, currentTrackerId);
      flash('Column deleted');
      fetchSettings();
    } catch (e) {
      flash(e.response?.data?.error || 'Error deleting column', true);
    } finally { setSaving(false); }
  };

  const updateUserAccess = async (user) => {
    setSaving(true);
    try {
      const jobToken = siteDrafts[user.id] || '';
      const response = await auth_api.updateUserJobSite(user.id, jobToken);
      flash(response.data.message || 'User access updated');
      fetchUsers();
    } catch (e) {
      flash(e.response?.data?.error || 'Error updating user access', true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-panel container">
        <div className="loading"><div className="spinner" /></div>
      </div>
    );
  }

  const builtinKeys = [
    'stuff', 'term', 'stickers', 'ground_brackets', 'quality_check', 'quality_docs'
  ];
  const customKeys = settings?.custom_columns || [];
  const allKeys = settings?.all_columns || builtinKeys;
  const tabs = isAdmin ? [...BASE_TABS, 'User Access'] : BASE_TABS;

  return (
    <div className="admin-panel admin-shell">
      <section className="container admin-hero">
        <div>
          <span className="dashboard-kicker">{currentTracker?.name || 'Tracker'} Admin</span>
          <h1 className="section-title">Admin Controls</h1>
          <p className="admin-hero-copy">
            Manage tracker-specific column colors, labels, and map typography from the same visual system as the rest of the app-aligned web UI.
          </p>
        </div>
        <div className="admin-hero-grid">
          <div className="admin-hero-card">
            <span>Status Columns</span>
            <strong>{allKeys.length}</strong>
          </div>
          <div className="admin-hero-card">
            <span>Custom Columns</span>
            <strong>{customKeys.length}</strong>
          </div>
          <div className="admin-hero-card">
            <span>Map Label Size</span>
            <strong>{fontSize}px</strong>
          </div>
          <div className="admin-hero-card">
            <span>Active Scope</span>
            <strong>{currentTracker?.name || 'Global'}</strong>
          </div>
        </div>
      </section>

      <div className="admin-panel container">

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="admin-tabs">
          {tabs.map(t => (
            <button
              key={t}
              className={`admin-tab-btn ${activeTab === t ? 'active' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="admin-tab-content">

        {/* ─────────── COLORS ─────────── */}
        {activeTab === 'Colors' && (
          <div className="admin-section">
            <h2 className="section-subtitle">Status Colors</h2>
            <p className="admin-hint">Click a swatch to pick a new color for each status column.</p>
            <div className="color-grid">
              {allKeys.map(key => (
                <div className="color-row" key={key}>
                  <span className="color-name">{names[key] || key}</span>
                  <div className="color-picker-wrap">
                    <input
                      type="color"
                      value={colors[key] || '#CCCCCC'}
                      onChange={e => setColors(c => ({ ...c, [key]: e.target.value }))}
                      className="color-swatch-input"
                    />
                    <span className="color-hex">{colors[key] || '#CCCCCC'}</span>
                  </div>
                  <div
                    className="color-preview"
                    style={{ backgroundColor: colors[key] || '#CCCCCC' }}
                  />
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={saveColors}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Colors'}
            </button>
          </div>
        )}

        {/* ─────────── COLUMN NAMES ─────────── */}
        {activeTab === 'Column Names' && (
          <div className="admin-section">
            <h2 className="section-subtitle">Status Column Display Names</h2>
            <p className="admin-hint">Change how each status column is labeled throughout the app.</p>
            <div className="names-grid">
              {allKeys.map(key => (
                <div className="name-row" key={key}>
                  <span className="name-key-badge">{key}</span>
                  <input
                    type="text"
                    className="name-input"
                    value={names[key] || ''}
                    onChange={e => setNames(n => ({ ...n, [key]: e.target.value }))}
                    placeholder="Display name"
                  />
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={saveNames}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Names'}
            </button>
          </div>
        )}

        {/* ─────────── COLUMNS ─────────── */}
        {activeTab === 'Columns' && (
          <div className="admin-section">
            <h2 className="section-subtitle">Status Columns</h2>

            <div className="columns-list">
              <h3>Built-in Columns</h3>
              {builtinKeys.map(key => (
                <div className="column-item built-in" key={key}>
                  <div
                    className="col-dot"
                    style={{ backgroundColor: colors[key] || '#CCC' }}
                  />
                  <span className="col-label">{names[key] || key}</span>
                  <span className="col-badge">built-in</span>
                </div>
              ))}

              {customKeys.length > 0 && (
                <>
                  <h3 style={{ marginTop: '20px' }}>Custom Columns</h3>
                  {customKeys.map(key => (
                    <div className="column-item custom" key={key}>
                      <div
                        className="col-dot"
                        style={{ backgroundColor: colors[key] || '#CCC' }}
                      />
                      <span className="col-label">{names[key] || key}</span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => deleteColumn(key)}
                        disabled={saving}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="add-column-form">
              <h3>Add New Column</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Key (no spaces, e.g. "torque_check")</label>
                  <input
                    type="text"
                    value={newCol.key}
                    onChange={e => setNewCol(c => ({
                      ...c,
                      key: e.target.value.toLowerCase().replace(/\s+/g, '_')
                    }))}
                    placeholder="column_key"
                  />
                </div>
                <div className="form-group">
                  <label>Display Label</label>
                  <input
                    type="text"
                    value={newCol.label}
                    onChange={e => setNewCol(c => ({ ...c, label: e.target.value }))}
                    placeholder="Column Label"
                  />
                </div>
                <div className="form-group">
                  <label>Color</label>
                  <div className="color-picker-wrap">
                    <input
                      type="color"
                      value={newCol.color}
                      onChange={e => setNewCol(c => ({ ...c, color: e.target.value }))}
                      className="color-swatch-input"
                    />
                    <span className="color-hex">{newCol.color}</span>
                  </div>
                </div>
              </div>
              <button
                className="btn btn-success"
                onClick={addColumn}
                disabled={saving || !newCol.key || !newCol.label}
              >
                {saving ? 'Adding…' : 'Add Column'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'User Access' && isAdmin && (
          <div className="admin-section">
            <h2 className="section-subtitle">User Access</h2>
            <p className="admin-hint">Assign or revoke job-token access for existing accounts. Older users created before token gating will show no assigned site until you set one here.</p>
            {usersLoading ? <div className="admin-hint">Loading user access…</div> : null}
            <div className="access-grid">
              {userAdminData.users
                .filter((user) => user.username !== 'admin')
                .map((user) => (
                  <div className="access-card" key={user.id}>
                    <div className="access-card-head">
                      <div>
                        <strong>{user.name}</strong>
                        <div className="access-meta">@{user.username} • {user.role || 'user'}</div>
                      </div>
                      <span className={`access-badge ${user.job_site_name ? 'access-badge--active' : 'access-badge--empty'}`}>
                        {user.job_site_name || 'No access assigned'}
                      </span>
                    </div>
                    <div className="form-row access-form-row">
                      <div className="form-group access-form-group">
                        <label>Job Token Access</label>
                        <select
                          value={siteDrafts[user.id] || ''}
                          onChange={(event) => setSiteDrafts((current) => ({ ...current, [user.id]: event.target.value }))}
                        >
                          <option value="">No access</option>
                          {userAdminData.job_sites.map((site) => (
                            <option key={site.token} value={site.token}>
                              {site.name} ({site.token})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="access-actions">
                        <button
                          className="btn btn-primary"
                          onClick={() => updateUserAccess(user)}
                          disabled={saving}
                        >
                          {saving ? 'Saving…' : 'Save Access'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ─────────── MAP LABELS ─────────── */}
        {activeTab === 'Map Labels' && (
          <div className="admin-section">
            <h2 className="section-subtitle">Power Block Label Font Size (Map View)</h2>
            <p className="admin-hint">
              Controls the default font size for PB number labels on the site map.
              Individual areas can override this in the Map view.
            </p>
            <div className="font-size-control">
              <label className="font-size-label">
                Font Size: <strong>{fontSize}px</strong>
              </label>
              <input
                type="range"
                min={8}
                max={72}
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                className="font-size-slider"
              />
              <div
                className="font-size-preview"
                style={{ fontSize: `${fontSize}px` }}
              >
                PB-01
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={saveFontSize}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Font Size'}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;
