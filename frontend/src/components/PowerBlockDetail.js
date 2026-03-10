import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { tracker_api, lbd_api, admin_api } from '../api/apiClient';
import './PowerBlockDetail.css';

function PowerBlockDetail() {
  const { id } = useParams();
  const [block, setBlock] = useState(null);
  const [lbds, setLbds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');

  // Admin settings
  const [adminColors, setAdminColors] = useState({});
  const [adminNames, setAdminNames] = useState({});
  const [allColumns, setAllColumns] = useState([]);

  const [newLBD, setNewLBD] = useState({
    name: '',
    identifier: '',
    x_position: '',
    y_position: '',
    notes: ''
  });

  const fetchData = useCallback(async () => {
    try {
      const [blockRes, lbdsRes, settingsRes] = await Promise.all([
        tracker_api.getPowerBlock(id),
        lbd_api.getPowerBlockLBDs(id),
        admin_api.getSettings()
      ]);

      setBlock(blockRes.data.data);
      setLbds(lbdsRes.data.lbds);

      const s = settingsRes.data.data;
      setAdminColors(s.colors || {});
      setAdminNames(s.names || {});
      setAllColumns(s.all_columns || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateLBD = async (e) => {
    e.preventDefault();
    try {
      await tracker_api.createLBD({
        power_block_id: id,
        ...newLBD,
        x_position: parseFloat(newLBD.x_position) || null,
        y_position: parseFloat(newLBD.y_position) || null
      });
      setNewLBD({ name: '', identifier: '', x_position: '', y_position: '', notes: '' });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Error creating LBD');
    }
  };

  const handleStatusToggle = async (lbdId, statusType, currentStatus) => {
    try {
      await tracker_api.updateLBDStatus(lbdId, statusType, {
        is_completed: !currentStatus.is_completed,
        completed_at: !currentStatus.is_completed ? new Date().toISOString() : null
      });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Error updating status');
    }
  };

  // ---- Bulk-complete helpers ----
  const flashBulk = (msg) => {
    setBulkMsg(msg);
    setTimeout(() => setBulkMsg(''), 3000);
  };

  const handleBulkColumn = async (statusType, complete) => {
    try {
      await admin_api.bulkComplete(id, [statusType], complete);
      flashBulk(
        `${complete ? 'Checked' : 'Unchecked'} all LBDs for "${adminNames[statusType] || statusType}"`
      );
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Error bulk updating');
    }
  };

  const handleBulkAll = async (complete) => {
    try {
      await admin_api.bulkComplete(id, allColumns, complete);
      flashBulk(complete ? 'All statuses marked complete!' : 'All statuses cleared!');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Error bulk updating');
    }
  };

  // ---- Helpers ----
  const getColor = (statusType, isCompleted) => {
    if (isCompleted) return adminColors[statusType] || '#56AB91';
    return '#f0f0f0';
  };

  const getLabel = (statusType) => {
    return adminNames[statusType] || statusType.replace(/_/g, ' ');
  };

  const isColumnAllDone = (statusType) => {
    if (!lbds.length) return false;
    return lbds.every(lbd => {
      const s = (lbd.statuses || []).find(st => st.status_type === statusType);
      return s?.is_completed;
    });
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading"><div className="spinner" /></div>
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
    <div className="power-block-detail container">
      {block && (
        <div>
          <h1 className="section-title">{block.name}</h1>

          {block.image_path && (
            <div className="block-image-main">
              <img src={block.image_path} alt={block.name} />
            </div>
          )}

          <div className="block-info">
            <div className="info-group">
              <label>Page Number</label>
              <p>{block.page_number || 'N/A'}</p>
            </div>
            <div className="info-group">
              <label>Status</label>
              <p>{block.is_completed ? '✅ Completed' : '⏳ In Progress'}</p>
            </div>
            <div className="info-group">
              <label>LBD Count</label>
              <p>{block.lbd_count || 0}</p>
            </div>
          </div>

          {/* ─ Bulk Actions ─ */}
          {lbds.length > 0 && (
            <div className="bulk-actions">
              <h3 className="bulk-title">Bulk Actions</h3>
              {bulkMsg && <div className="bulk-flash">{bulkMsg}</div>}

              <div className="bulk-columns">
                {allColumns.map(col => (
                  <div className="bulk-col-group" key={col}>
                    <span
                      className="bulk-col-label"
                      style={{ borderBottomColor: adminColors[col] || '#CCC' }}
                    >
                      {getLabel(col)}
                    </span>
                    <div className="bulk-col-btns">
                      <button
                        className={`btn btn-sm bulk-check ${isColumnAllDone(col) ? 'all-done' : ''}`}
                        style={isColumnAllDone(col)
                          ? { backgroundColor: adminColors[col] || '#56AB91', color: '#fff' }
                          : {}}
                        onClick={() => handleBulkColumn(col, true)}
                        title={`Mark all "${getLabel(col)}" complete`}
                      >
                        ✓ All
                      </button>
                      <button
                        className="btn btn-sm bulk-uncheck"
                        onClick={() => handleBulkColumn(col, false)}
                        title={`Clear all "${getLabel(col)}"`}
                      >
                        ○ Clear
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bulk-global">
                <button className="btn btn-success" onClick={() => handleBulkAll(true)}>
                  ✓ Complete Entire PB
                </button>
                <button className="btn btn-danger" onClick={() => handleBulkAll(false)}>
                  ○ Clear Entire PB
                </button>
              </div>
            </div>
          )}

          <h2 className="section-subtitle">LBDs</h2>

          {lbds.length === 0 ? (
            <div className="alert alert-info">No LBDs yet. Add one below.</div>
          ) : (
            <div className="lbd-list">
              {lbds.map(lbd => (
                <div key={lbd.id} className="lbd-card">
                  <div className="lbd-header">
                    <h3>{lbd.identifier || lbd.name}</h3>
                    <span className="completion-percent">{lbd.completion_percentage}%</span>
                  </div>

                  <div className="status-grid">
                    {allColumns.map(col => {
                      const status = (lbd.statuses || []).find(s => s.status_type === col)
                        || { status_type: col, is_completed: false, id: null };
                      return (
                        <button
                          key={col}
                          className={`status-button ${status.is_completed ? 'completed' : ''}`}
                          style={{
                            backgroundColor: getColor(col, status.is_completed),
                            color: status.is_completed ? 'white' : '#333'
                          }}
                          onClick={() => handleStatusToggle(lbd.id, col, status)}
                          title={getLabel(col)}
                        >
                          {status.is_completed ? '✓' : '○'} {getLabel(col)}
                        </button>
                      );
                    })}
                  </div>

                  {lbd.notes && (
                    <div className="lbd-notes">
                      <strong>Notes:</strong> {lbd.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <h2 className="section-subtitle">Add New LBD</h2>
          <form className="add-lbd-form" onSubmit={handleCreateLBD}>
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={newLBD.name}
                  onChange={(e) => setNewLBD({ ...newLBD, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Identifier (e.g., LBD-001)</label>
                <input
                  type="text"
                  value={newLBD.identifier}
                  onChange={(e) => setNewLBD({ ...newLBD, identifier: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>X Position (pixels)</label>
                <input
                  type="number"
                  step="0.1"
                  value={newLBD.x_position}
                  onChange={(e) => setNewLBD({ ...newLBD, x_position: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Y Position (pixels)</label>
                <input
                  type="number"
                  step="0.1"
                  value={newLBD.y_position}
                  onChange={(e) => setNewLBD({ ...newLBD, y_position: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={newLBD.notes}
                onChange={(e) => setNewLBD({ ...newLBD, notes: e.target.value })}
                rows="3"
              />
            </div>

            <button type="submit" className="btn btn-success">Add LBD</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default PowerBlockDetail;
