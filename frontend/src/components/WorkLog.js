import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { workers_api, worklog_api, tracker_api, admin_api } from '../api/apiClient';
import './WorkLog.css';
import { useAppContext } from '../context/AppContext';

const today = () => new Date().toISOString().split('T')[0];

export default function WorkLog() {
  const { currentTracker, currentTrackerId, trackerSettings } = useAppContext();
  const [workers, setWorkers]           = useState([]);
  const [powerBlocks, setPowerBlocks]   = useState([]);
  const [taskLabels, setTaskLabels]     = useState({});
  const [taskKeys, setTaskKeys]         = useState([]);

  const [selectedWorkers, setSelectedWorkers]     = useState([]);
  const [selectedBlocks, setSelectedBlocks]       = useState([]);
  const [selectedTask, setSelectedTask]           = useState('');
  const [workDate, setWorkDate]                   = useState(today());

  const [entries, setEntries]     = useState([]);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [addingWorker, setAddingWorker]  = useState(false);
  const [saving, setSaving]             = useState(false);
  const [flash, setFlash]               = useState(null);
  const [blockSearch, setBlockSearch]   = useState('');

  // ── load data ──────────────────────────────────────────────────────────
  const loadEntries = useCallback(async (d) => {
    try {
      const res = await worklog_api.getEntries(d, currentTrackerId);
      setEntries(res.data.data || []);
    } catch { setEntries([]); }
  }, [currentTrackerId]);

  useEffect(() => {
    (async () => {
      try {
        const [wRes, pbRes, settRes] = await Promise.all([
          workers_api.list(),
          tracker_api.getPowerBlocks({ trackerId: currentTrackerId }),
          admin_api.getTrackerSettings(currentTrackerId),
        ]);
        setWorkers(wRes.data.data || []);
        setPowerBlocks(pbRes.data.data || []);
        const names = settRes.data.data.names || {};
        const keys  = settRes.data.data.all_columns || Object.keys(names);
        setTaskLabels(names);
        setTaskKeys(keys);
        setSelectedTask((previous) => (previous && keys.includes(previous) ? previous : (keys[0] || '')));
      } catch (e) { console.error(e); }
    })();
    loadEntries(workDate);
  }, [currentTrackerId, loadEntries, workDate]);

  useEffect(() => { loadEntries(workDate); }, [workDate, loadEntries]);

  // ── helpers ────────────────────────────────────────────────────────────
  const toggle = (id, list, setList) =>
    setList(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const showFlash = (msg, type = 'success') => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3000);
  };

  // ── actions ────────────────────────────────────────────────────────────
  const handleAddWorker = async () => {
    if (!newWorkerName.trim()) return;
    try {
      const res = await workers_api.create(newWorkerName.trim());
      setWorkers(prev => [...prev, res.data.data]);
      setNewWorkerName('');
      setAddingWorker(false);
      showFlash(`"${res.data.data.name}" added`);
    } catch (e) {
      showFlash(e.response?.data?.error || 'Failed to add worker', 'error');
    }
  };

  const handleRemoveWorker = async (id) => {
    if (!window.confirm('Remove this worker? Their history is preserved.')) return;
    await workers_api.remove(id);
    setWorkers(prev => prev.filter(w => w.id !== id));
    setSelectedWorkers(prev => prev.filter(x => x !== id));
    showFlash('Worker removed');
  };

  const handleLogWork = async () => {
    if (!selectedWorkers.length) return showFlash('Select at least one worker', 'error');
    if (!selectedBlocks.length)  return showFlash('Select at least one power block', 'error');
    if (!selectedTask)           return showFlash('Select a task', 'error');
    setSaving(true);
    try {
      const res = await worklog_api.logWork({
        date: workDate,
        worker_ids: selectedWorkers,
        power_block_ids: selectedBlocks,
        task_type: selectedTask,
      }, currentTrackerId);
      const { created, skipped } = res.data;
      showFlash(`Logged ${created} entr${created === 1 ? 'y' : 'ies'}${skipped ? ` (${skipped} already existed)` : ''}`);
      setSelectedWorkers([]);
      setSelectedBlocks([]);
      loadEntries(workDate);
    } catch (e) {
      showFlash(e.response?.data?.error || 'Failed to log work', 'error');
    }
    setSaving(false);
  };

  const handleDeleteEntry = async (id) => {
    await worklog_api.deleteEntry(id);
    loadEntries(workDate);
    showFlash('Entry removed');
  };

  const selectAllBlocks = () =>
    setSelectedBlocks(powerBlocks.map(b => b.id));
  const clearAllBlocks = () => setSelectedBlocks([]);

  // ── group today's entries for display ──────────────────────────────────
  const grouped = entries.reduce((acc, e) => {
    const key = `${e.task_type}||${e.worker_name}`;
    if (!acc[key]) acc[key] = { task: e.task_type, worker: e.worker_name, blocks: [], ids: [] };
    acc[key].blocks.push(e.power_block_name);
    acc[key].ids.push(e.id);
    return acc;
  }, {});

  const filteredBlocks = useMemo(() => {
    const query = blockSearch.trim().toLowerCase();
    if (!query) return powerBlocks;
    return powerBlocks.filter((block) => {
      const name = String(block.name || '').toLowerCase();
      const zone = String(block.zone || '').toLowerCase();
      return name.includes(query) || zone.includes(query);
    });
  }, [blockSearch, powerBlocks]);

  const selectedWorkerNames = workers
    .filter((worker) => selectedWorkers.includes(worker.id))
    .map((worker) => worker.name)
    .join(', ');

  const selectedBlockNames = powerBlocks
    .filter((block) => selectedBlocks.includes(block.id))
    .slice(0, 4)
    .map((block) => block.name);

  const subtitle = trackerSettings?.ui_text?.sub_dashboard
    || 'Log worker activity against the same tracker context used on the dashboard and blocks screens.';

  return (
    <div className="worklog-page worklog-shell">
      {flash && <div className={`wl-flash wl-flash--${flash.type}`}>{flash.msg}</div>}

      <section className="container wl-hero">
        <div>
          <span className="dashboard-kicker">{currentTracker?.name || 'Tracker'} Work Log</span>
          <h1 className="section-title">Work Log</h1>
          <p className="wl-hero-copy">{subtitle}</p>
        </div>
        <div className="wl-hero-card-grid">
          <div className="wl-hero-card">
            <span>Workers</span>
            <strong>{workers.length}</strong>
          </div>
          <div className="wl-hero-card">
            <span>{currentTracker?.dashboard_blocks_label || 'Power Blocks'}</span>
            <strong>{powerBlocks.length}</strong>
          </div>
          <div className="wl-hero-card">
            <span>Entries Today</span>
            <strong>{entries.length}</strong>
          </div>
          <div className="wl-hero-card wl-hero-card--date">
            <span>Log Date</span>
            <input
              type="date"
              className="wl-date-picker"
              value={workDate}
              onChange={e => setWorkDate(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="wl-body">
        {/* ── LEFT: People + Task selection ── */}
        <div className="wl-panel">
          <section className="wl-section container">
            <div className="wl-section-header">
              <h2>Workers</h2>
              <button className="wl-btn-ghost" onClick={() => setAddingWorker(a => !a)}>
                {addingWorker ? 'Cancel' : '+ Add'}
              </button>
            </div>

            {addingWorker && (
              <div className="wl-add-row">
                <input
                  className="wl-input"
                  placeholder="Worker name"
                  value={newWorkerName}
                  onChange={e => setNewWorkerName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddWorker()}
                  autoFocus
                />
                <button className="wl-btn-primary" onClick={handleAddWorker}>Add</button>
              </div>
            )}

            <div className="wl-chip-list">
              {workers.map(w => (
                <div
                  key={w.id}
                  className={`wl-chip ${selectedWorkers.includes(w.id) ? 'wl-chip--active' : ''}`}
                  onClick={() => toggle(w.id, selectedWorkers, setSelectedWorkers)}
                >
                  <span className="wl-chip-label">{w.name}</span>
                  <button
                    className="wl-chip-del"
                    onClick={e => { e.stopPropagation(); handleRemoveWorker(w.id); }}
                    title="Remove"
                  >×</button>
                </div>
              ))}
              {workers.length === 0 && <p className="wl-empty">No workers yet. Add one above.</p>}
            </div>
          </section>

          <section className="wl-section container">
            <h2>Task</h2>
            <div className="wl-task-grid">
              {taskKeys.map(k => (
                <button
                  key={k}
                  className={`wl-task-btn ${selectedTask === k ? 'wl-task-btn--active' : ''}`}
                  onClick={() => setSelectedTask(k)}
                >
                  {taskLabels[k] || k}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* ── MIDDLE: Power block selection ── */}
        <div className="wl-panel wl-panel--wide">
          <section className="wl-section wl-section--full container">
            <div className="wl-section-header">
              <h2>Power Blocks</h2>
              <div className="wl-btn-row">
                <button className="wl-btn-ghost" onClick={selectAllBlocks}>All</button>
                <button className="wl-btn-ghost" onClick={clearAllBlocks}>None</button>
              </div>
            </div>
            <div className="wl-search-row">
              <input
                className="wl-input wl-input--search"
                placeholder={`Search ${currentTracker?.dashboard_blocks_label || 'power blocks'} by name or zone`}
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value)}
              />
            </div>
            <div className="wl-pb-grid">
              {filteredBlocks.map(pb => (
                <div
                  key={pb.id}
                  className={`wl-pb-card ${selectedBlocks.includes(pb.id) ? 'wl-pb-card--active' : ''}`}
                  onClick={() => toggle(pb.id, selectedBlocks, setSelectedBlocks)}
                >
                  <strong>{pb.name}</strong>
                  <span>{pb.zone || 'No zone'}</span>
                </div>
              ))}
              {filteredBlocks.length === 0 && <p className="wl-empty">No power blocks match that search.</p>}
            </div>
          </section>
        </div>

        {/* ── RIGHT: Submit + Today's log ── */}
        <div className="wl-panel">
          <section className="wl-section container">
            <h2>Submit</h2>
            <div className="wl-summary">
              <div><strong>Workers:</strong> {selectedWorkers.length ? selectedWorkerNames : <em>none</em>}</div>
              <div><strong>Task:</strong> {taskLabels[selectedTask] || selectedTask || <em>none</em>}</div>
              <div><strong>Blocks:</strong> {selectedBlocks.length} selected</div>
              {selectedBlockNames.length ? (
                <div><strong>Preview:</strong> {selectedBlockNames.join(', ')}{selectedBlocks.length > selectedBlockNames.length ? '...' : ''}</div>
              ) : null}
            </div>
            <button
              className="wl-btn-submit"
              onClick={handleLogWork}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Log Work'}
            </button>
          </section>

          <section className="wl-section container">
            <h2>Today's Entries</h2>
            {Object.values(grouped).length === 0 && (
              <p className="wl-empty">No work logged for this day yet.</p>
            )}
            {Object.values(grouped).map((g, i) => (
              <div key={i} className="wl-entry-card">
                <div className="wl-entry-header">
                  <span className="wl-entry-worker">{g.worker}</span>
                  <span className="wl-entry-task">{taskLabels[g.task] || g.task}</span>
                </div>
                <div className="wl-entry-blocks">{g.blocks.join(', ')}</div>
                <button
                  className="wl-entry-del"
                  onClick={() => g.ids.forEach(handleDeleteEntry)}
                  title="Remove these entries"
                >Delete</button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
