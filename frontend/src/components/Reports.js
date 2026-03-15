import React, { useState, useEffect, useCallback } from 'react';
import { reports_api, admin_api } from '../api/apiClient';
import './Reports.css';
import { useAppContext } from '../context/AppContext';

// ── Date helpers ────────────────────────────────────────────────────────────
const pad  = n => String(n).padStart(2, '0');
const fmt  = d => d ? d.replace(/-/g, '/') : '';
const fmtLong = d => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m,10)-1]} ${parseInt(day,10)}, ${y}`;
};
const todayStr = () => new Date().toISOString().split('T')[0];
const getMonthDays = (year, month) => {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  return { firstDay, daysInMonth };
};
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// ── View tabs ───────────────────────────────────────────────────────────────
const VIEWS = ['Calendar', 'List', 'Weekly', 'Monthly'];

export default function Reports() {
  const { currentTracker, currentTrackerId, trackerSettings } = useAppContext();
  const [view, setView]         = useState('Calendar');
  const [allReports, setAllReports] = useState([]);  // summaries for calendar/list
  const [taskLabels, setTaskLabels] = useState({});
  const [selected, setSelected] = useState(null);    // full report obj
  const [loading, setLoading]   = useState(false);

  // Calendar state
  const today = todayStr();
  const [calYear,  setCalYear]  = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);

  // Weekly state
  const [weekDate, setWeekDate] = useState(today);

  // Monthly state
  const [monthYear,  setMonthYear]  = useState(new Date().getFullYear());
  const [monthMonth, setMonthMonth] = useState(new Date().getMonth() + 1);

  // ── Load all report summaries ───────────────────────────────────────────
  const loadSummaries = useCallback(async () => {
    try {
      const [rRes, sRes] = await Promise.all([
        reports_api.list(currentTrackerId),
        admin_api.getTrackerSettings(currentTrackerId),
      ]);
      setAllReports(rRes.data.data || []);
      setTaskLabels(sRes.data.data.names || {});
    } catch { }
  }, [currentTrackerId]);

  useEffect(() => { loadSummaries(); }, [loadSummaries]);

  // ── Open a report by date ───────────────────────────────────────────────
  const openDate = useCallback(async (dateStr) => {
    setLoading(true);
    setSelected(null);
    try {
      const res = await reports_api.getByDate(dateStr, currentTrackerId);
      setSelected(res.data.data);
    } catch { }
    setLoading(false);
  }, [currentTrackerId]);

  // ── Helper: set of dates that have reports ──────────────────────────────
  const reportDateSet = new Set(allReports.map(r => r.report_date));

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER: Detail panel
  // ═══════════════════════════════════════════════════════════════════════
  const renderDetail = () => {
    if (loading) return <div className="rp-detail-empty"><span className="rp-spinner" /></div>;
    if (!selected) return <div className="rp-detail-empty"><p>Select a day to view the report.</p></div>;
    const d = selected.data || {};
    return (
      <div className="rp-detail">
        <div className="rp-detail-title">{fmtLong(selected.report_date)}</div>
        <div className="rp-detail-meta">
          {d.total_entries} work entr{d.total_entries === 1 ? 'y' : 'ies'} &nbsp;·&nbsp;
          Generated {new Date(selected.generated_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
        </div>

        {d.total_entries === 0 && <p className="rp-no-data">No work was logged this day.</p>}

        {/* By Worker */}
        {d.by_worker && Object.keys(d.by_worker).length > 0 && (
          <div className="rp-block">
            <h3>By Worker</h3>
            {Object.entries(d.by_worker).map(([worker, tasks]) => (
              <div key={worker} className="rp-row">
                <div className="rp-row-name">{worker}</div>
                <div className="rp-row-entries">
                  {Object.entries(tasks).map(([task, blocks]) => (
                    <div key={task} className="rp-task-entry">
                      <span className="rp-task-badge">{taskLabels[task] || task}</span>
                      <span className="rp-task-blocks">{blocks.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* By Task */}
        {d.by_task && Object.keys(d.by_task).length > 0 && (
          <div className="rp-block">
            <h3>By Task</h3>
            {Object.entries(d.by_task).map(([task, workers]) => (
              <div key={task} className="rp-row">
                <div className="rp-row-name rp-task-name">
                  <span className="rp-task-badge rp-task-badge--lg">{taskLabels[task] || task}</span>
                </div>
                <div className="rp-row-entries">
                  {Object.entries(workers).map(([w, blocks]) => (
                    <div key={w} className="rp-task-entry">
                      <span className="rp-worker-name">{w}</span>
                      <span className="rp-task-blocks">{blocks.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════
  // CALENDAR VIEW
  // ═══════════════════════════════════════════════════════════════════════
  const renderCalendar = () => {
    const { firstDay, daysInMonth } = getMonthDays(calYear, calMonth);
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const blanks = Array(firstDay).fill(null);
    const days   = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const prevMonth = () => {
      if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
      else setCalMonth(m => m - 1);
    };
    const nextMonth = () => {
      if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
      else setCalMonth(m => m + 1);
    };

    return (
      <div className="rp-cal-wrap">
        <div className="rp-cal-nav">
          <button className="rp-nav-btn" onClick={prevMonth}>‹</button>
          <span className="rp-cal-title">{MONTHS[calMonth - 1]} {calYear}</span>
          <button className="rp-nav-btn" onClick={nextMonth}>›</button>
        </div>
        <div className="rp-cal-grid">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
            <div key={d} className="rp-cal-dow">{d}</div>
          )}
          {blanks.map((_, i) => <div key={`b${i}`} className="rp-cal-cell rp-cal-cell--blank" />)}
          {days.map(day => {
            const ds = isoDate(calYear, calMonth, day);
            const hasReport = reportDateSet.has(ds);
            const isToday   = ds === today;
            const isActive  = selected?.report_date === ds;
            return (
              <div
                key={day}
                className={`rp-cal-cell ${hasReport ? 'rp-cal-cell--has' : ''} ${isToday ? 'rp-cal-cell--today' : ''} ${isActive ? 'rp-cal-cell--active' : ''}`}
                onClick={() => hasReport && openDate(ds)}
              >
                <span className="rp-cal-day">{day}</span>
                {hasReport && <span className="rp-cal-dot" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════
  const renderList = () => (
    <div className="rp-list">
      {allReports.length === 0 && <p className="rp-no-data">No reports yet.</p>}
      {allReports.map(r => (
        <div
          key={r.id}
          className={`rp-list-row ${selected?.report_date === r.report_date ? 'rp-list-row--active' : ''}`}
          onClick={() => openDate(r.report_date)}
        >
          <div className="rp-list-date">{fmtLong(r.report_date)}</div>
          <div className="rp-list-meta">
            <span className="rp-list-count">{r.total_entries} entries</span>
            <span className="rp-list-workers">{(r.workers || []).join(', ')}</span>
          </div>
        </div>
      ))}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // WEEKLY VIEW
  // ═══════════════════════════════════════════════════════════════════════
  const [weekData, setWeekData] = useState(null);

  const loadWeek = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await reports_api.getRange('week', { date: d }, currentTrackerId);
      setWeekData(res.data);
    } catch { }
    setLoading(false);
  }, [currentTrackerId]);

  useEffect(() => {
    if (view === 'Weekly') loadWeek(weekDate);
  }, [view, weekDate, loadWeek]);

  const shiftWeek = (dir) => {
    const d = new Date(weekDate);
    d.setDate(d.getDate() + dir * 7);
    setWeekDate(d.toISOString().split('T')[0]);
  };

  const renderWeekly = () => {
    if (loading) return <div className="rp-detail-empty"><span className="rp-spinner" /></div>;
    if (!weekData) return null;
    const { range, data } = weekData;
    const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const start = new Date(range.start + 'T00:00:00');

    return (
      <div className="rp-week-wrap">
        <div className="rp-week-nav">
          <button className="rp-nav-btn" onClick={() => shiftWeek(-1)}>‹ Prev</button>
          <span className="rp-week-title">
            {fmt(range.start)} — {fmt(range.end)}
          </span>
          <button className="rp-nav-btn" onClick={() => shiftWeek(1)}>Next ›</button>
        </div>
        <div className="rp-week-grid">
          {DAYS.map((dayLabel, i) => {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const ds = d.toISOString().split('T')[0];
            const report = data.find(r => r.report_date === ds);
            const rd = report?.data || {};
            return (
              <div key={i} className={`rp-week-col ${ds === today ? 'rp-week-col--today' : ''}`}>
                <div className="rp-week-col-header">
                  <span className="rp-week-dow">{dayLabel}</span>
                  <span className="rp-week-date">{pad(d.getMonth()+1)}/{pad(d.getDate())}</span>
                </div>
                {!report && <div className="rp-week-empty">—</div>}
                {report && Object.entries(rd.by_worker || {}).map(([worker, tasks]) => (
                  <div key={worker} className="rp-week-entry">
                    <div className="rp-week-worker">{worker}</div>
                    {Object.entries(tasks).map(([task, blocks]) => (
                      <div key={task} className="rp-week-task">
                        <span className="rp-task-badge rp-task-badge--sm">{taskLabels[task] || task}</span>
                        <span className="rp-week-blocks">{blocks.length} block{blocks.length !== 1 ? 's' : ''}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════
  // MONTHLY VIEW
  // ═══════════════════════════════════════════════════════════════════════
  const [monthData, setMonthData] = useState(null);

  const loadMonth = useCallback(async (y, m) => {
    setLoading(true);
    try {
      const res = await reports_api.getRange('month', { year: y, month: m }, currentTrackerId);
      setMonthData(res.data);
    } catch { }
    setLoading(false);
  }, [currentTrackerId]);

  useEffect(() => {
    if (view === 'Monthly') loadMonth(monthYear, monthMonth);
  }, [view, monthYear, monthMonth, loadMonth]);

  const shiftMonth = (dir) => {
    let m = monthMonth + dir;
    let y = monthYear;
    if (m < 1)  { m = 12; y--; }
    if (m > 12) { m = 1;  y++; }
    setMonthMonth(m); setMonthYear(y);
  };

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  const renderMonthly = () => {
    if (loading) return <div className="rp-detail-empty"><span className="rp-spinner" /></div>;
    if (!monthData) return null;
    const { data } = monthData;

    // aggregate workers + task counts across month
    const workerTotals = {};
    const taskTotals   = {};
    for (const r of data) {
      const rd = r.data || {};
      for (const [worker, tasks] of Object.entries(rd.by_worker || {})) {
        if (!workerTotals[worker]) workerTotals[worker] = {};
        for (const [task, blocks] of Object.entries(tasks)) {
          workerTotals[worker][task] = (workerTotals[worker][task] || 0) + blocks.length;
          taskTotals[task] = (taskTotals[task] || 0) + blocks.length;
        }
      }
    }

    return (
      <div className="rp-month-wrap">
        <div className="rp-month-nav">
          <button className="rp-nav-btn" onClick={() => shiftMonth(-1)}>‹ Prev</button>
          <span className="rp-month-title">{MONTH_NAMES[monthMonth - 1]} {monthYear}</span>
          <button className="rp-nav-btn" onClick={() => shiftMonth(1)}>Next ›</button>
        </div>
        <div className="rp-month-stats">
          <div className="rp-month-stat">
            <span className="rp-stat-val">{data.length}</span>
            <span className="rp-stat-label">Days worked</span>
          </div>
          <div className="rp-month-stat">
            <span className="rp-stat-val">{Object.keys(workerTotals).length}</span>
            <span className="rp-stat-label">Workers</span>
          </div>
          <div className="rp-month-stat">
            <span className="rp-stat-val">
              {Object.values(taskTotals).reduce((a, b) => a + b, 0)}
            </span>
            <span className="rp-stat-label">Total block-tasks</span>
          </div>
        </div>

        {/* Per-worker breakdown */}
        {Object.keys(workerTotals).length === 0 && (
          <p className="rp-no-data">No work logged this month.</p>
        )}
        {Object.entries(workerTotals).map(([worker, tasks]) => (
          <div key={worker} className="rp-month-worker-card">
            <div className="rp-month-worker-name">{worker}</div>
            <div className="rp-month-task-list">
              {Object.entries(tasks).map(([task, count]) => (
                <div key={task} className="rp-month-task-row">
                  <span className="rp-task-badge">{taskLabels[task] || task}</span>
                  <span className="rp-month-count">{count} block-task{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Day-by-day list */}
        {data.length > 0 && (
          <div className="rp-month-days">
            <h3>Day-by-Day</h3>
            {data.map(r => (
              <div
                key={r.id}
                className={`rp-list-row ${selected?.report_date === r.report_date ? 'rp-list-row--active' : ''}`}
                onClick={() => { setView('Calendar'); openDate(r.report_date); }}
              >
                <div className="rp-list-date">{fmtLong(r.report_date)}</div>
                <div className="rp-list-meta">
                  <span className="rp-list-count">{(r.data?.total_entries) || 0} entries</span>
                  <span className="rp-list-workers">{(r.data?.worker_names || []).join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const totalEntries = allReports.reduce((sum, report) => sum + (report.total_entries || 0), 0);
  const workerCount = new Set(allReports.flatMap((report) => report.workers || [])).size;
  const subtitle = trackerSettings?.ui_text?.sub_dashboard
    || 'Review daily output, weekly activity, and monthly rollups without leaving the current tracker context.';

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE LAYOUT
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="reports-page reports-shell">
      <section className="container rp-hero">
        <div>
          <span className="dashboard-kicker">{currentTracker?.name || 'Tracker'} Reports</span>
          <h1 className="section-title">Daily Reports</h1>
          <p className="rp-hero-copy">{subtitle}</p>
        </div>
        <div className="rp-hero-grid">
          <div className="rp-hero-card">
            <span>Saved Reports</span>
            <strong>{allReports.length}</strong>
          </div>
          <div className="rp-hero-card">
            <span>Total Entries</span>
            <strong>{totalEntries}</strong>
          </div>
          <div className="rp-hero-card">
            <span>Workers Seen</span>
            <strong>{workerCount}</strong>
          </div>
          <div className="rp-hero-card">
            <span>View</span>
            <strong>{view}</strong>
          </div>
        </div>
      </section>

      <div className="container rp-topbar">
        <div className="rp-topbar-copy">
          <span className="dashboard-kicker">Insights</span>
          <h2 className="section-title">Browse by day, week, or month</h2>
        </div>
        <div className="rp-tabs">
          {VIEWS.map(v => (
            <button
              key={v}
              className={`rp-tab ${view === v ? 'rp-tab--active' : ''}`}
              onClick={() => setView(v)}
            >{v}</button>
          ))}
        </div>
      </div>

      {(view === 'Calendar' || view === 'List') ? (
        <div className="rp-split">
          <div className="rp-left container">
            {view === 'Calendar' && renderCalendar()}
            {view === 'List'     && renderList()}
          </div>
          <div className="rp-right container">
            {renderDetail()}
          </div>
        </div>
      ) : (
        <div className="rp-full container">
          {view === 'Weekly'  && renderWeekly()}
          {view === 'Monthly' && renderMonthly()}
        </div>
      )}
    </div>
  );
}
