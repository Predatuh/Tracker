// API helper functions
const APP_VERSION = '2.1.1';
console.log('%c[Princess Trackers] v' + APP_VERSION, 'color:#00d4ff;font-weight:bold');
const DEBUG_API = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const SESSION_CROWN_KEY = 'site_random_crown_asset';
const CROWN_ASSET_PATHS = [
  '/static/animations/crown1-alpha.webm',
  '/static/animations/crown2-alpha.webm',
  '/static/animations/crown3-alpha.webm'
];

function getTrackerDisplayName(trackerOrName) {
  const rawName = typeof trackerOrName === 'string'
    ? trackerOrName
    : (trackerOrName && trackerOrName.name) || '';
  const trimmed = String(rawName || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/\s+tracker$/i, '').trim();
  return stripped || trimmed;
}

function getPowerBlockCountLabel(count) {
  return Number(count) === 1 ? 'LBD' : 'LBDs';
}

function getLbdDisplayLabel(lbd) {
  if (!lbd) return 'LBD';
  return lbd.identifier || lbd.name || (lbd.id ? `LBD ${lbd.id}` : 'LBD');
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const api = {
  async call(endpoint, options = {}) {
    const url = `/api${endpoint}`;
    const defaultOptions = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      ...options
    };
    
    if (DEBUG_API) console.log(`API Call: ${endpoint}`, defaultOptions.body);
    
    const response = await fetch(url, defaultOptions);
    const data = await response.json();
    
    if (DEBUG_API) console.log(`API Response (${endpoint}):`, data);
    
    if (!response.ok) {
      const errorMsg = data.error || `HTTP ${response.status}`;
      if (DEBUG_API) console.error(`API Error: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return data;
  },

  // Helper: append tracker_id to a URL
  _tq(endpoint) {
    if (!currentTracker) return endpoint;
    const sep = endpoint.includes('?') ? '&' : '?';
    return `${endpoint}${sep}tracker_id=${currentTracker.id}`;
  },

  uploadPDF(file) {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/pdf/upload', {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  extractPages(pdfPath, pages) {
    return this.call('/pdf/extract-pages', {
      method: 'POST',
      body: JSON.stringify({ pdf_path: pdfPath, page_numbers: pages })
    });
  },

  createPowerBlocks(pages) {
    return this.call('/pdf/create-power-blocks', {
      method: 'POST',
      body: JSON.stringify({ pages })
    });
  },

  scanLBDs(pdfPath) {
    return this.call('/pdf/scan-lbds', {
      method: 'POST',
      body: JSON.stringify({ pdf_path: pdfPath })
    });
  },

  getScanStatus() {
    return this.call('/pdf/scan-status');
  },

  getPowerBlocks() {
    return this.call(this._tq('/tracker/power-blocks'));
  },

  getPowerBlock(id, trackerId = null) {
    const resolvedTrackerId = trackerId ?? currentTracker?.id ?? null;
    const query = resolvedTrackerId ? `?tracker_id=${encodeURIComponent(resolvedTrackerId)}` : '';
    return this.call(`/tracker/power-blocks/${id}${query}`);
  },

  createLBD(data) {
    if (currentTracker) data.tracker_id = currentTracker.id;
    return this.call('/tracker/lbds', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  updateLBDStatus(lbdId, statusType, data) {
    return this.call(`/tracker/lbds/${lbdId}/status/${statusType}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // ---- Admin API (tracker-aware) ----
  getAdminSettings() { return this.call(this._tq('/admin/settings')); },
  getAuditLogs(limit = 100) { return this.call(`/admin/audit-logs?limit=${limit}`); },
  saveZoneNames(names) { return this.call(this._tq('/admin/settings/zone-names'), { method:'PUT', body: JSON.stringify({names}) }); },
  saveAppearance(appearance) { return this.call('/admin/settings/appearance', { method:'PUT', body: JSON.stringify({appearance}) }); },
  saveUIText(ui_text) { return this.call('/admin/settings/ui-text', { method:'PUT', body: JSON.stringify({ui_text}) }); },
  saveClaimPeople(people) { return this.call('/admin/settings/claim-people', { method:'PUT', body: JSON.stringify({people}) }); },
  saveAdminColors(colors) {
    const body = { colors };
    if (currentTracker) body.tracker_id = currentTracker.id;
    return this.call('/admin/settings/colors', { method:'PUT', body: JSON.stringify(body) });
  },
  saveAdminNames(names) {
    const body = { names };
    if (currentTracker) body.tracker_id = currentTracker.id;
    return this.call('/admin/settings/names', { method:'PUT', body: JSON.stringify(body) });
  },
  addAdminColumn(key, label, color) {
    const body = { key, label, color };
    if (currentTracker) body.tracker_id = currentTracker.id;
    return this.call('/admin/settings/columns', { method:'POST', body: JSON.stringify(body) });
  },
  deleteAdminColumn(key) {
    return this.call(this._tq(`/admin/settings/columns/${key}`), { method:'DELETE' });
  },
  saveAdminFontSize(size) {
    return this.call('/admin/settings/font-size', { method:'PUT', body: JSON.stringify({size}) });
  },
  saveColumnOrder(order) {
    const body = { order };
    if (currentTracker) body.tracker_id = currentTracker.id;
    return this.call('/admin/settings/column-order', { method:'PUT', body: JSON.stringify(body) });
  },
  bulkComplete(powerBlockId, statusTypes, isCompleted) {
    return this.call('/admin/bulk-complete', { method:'POST',
      body: JSON.stringify({ power_block_id: powerBlockId, status_types: statusTypes, is_completed: isCompleted })
    });
  },
  getClaimPeople() {
    return this.call('/tracker/claim-people');
  },
  claimBlock(blockId, action, people = [], assignments = {}, workDate = null) {
    const body = { action, people, assignments };
    if (workDate) body.work_date = workDate;
    if (currentTracker) body.tracker_id = currentTracker.id;
    return this.call(`/tracker/power-blocks/${blockId}/claim`, {
      method:'POST',
      body: JSON.stringify(body)
    });
  },
  bulkClaimBlocks(blockIds, action, people = [], assignmentsByBlock = {}, statusTypes = [], workDate = null) {
    const body = { block_ids: blockIds, action, people, assignments_by_block: assignmentsByBlock, status_types: statusTypes };
    if (workDate) body.work_date = workDate;
    if (currentTracker) body.tracker_id = currentTracker.id;
    return this.call('/tracker/power-blocks/bulk-claim', {
      method:'POST',
      body: JSON.stringify(body)
    });
  },
  draftClaimScan(payload) {
    return this.call('/reports/claim-scan/draft', {
      method:'POST',
      body: JSON.stringify(payload)
    });
  },
  submitClaimScan(payload) {
    return this.call('/reports/claim-scan/submit', {
      method:'POST',
      body: JSON.stringify(payload)
    });
  },
  backfillClaimActivity(payload) {
    return this.call('/reports/claim-activities/backfill', {
      method:'POST',
      body: JSON.stringify(payload)
    });
  },
  getReviews(dateStr = null) {
    const endpoint = dateStr ? `/reviews?date=${encodeURIComponent(dateStr)}` : '/reviews';
    return this.call(this._tq(endpoint));
  },
  submitReview(payload) {
    return this.call('/reviews', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  submitBulkReviews(payload) {
    return this.call('/reviews/bulk', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  getReviewReports() {
    return this.call(this._tq('/review-reports'));
  },
  getReviewReportByDate(dateStr) {
    return this.call(this._tq(`/review-reports/date/${dateStr}`));
  },
  generateReviewReport(payload = {}) {
    return this.call('/review-reports/generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // ---- Tracker API ----
  getTrackers() { return this.call('/admin/trackers'); },
  createTracker(data) { return this.call('/admin/trackers', { method:'POST', body: JSON.stringify(data) }); },
  updateTracker(id, data) { return this.call(`/admin/trackers/${id}`, { method:'PUT', body: JSON.stringify(data) }); },
  deleteTracker(id) { return this.call(`/admin/trackers/${id}`, { method:'DELETE' }); },

  // ---- Map scan API ----
  scanMap(mapId, expectedCount) {
    const qs = expectedCount ? `?expected_count=${expectedCount}` : '';
    return this.call(`/map/scan/${mapId}${qs}`, { method:'POST' });
  },
  getSiteMap(mapId) { return this.call(`/map/sitemap/${mapId}`); },
  createSiteArea(data) { return this.call('/map/area', { method:'POST', body: JSON.stringify(data) }); },
  updateSiteArea(areaId, data) { return this.call(`/map/area/${areaId}`, { method:'PUT', body: JSON.stringify(data) }); },
  deleteSiteArea(areaId) { return this.call(`/map/area/${areaId}`, { method:'DELETE' }); },
  deleteAllAreas(mapId) { return this.call(`/map/areas/${mapId}`, { method:'DELETE' }); },
  deleteSiteMap(mapId) { return this.call(`/map/sitemap/${mapId}`, { method:'DELETE' }); },
  getAllSiteMaps() { return this.call('/map/sitemaps'); },
  registerExistingMap(localPath) {
    const body = localPath ? JSON.stringify({local_path: localPath}) : '{}';
    return this.call('/map/register-existing', { method:'POST', body });
  },

  // ---- Snap-to-outline API ----
  snapOutline(mapId, x_pct, y_pct) {
    return this.call(`/map/snap-outline/${mapId}`, { method:'POST', body: JSON.stringify({ x_pct, y_pct }) });
  },
  syncPositions(mapId, bboxes = {}, labelOffsets = {}) {
    return this.call('/map/sync-positions', { method:'POST', body: JSON.stringify({ map_id: mapId, bboxes, label_offsets: labelOffsets }) });
  }
};

// ============================================================
// TRACKER MANAGEMENT
// ============================================================
let allTrackers = [];
let currentTracker = null;   // active Tracker object {id, name, slug, ...}
let trackerWasExplicitlyChosen = false;

function pickRandomCrownAsset() {
  return CROWN_ASSET_PATHS[Math.floor(Math.random() * CROWN_ASSET_PATHS.length)];
}

function getSelectedCrownAsset() {
  try {
    const saved = sessionStorage.getItem(SESSION_CROWN_KEY);
    if (saved && CROWN_ASSET_PATHS.includes(saved)) return saved;
  } catch (e) {}
  const picked = pickRandomCrownAsset();
  try { sessionStorage.setItem(SESSION_CROWN_KEY, picked); } catch (e) {}
  return picked;
}

function assignSessionCrown(forceNew = false) {
  let selected = null;
  if (!forceNew) {
    selected = getSelectedCrownAsset();
  } else {
    selected = pickRandomCrownAsset();
    try { sessionStorage.setItem(SESSION_CROWN_KEY, selected); } catch (e) {}
  }

  document.querySelectorAll('.js-random-crown').forEach((video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.dataset.crownSrc === selected) return;
    video.dataset.crownSrc = selected;
    video.src = selected;
    video.load();
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  });
}

async function loadTrackers() {
  try {
    const r = await api.call('/admin/trackers');
    allTrackers = r.data || [];
    syncActiveTracker();
    renderHeaderTrackerSwitcher();
  } catch(e) { console.warn('Failed to load trackers:', e); }
}

function syncActiveTracker(forceSelection = false) {
  if (!Array.isArray(allTrackers) || !allTrackers.length) {
    currentTracker = null;
    trackerWasExplicitlyChosen = false;
    return null;
  }

  if (currentTracker) {
    const matchingTracker = allTrackers.find(t => Number(t.id) === Number(currentTracker.id));
    if (matchingTracker) {
      currentTracker = matchingTracker;
      return currentTracker;
    }
  }

  const activePage = document.querySelector('.page.active');
  const allowNoTrackerState = activePage && activePage.id === 'page-sitemap';
  if (!forceSelection && allowNoTrackerState) {
    currentTracker = null;
    trackerWasExplicitlyChosen = false;
    return null;
  }

  currentTracker = allTrackers[0] || null;
  trackerWasExplicitlyChosen = false;
  return currentTracker;
}

function renderHeaderTrackerSwitcher() {
  const shell = document.getElementById('header-tracker-switcher');
  const select = document.getElementById('header-tracker-select');
  if (!shell || !select) return;

  const activePage = document.querySelector('.page.active');
  const hideOnDashboard = !activePage || activePage.id === 'page-dashboard';
  const allowNoTrackerState = activePage && activePage.id === 'page-sitemap';
  if (allTrackers.length <= 0 || hideOnDashboard || (!allowNoTrackerState && !currentTracker)) {
    shell.style.display = 'none';
    return;
  }

  select.innerHTML = [
    allowNoTrackerState ? '<option value="">Overview (No Tracker)</option>' : '',
    ...allTrackers.map((tracker) => {
    const selected = currentTracker && Number(currentTracker.id) === Number(tracker.id) ? ' selected' : '';
    return `<option value="${tracker.id}"${selected}>${_escapeHtml(getTrackerDisplayName(tracker))}</option>`;
    })
  ].join('');
  select.value = currentTracker ? String(currentTracker.id) : '';
  shell.style.display = 'flex';
}

function updateTrackerCrumb() {
  const crumb = document.getElementById('active-tracker-crumb');
  if (crumb) crumb.style.display = 'none';
}

const ADMIN_PAGE_PERMISSIONS = ['manage_trackers', 'manage_tracker_names', 'manage_columns', 'manage_tasks', 'manage_workers', 'manage_ui', 'edit_map'];
const ADMIN_TAB_PERMISSIONS = {
  colors: ['manage_ui'],
  names: ['manage_tracker_names'],
  columns: ['manage_columns', 'manage_tasks'],
  trackers: ['manage_trackers'],
  maplabels: ['manage_ui'],
  zones: ['edit_map'],
  claimcrew: ['manage_workers'],
  claimhistory: ['admin_settings'],
  lbddata: null,
  users: null,
  audit: null,
  appearance: ['manage_ui'],
  uilabels: ['manage_ui'],
  updates: null,
};

function currentUserRole() {
  if (!currentUser) return 'worker';
  if (currentUser.is_admin) return 'admin';
  return currentUser.role || 'worker';
}

function currentUserPermissions() {
  return currentUser ? (currentUser.permissions || []) : [];
}

function currentUserCan(permission) {
  if (!currentUser) return false;
  if (currentUser.is_admin) return true;
  if (!permission) return true;
  return currentUserPermissions().includes(permission);
}

function currentUserCanAny(permissions = []) {
  if (!currentUser) return false;
  if (currentUser.is_admin) return true;
  return (permissions || []).some(permission => currentUserCan(permission));
}

function currentUserCanAccessAdminPage() {
  return currentUserCanAny(ADMIN_PAGE_PERMISSIONS);
}

function currentUserRoleLabel() {
  if (!currentUser) return 'Worker';
  return currentUser.role_label || (currentUser.is_admin ? 'Admin' : 'Worker');
}

function adminTabVisible(tabKey) {
  if (currentUserCan('manage_ui') && currentUser.is_admin) return true;
  const required = ADMIN_TAB_PERMISSIONS[tabKey];
  if (required === null) return !!(currentUser && currentUser.is_admin);
  return currentUserCanAny(required);
}

function adminDefaultTabKey() {
  const orderedTabs = ['trackers', 'names', 'columns', 'claimcrew', 'claimhistory', 'zones', 'colors', 'appearance', 'uilabels', 'users', 'audit', 'updates'];
  return orderedTabs.find(tabKey => adminTabVisible(tabKey)) || 'trackers';
}

function syncAdminTabVisibility() {
  Object.keys(ADMIN_TAB_PERMISSIONS).forEach((tabKey) => {
    const button = document.getElementById('atab-' + tabKey);
    if (button) {
      button.style.display = adminTabVisible(tabKey) ? '' : 'none';
    }
  });
}

async function switchTracker(trackerId) {
  if (trackerId === '' || trackerId == null) {
    currentTracker = null;
    trackerWasExplicitlyChosen = false;
    await loadAdminSettings().catch(() => {});
    updateTrackerCrumb();
    renderHeaderTrackerSwitcher();
    const activePage = document.querySelector('.page.active');
    if (activePage) {
      const name = activePage.id.replace('page-', '');
      showPage(name);
    }
    return;
  }
  const t = allTrackers.find(t => t.id == trackerId);
  if (!t) return;
  currentTracker = t;
  trackerWasExplicitlyChosen = true;
  await loadAdminSettings();
  updateTrackerCrumb();
  renderHeaderTrackerSwitcher();
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const name = activePage.id.replace('page-', '');
    showPage(name);
  }
}

// Page navigation
function showPage(pageName) {
  // Enforce permission checks for restricted pages
  if (pageName === 'upload' && !currentUserCan('upload_pdf')) {
    return;  // block access
  }
  if (pageName === 'admin' && !currentUserCanAccessAdminPage()) {
    return;
  }
  if (pageName === 'review' && !currentUserCan('admin_settings')) {
    return;
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show selected page
  document.getElementById(`page-${pageName}`).classList.add('active');

  updateTrackerCrumb();
  renderHeaderTrackerSwitcher();

  // Load data for the page
  if (pageName === 'dashboard') loadDashboard();
  if (pageName === 'blocks') loadBlocks();
  if (pageName === 'sitemap') loadSiteMap();
  if (pageName === 'admin') loadAdminPage();
  if (pageName === 'claim') loadClaimPage();
  if (pageName === 'reports') loadReportsPage();
  if (pageName === 'review') loadReviewPage();
}

function openSiteMap(resetTracker = false) {
  if (resetTracker || !trackerWasExplicitlyChosen) {
    currentTracker = null;
    trackerWasExplicitlyChosen = false;
    loadAdminSettings().catch(() => {});
  }
  updateTrackerCrumb();
  renderHeaderTrackerSwitcher();
  showPage('sitemap');
}

// Modal functions
function closeModal() {
  document.getElementById('block-modal').classList.add('hidden');
}

function _escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showBlockModal(blockId) {
  api.getPowerBlock(blockId)
    .then(response => {
      const block = response.data;
      let html = `
        <h2>${block.name}</h2>
        ${block.image_path ? `<img src="${block.image_path}" style="max-width: 100%; max-height: 400px; margin: 20px 0;" />` : ''}
        
        <h3>LBDs (<span id="lbd-count">${block.lbd_count || 0}</span>)</h3>
        <div id="lbds-container" style="margin-bottom: 20px;"></div>
        
        <h3>Add New LBD</h3>
        <form onsubmit="event.preventDefault(); addLBD(${blockId})">
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="new-lbd-name" required />
          </div>
          <div class="form-group">
            <label>Identifier</label>
            <input type="text" id="new-lbd-id" />
          </div>
          <button type="submit" class="btn btn-success">Add LBD</button>
        </form>
      `;
      
      document.getElementById('modal-body').innerHTML = html;
      document.getElementById('block-modal').classList.remove('hidden');
      
      // Load LBDs
      loadBlockLBDs(blockId);
    })
    .catch(err => alert('Error: ' + err.message));
}

function loadBlockLBDs(blockId) {
  api.getPowerBlock(blockId)
    .then(response => {
      const block = response.data;
      let html = '';

      // Bulk action bar
      html += `<div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:10px;color:#4a5568;margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Bulk Actions</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
          ${LBD_STATUS_TYPES.map(st => `
            <span style="font-size:10px;display:inline-flex;align-items:center;gap:2px;">
              <button onclick="bulkCompleteColumn(${blockId},'${st}',true)" title="Complete all ${STATUS_LABELS[st]||st}"
                style="background:${STATUS_COLORS[st]||'#888'};color:#000;border:none;border-radius:3px 0 0 3px;padding:3px 6px;cursor:pointer;font-size:10px;font-weight:700;">✓</button>
              <button onclick="bulkCompleteColumn(${blockId},'${st}',false)" title="Clear all ${STATUS_LABELS[st]||st}"
                style="background:rgba(255,255,255,0.08);color:#8892b0;border:none;border-radius:0 3px 3px 0;padding:3px 6px;cursor:pointer;font-size:10px;">○</button>
              <span style="font-size:10px;color:#8892b0;">${STATUS_LABELS[st]||st}</span>
            </span>
          `).join('')}
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="bulkCompleteAll(${blockId},true)" style="background:rgba(0,232,122,0.15);color:#00e87a;border:1px solid rgba(0,232,122,0.3);border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700;">✓ Complete Entire PB</button>
          <button onclick="bulkCompleteAll(${blockId},false)" style="background:rgba(255,76,106,0.1);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700;">○ Clear Entire PB</button>
        </div>
      </div>`;

      // ── Claimed / audit banner ─────────────────────────────
      html += _buildClaimedBanner(block);

      if (block.lbd_count === 0) {
        html += '<p style="color:#4a5568;text-align:center;padding:30px 0;">No LBDs yet</p>';
      } else {
        block.lbds.forEach(lbd => {
          html += `
            <div class="lbd-item" style="border: 1px solid rgba(255,255,255,0.08); padding: 12px; margin-bottom: 10px; border-radius: 8px; background:rgba(255,255,255,0.03);">
              <strong style="color:#eef2ff;font-size:13px;">${lbd.identifier || lbd.name}</strong>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 5px; margin-top: 10px;">
                ${LBD_STATUS_TYPES.map(st => {
                  const s = lbd.statuses ? lbd.statuses.find(x => x.status_type === st) : null;
                  const done = s ? s.is_completed : false;
                  const col = STATUS_COLORS[st] || '#888';
                  const byLine = (done && s && s.completed_by)
                    ? '<span style="display:block;font-size:9px;opacity:0.9;margin-top:2px;line-height:1.3;">' + s.completed_by + '<br>' + _fmtDate(s.completed_at) + '</span>'
                    : '';
                  return '<button id="status-btn-' + lbd.id + '-' + st + '"'
                    + ' onclick="toggleStatus(' + lbd.id + ', \'' + st + '\', ' + done + ', ' + blockId + ')"'
                    + ' style="background-color:' + (done ? col : '#f0f0f0') + ';color:' + (done ? 'white' : '#333') + ';padding:5px;border:none;border-radius:3px;cursor:pointer;font-size:11px;line-height:1.4;">'
                    + (done ? '✓' : '○') + ' ' + (STATUS_LABELS[st] || st.replace(/_/g,' ')) + byLine
                    + '</button>';
                }).join('')}
              </div>
            </div>
          `;
        });
      }
      
      document.getElementById('lbds-container').innerHTML = html;
    });
}

async function bulkCompleteColumn(blockId, statusType, complete) {
  try {
    await api.bulkComplete(blockId, [statusType], complete);
    loadBlockLBDs(blockId);
  } catch(e) { alert('Error: ' + e.message); }
}

async function bulkCompleteAll(blockId, complete) {
  try {
    await api.bulkComplete(blockId, LBD_STATUS_TYPES, complete);
    loadBlockLBDs(blockId);
  } catch(e) { alert('Error: ' + e.message); }
}

function _normalizeAllowedClaimStatusTypes(allowedStatusTypes = null) {
  const source = Array.isArray(allowedStatusTypes) && allowedStatusTypes.length
    ? allowedStatusTypes
    : claimStatusTypesForCurrentTracker();
  return new Set((source || []).map((statusType) => String(statusType || '').trim()).filter(Boolean));
}

function _getClaimAssignments(block, allowedStatusTypes = null) {
  const merged = {};
  const allowedTypes = _normalizeAllowedClaimStatusTypes(allowedStatusTypes);
  const pushIds = (statusType, lbdIds) => {
    const key = String(statusType || '').trim();
    if (!key || !Array.isArray(lbdIds)) return;
    if (allowedTypes.size && !allowedTypes.has(key)) return;
    if (!merged[key]) merged[key] = [];
    const seen = new Set(merged[key]);
    lbdIds.forEach((lbdId) => {
      const normalizedId = Number(lbdId);
      if (!Number.isFinite(normalizedId) || seen.has(normalizedId)) return;
      seen.add(normalizedId);
      merged[key].push(normalizedId);
    });
  };

  if (block && typeof block.claim_assignments === 'object' && block.claim_assignments !== null) {
    Object.entries(block.claim_assignments).forEach(([statusType, lbdIds]) => pushIds(statusType, lbdIds));
  }

  if (block && Array.isArray(block.lbds)) {
    block.lbds.forEach((lbd) => {
      (lbd.statuses || []).forEach((status) => {
        if (!status || !status.is_completed) return;
        pushIds(status.status_type, [lbd.id]);
      });
    });
  }

  return merged;
}

function _buildClaimAssignmentSummary(block, allowedStatusTypes = null) {
  const assignments = _getClaimAssignments(block, allowedStatusTypes);
  const summary = Object.entries(assignments)
    .map(([statusType, lbdIds]) => {
      const count = Array.isArray(lbdIds) ? lbdIds.length : 0;
      if (!count) return '';
      const label = STATUS_LABELS[statusType] || statusType.replace(/_/g, ' ');
      return `${label}: ${count}`;
    })
    .filter(Boolean);

  if (!summary.length) {
    return '';
  }

  return '<div style="margin-top:6px;color:#334155;font-size:11px;">Assigned work: ' + _escapeHtml(summary.join(' • ')) + '</div>';
}

function _dedupeClaimNames(names) {
  const seen = new Set();
  return (names || [])
    .map((name) => String(name || '').trim())
    .filter((name) => {
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function _filterAllowedClaimNames(names, allowedNames = []) {
  const allowedLookup = new Set((allowedNames || []).map((name) => String(name || '').trim().toLowerCase()).filter(Boolean));
  return _dedupeClaimNames(names).filter((name) => allowedLookup.has(String(name || '').trim().toLowerCase()));
}

function _readSharedClaimCrew(overlay) {
  if (!overlay) return [];
  const checked = Array.from(overlay.querySelectorAll('.claim-person-option:checked'))
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);
  const extras = claimParseCrewNames(overlay.querySelector('#claim-extra-names')?.value || '');
  return _filterAllowedClaimNames([...checked, ...extras], claimPageState.peopleSuggestions);
}

function _collectClaimAssignmentDraft(overlay, block) {
  const assignments = {};
  const taskCrews = {};

  if (overlay) {
    overlay.querySelectorAll('.claim-lbd-option:checked').forEach((input) => {
      const statusType = String(input.dataset.statusType || '').trim();
      const lbdId = Number(input.value);
      if (!statusType || !Number.isFinite(lbdId)) return;
      if (!assignments[statusType]) assignments[statusType] = [];
      assignments[statusType].push(lbdId);
    });

    overlay.querySelectorAll('.claim-task-crew').forEach((textarea) => {
      const statusType = String(textarea.dataset.statusType || '').trim();
      if (!statusType) return;
      const names = _filterAllowedClaimNames(claimParseCrewNames(textarea.value || ''), claimPageState.peopleSuggestions);
      if (names.length) {
        taskCrews[statusType] = names;
      }
    });
  }

  return { assignments, taskCrews };
}

function claimToggleTaskLbdSelection(statusType, shouldSelect) {
  const overlay = document.getElementById('claim-people-overlay');
  if (!overlay) return;
  overlay.querySelectorAll(`.claim-lbd-option[data-status-type="${statusType}"]`).forEach((input) => {
    if (input.disabled) return;
    input.checked = Boolean(shouldSelect);
  });
}

function claimAppendTaskCrew(statusType, name) {
  const overlay = document.getElementById('claim-people-overlay');
  if (!overlay) return;
  const textarea = overlay.querySelector(`.claim-task-crew[data-status-type="${statusType}"]`);
  if (!textarea) return;
  const nextNames = _filterAllowedClaimNames([...claimParseCrewNames(textarea.value || ''), String(name || '').trim()], claimPageState.peopleSuggestions);
  textarea.value = nextNames.join(', ');
}

function claimUseSharedCrewForTask(statusType) {
  const overlay = document.getElementById('claim-people-overlay');
  if (!overlay) return;
  const textarea = overlay.querySelector(`.claim-task-crew[data-status-type="${statusType}"]`);
  if (!textarea) return;
  const nextNames = _dedupeClaimNames([...claimParseCrewNames(textarea.value || ''), ..._readSharedClaimCrew(overlay)]);
  textarea.value = nextNames.join(', ');
}

function _renderClaimAssignmentSections(overlay, block, suggestions = []) {
  const container = overlay.querySelector('#claim-assignment-sections');
  if (!container) return;

  const selectedTypes = Array.from(overlay.querySelectorAll('.claim-status-type:checked')).map(input => input.value);
  if (!selectedTypes.length) {
    container.innerHTML = '<div style="color:#94a3b8;font-size:12px;">Select one or more work types if you want to claim specific LBDs.</div>';
    return;
  }

  const draft = _collectClaimAssignmentDraft(overlay, block);
  const existingAssignments = _getClaimAssignments(block, selectedTypes);
  const lbds = Array.isArray(block.lbds) ? [...block.lbds] : [];
  lbds.sort((left, right) => String(left.identifier || left.name || '').localeCompare(String(right.identifier || right.name || '')));

  container.innerHTML = selectedTypes.map(statusType => {
    const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
    const completedIds = new Set(Array.isArray(existingAssignments[statusType]) ? existingAssignments[statusType].map(Number) : []);
    const selectedIds = new Set(
      Array.isArray(draft.assignments[statusType])
        ? draft.assignments[statusType].map(Number)
        : []
    );
    const taskCrewText = Array.isArray(draft.taskCrews[statusType]) ? draft.taskCrews[statusType].join(', ') : '';
    const suggestionButtons = suggestions.slice(0, 8).map((name) => {
      const encodedName = encodeURIComponent(String(name));
      return `<button type="button" class="btn btn-secondary" onclick="claimAppendTaskCrew('${_escapeHtml(statusType)}', decodeURIComponent('${encodedName}'))" style="padding:5px 9px;font-size:11px;">${_escapeHtml(name)}</button>`;
    }).join('');
    const options = lbds.map(lbd => {
      const lbdId = Number(lbd.id);
      const checked = selectedIds.has(lbdId) ? 'checked' : '';
      const alreadyClaimed = completedIds.has(lbdId);
      const disabled = alreadyClaimed ? 'disabled' : '';
      const name = _escapeHtml(lbd.identifier || lbd.name || `LBD ${lbd.id}`);
      const badge = alreadyClaimed
        ? '<span style="margin-left:auto;color:#8adfff;font-size:11px;">Already claimed</span>'
        : '';
      return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;">
        <input type="checkbox" class="claim-lbd-option" data-status-type="${_escapeHtml(statusType)}" value="${lbd.id}" ${checked} ${disabled} />
        <span style="color:#eef2ff;font-size:12px;">${name}</span>
        ${badge}
      </label>`;
    }).join('');

    return `<div style="margin-top:14px;padding:12px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="color:#eef2ff;font-size:13px;font-weight:700;">${label}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" onclick="claimUseSharedCrewForTask('${_escapeHtml(statusType)}')" style="padding:5px 10px;font-size:11px;">Use Shared Crew</button>
          <button type="button" class="btn btn-secondary" onclick="claimToggleTaskLbdSelection('${_escapeHtml(statusType)}', true)" style="padding:5px 10px;font-size:11px;">Select All</button>
          <button type="button" class="btn btn-secondary" onclick="claimToggleTaskLbdSelection('${_escapeHtml(statusType)}', false)" style="padding:5px 10px;font-size:11px;">Clear</button>
        </div>
      </div>
      <div style="margin-top:12px;">
        <label style="display:block;color:#cbd5e1;font-size:12px;margin-bottom:6px;">Crew for this task</label>
        <textarea class="claim-task-crew claim-modal-textarea" data-status-type="${_escapeHtml(statusType)}" rows="2" placeholder="Names for the crew that handled ${label}" style="width:100%;resize:vertical;">${_escapeHtml(taskCrewText)}</textarea>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">${suggestionButtons || '<span style="color:#64748b;font-size:12px;">No saved crew suggestions yet.</span>'}</div>
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <label style="display:block;color:#cbd5e1;font-size:12px;">LBD selection for this task</label>
        <div style="color:#94a3b8;font-size:11px;">${selectedIds.size} selected</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
        ${options || '<div style="color:#94a3b8;font-size:12px;">No LBDs found for this block.</div>'}
      </div>
    </div>`;
  }).join('');
}

function claimStatusTypesForCurrentTracker() {
  const types = Array.isArray(currentTracker?.status_types) ? currentTracker.status_types.map((value) => String(value || '').trim()).filter(Boolean) : [];
  return types.length ? types : LBD_STATUS_TYPES;
}

async function claimBlock(blockId, action, people = [], assignments = {}, workDate = null) {
  try {
    const response = await api.claimBlock(blockId, action, people, assignments, workDate);
    if (_blocksCache[blockId] && response.data) {
      Object.assign(_blocksCache[blockId], response.data);
    }
    loadBlockLBDs(blockId);
    if (document.getElementById('blocks-list')) {
      loadBlocks();
    }
    if (document.getElementById('claim-content')) {
      loadClaimPage();
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function showClaimPeopleDialog(block) {
  try {
    const response = await api.getClaimPeople();
    const suggestions = _dedupeClaimNames([...(Array.isArray(response.data) ? response.data : []), ...((block.claimed_people || []).map(name => String(name || '').trim()))]);
    const selected = new Set();
    const existingAssignments = _getClaimAssignments(block);
    if (currentUser?.name && suggestions.includes(currentUser.name)) selected.add(currentUser.name);
    const defaultWorkDate = todayIsoDate();

    const overlay = document.createElement('div');
    overlay.id = 'claim-people-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(3,8,20,0.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:10px;overflow-y:auto;-webkit-overflow-scrolling:touch;';

    const optionsHtml = suggestions.map(name => {
      const escaped = _escapeHtml(name);
      const checked = selected.has(name) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;background:rgba(255,255,255,0.04);cursor:pointer;min-height:44px;">
        <input type="checkbox" class="claim-person-option" value="${escaped}" ${checked} style="width:20px;height:20px;min-width:20px;" />
        <span style="color:#eef2ff;font-size:14px;">${escaped}</span>
      </label>`;
    }).join('');

    overlay.innerHTML = `
      <div style="width:min(760px,100%);max-height:90vh;overflow:auto;background:#0f172a;border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,0.45);-webkit-overflow-scrolling:touch;">
        <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;">
          <div>
            <div style="color:#eef2ff;font-size:18px;font-weight:700;">Claim ${_escapeHtml(block.name)}</div>
            <div style="color:#94a3b8;font-size:12px;margin-top:4px;">Select crew members, then review and submit.</div>
            <button type="button" id="claim-view-lbds-btn" style="margin-top:6px;background:rgba(255,255,255,0.06);color:#8adfff;border:1px solid rgba(0,212,255,0.2);border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;">View LBDs →</button>
          </div>
          <button type="button" id="claim-people-close" style="background:transparent;border:none;color:#94a3b8;font-size:24px;cursor:pointer;padding:4px 8px;">×</button>
        </div>
        <div id="claim-editor-panel">
          <div style="margin-top:16px;">
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Shared crew on this power block</label>
          </div>
          <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
            ${optionsHtml || '<div style="color:#94a3b8;font-size:12px;">No Foreman, Worker, or Lead crew members are available yet.</div>'}
          </div>
          <div style="margin-top:12px;">
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Add extra crew names</label>
            <textarea id="claim-extra-names" class="claim-modal-textarea" rows="2" placeholder="Type names separated by commas or new lines" style="width:100%;resize:vertical;font-size:14px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;"></textarea>
          </div>
          <div style="margin-top:12px;">
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Claim Date</label>
            <input id="claim-work-date" type="date" value="${_escapeHtml(defaultWorkDate)}" style="width:100%;min-height:42px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;" />
            <div style="margin-top:6px;color:#94a3b8;font-size:11px;">Pick a past day if this claim is being entered late.</div>
          </div>
          <div style="margin-top:16px;">
            <label style="display:block;color:#cbd5e1;font-size:12px;margin-bottom:6px;">Work types</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
              ${LBD_STATUS_TYPES.map(statusType => {
                const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
                return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;">
                  <input type="checkbox" class="claim-status-type" value="${_escapeHtml(statusType)}" />
                  <span style="color:#eef2ff;font-size:12px;">${label}</span>
                </label>`;
              }).join('')}
            </div>
          </div>
          <div style="margin-top:16px;">
            <label style="display:block;color:#cbd5e1;font-size:12px;margin-bottom:6px;">LBD selection by work type</label>
            <div id="claim-assignment-sections"></div>
          </div>
        </div>
        <div id="claim-review-panel" style="display:none;margin-top:16px;padding:16px;border-radius:14px;border:1px solid rgba(0,212,255,0.16);background:rgba(0,212,255,0.05);">
          <div style="font-size:12px;font-weight:700;color:#8adfff;letter-spacing:0.7px;text-transform:uppercase;">Review Claim</div>
          <div id="claim-review-content" style="margin-top:12px;"></div>
        </div>
        <div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" id="claim-people-cancel" class="btn btn-secondary" style="min-height:44px;padding:10px 20px;font-size:14px;">Cancel</button>
          <button type="button" id="claim-people-back" class="btn btn-secondary" style="display:none;min-height:44px;padding:10px 20px;font-size:14px;">Back</button>
          <button type="button" id="claim-people-save" class="btn btn-primary" style="min-height:44px;padding:10px 20px;font-size:14px;">Review Claim</button>
          <button type="button" id="claim-people-submit" class="btn btn-success" style="display:none;min-height:44px;padding:10px 20px;font-size:14px;">Submit Claim</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
  _renderClaimAssignmentSections(overlay, block, suggestions);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll('.claim-status-type').forEach(input => {
      input.addEventListener('change', () => _renderClaimAssignmentSections(overlay, block, suggestions));
    });
    overlay.querySelector('#claim-people-close').addEventListener('click', close);
    overlay.querySelector('#claim-people-cancel').addEventListener('click', close);
    const viewLbdsBtn = overlay.querySelector('#claim-view-lbds-btn');
    if (viewLbdsBtn) {
      viewLbdsBtn.addEventListener('click', () => {
        close();
        showPBPanel(block);
      });
    }
    const editorPanel = overlay.querySelector('#claim-editor-panel');
    const reviewPanel = overlay.querySelector('#claim-review-panel');
    const reviewContent = overlay.querySelector('#claim-review-content');
    const reviewBtn = overlay.querySelector('#claim-people-save');
    const backBtn = overlay.querySelector('#claim-people-back');
    const submitBtn = overlay.querySelector('#claim-people-submit');

    const buildDraft = () => {
      const sharedPeople = _readSharedClaimCrew(overlay);
      const people = [...sharedPeople];
      const assignments = {};
      const taskCrews = {};
      const workDate = String(overlay.querySelector('#claim-work-date')?.value || todayIsoDate());
      Array.from(overlay.querySelectorAll('.claim-status-type:checked')).forEach(input => {
        const statusType = input.value;
        const lbdIds = Array.from(overlay.querySelectorAll(`.claim-lbd-option[data-status-type="${statusType}"]:checked`))
          .map(option => Number(option.value))
          .filter(Number.isFinite);
        if (lbdIds.length > 0) {
          assignments[statusType] = lbdIds;
        }

        const taskPeople = _dedupeClaimNames(claimParseCrewNames(overlay.querySelector(`.claim-task-crew[data-status-type="${statusType}"]`)?.value || ''));
        if (taskPeople.length > 0) {
          taskCrews[statusType] = taskPeople;
          people.push(...taskPeople);
        }
      });
      return {
        people: _dedupeClaimNames(people),
        assignments,
        sharedPeople,
        taskCrews,
        workDate,
      };
    };

    reviewBtn.addEventListener('click', () => {
      const draft = buildDraft();
      if (draft.people.length === 0) {
        alert('Choose at least one crew member before reviewing the claim.');
        return;
      }
      const assignmentRows = Object.entries(draft.assignments).map(([statusType, lbdIds]) => {
        const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
        const lbdNames = (block.lbds || [])
          .filter(lbd => lbdIds.includes(lbd.id))
          .map(lbd => _escapeHtml(lbd.identifier || lbd.name || `LBD ${lbd.id}`));
        const crewNames = Array.isArray(draft.taskCrews[statusType]) && draft.taskCrews[statusType].length
          ? draft.taskCrews[statusType].map(_escapeHtml).join(', ')
          : (draft.sharedPeople.length ? draft.sharedPeople.map(_escapeHtml).join(', ') : 'No task-specific crew listed');
        return `<div style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
          <div style="font-weight:700;color:#eef2ff;">${label}</div>
          <div style="margin-top:4px;color:#8adfff;font-size:12px;">Crew: ${crewNames}</div>
          <div style="margin-top:4px;color:#94a3b8;font-size:12px;">${lbdNames.length > 0 ? lbdNames.join(', ') : 'No specific LBDs selected'}</div>
        </div>`;
      }).join('');
      reviewContent.innerHTML = `
        <div style="display:grid;gap:12px;">
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">All Crew On This Claim</div>
            <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${draft.people.map(_escapeHtml).join(', ')}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Shared PB Crew</div>
            <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${draft.sharedPeople.length ? draft.sharedPeople.map(_escapeHtml).join(', ') : 'None listed at the PB level'}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Power Block</div>
            <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${_escapeHtml(block.name)}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Claim Date</div>
            <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${_escapeHtml(draft.workDate)}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Assignments</div>
            <div style="margin-top:8px;display:grid;gap:8px;">${assignmentRows || '<div style="color:#94a3b8;font-size:12px;">This claim will assign crew only and will not mark specific LBD rows yet.</div>'}</div>
          </div>
        </div>`;
      editorPanel.style.display = 'none';
      reviewPanel.style.display = 'block';
      reviewBtn.style.display = 'none';
      backBtn.style.display = 'inline-flex';
      submitBtn.style.display = 'inline-flex';
      submitBtn._draft = draft;
    });

    backBtn.addEventListener('click', () => {
      editorPanel.style.display = 'block';
      reviewPanel.style.display = 'none';
      reviewBtn.style.display = 'inline-flex';
      backBtn.style.display = 'none';
      submitBtn.style.display = 'none';
    });

    submitBtn.addEventListener('click', async () => {
      const draft = submitBtn._draft || buildDraft();
      await claimBlock(block.id, 'claim', draft.people, draft.assignments, draft.workDate);
      close();
    });
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function showClaimPeopleDialogById(blockId) {
  try {
    const response = await api.getPowerBlock(blockId);
    await showClaimPeopleDialog(response.data);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function _fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch(e) { return iso; }
}

function _buildClaimedBanner(block) {
  const claimedPeople = Array.isArray(block.claimed_people) ? block.claimed_people : [];
  const claimedLabel = block.claimed_label || claimedPeople.join(', ') || block.claimed_by || '';
  const claimed   = block.claimed_by;
  const claimedAt = block.claimed_at ? _fmtDate(block.claimed_at) : '';
  const lastBy    = block.last_updated_by;
  const lastAt    = block.last_updated_at ? _fmtDate(block.last_updated_at) : '';
  const isClaimed = blockHasClaim(block);

  let claimPart = '';
  let actionButtons = '';
  if (isClaimed && claimedLabel) {
    claimPart = '<span style="color:#1565c0;font-weight:600;">&#128204; Claimed by ' + _escapeHtml(claimedLabel) + '</span>'
      + '<span style="color:#666;font-size:11px;"> &mdash; ' + claimedAt + '</span>';
    if (currentUser && (currentUserCan('claim_create') || currentUserCan('claim_delete'))) {
      actionButtons = '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">'
        + (currentUserCan('claim_create') ? '<button onclick="showClaimPeopleDialogById(' + block.id + ')" style="background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600;">Add Claim</button>' : '')
        + (currentUserCan('claim_delete') ? '<button onclick="claimBlock(' + block.id + ',\'unclaim\')" style="background:rgba(255,76,106,0.1);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600;">Release Claim</button>' : '')
        + '</div>';
    }
  } else {
    if (currentUserCan('claim_create')) {
      actionButtons = '<div style="margin-top:8px;">'
        + '<button onclick="showClaimPeopleDialogById(' + block.id + ')" style="background:rgba(0,232,122,0.15);color:#00e87a;border:1px solid rgba(0,232,122,0.3);border-radius:5px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700;">Add Claim</button>'
        + '</div>';
    }
  }

  let lastPart = '';
  if (lastBy) {
    lastPart = '<div style="margin-top:5px;color:#555;font-size:11px;">&#9998; Last updated by <strong>' + lastBy + '</strong> &mdash; ' + lastAt + '</div>';
  }

  const assignmentSummary = _buildClaimAssignmentSummary(block);

  return '<div id="pb-claimed-banner" style="margin-bottom:12px;padding:9px 14px;background:#e8f5e9;border-radius:6px;border:1px solid #c8e6c9;">'
    + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">' + claimPart + '</div>' + assignmentSummary + actionButtons + lastPart + '</div>';
}

function addLBD(blockId) {
  const name = document.getElementById('new-lbd-name').value;
  const identifier = document.getElementById('new-lbd-id').value;
  
  api.createLBD({
    power_block_id: blockId,
    name,
    identifier,
    x_position: null,
    y_position: null
  })
  .then(() => {
    document.getElementById('new-lbd-name').value = '';
    document.getElementById('new-lbd-id').value = '';
    loadBlockLBDs(blockId);
  })
  .catch(err => alert('Error: ' + err.message));
}

function toggleStatus(lbdId, statusType, currentStatus, blockId) {
  api.updateLBDStatus(lbdId, statusType, {
    is_completed: !currentStatus,
    completed_at: !currentStatus ? new Date().toISOString() : null
  })
  .then(() => loadBlockLBDs(blockId))
  .catch(err => alert('Error: ' + err.message));
}

// Tracker Hub (Dashboard)
function isDateToday(value) {
  const parsed = parseServerDate(value);
  if (!parsed) return false;
  const now = new Date();
  return parsed.getFullYear() === now.getFullYear()
    && parsed.getMonth() === now.getMonth()
    && parsed.getDate() === now.getDate();
}

function parseServerDate(value) {
  if (!value) return false;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)
    ? raw
    : `${raw}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed;
}

function formatDashboardCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDashboardActivityTime(value) {
  const parsed = parseServerDate(value);
  if (!parsed) return 'No recent activity';
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getDashboardCardPriority(card) {
  return (card.updatedToday * 6)
    + (card.claimedToday * 5)
    + (card.activeClaims * 4)
    + (card.crewCount * 2)
    + Math.round((card.pct || 0) / 5);
}

function rankDashboardCards(cards) {
  return [...cards].sort((left, right) => {
    const scoreDelta = getDashboardCardPriority(right) - getDashboardCardPriority(left);
    if (scoreDelta !== 0) return scoreDelta;
    return (right.pct || 0) - (left.pct || 0);
  });
}

function renderDashboardSpotlight(cards) {
  const spotlight = document.getElementById('dashboard-spotlight');
  if (!spotlight) return cards;
  if (!cards.length) {
    spotlight.innerHTML = '';
    return cards;
  }

  const ranked = rankDashboardCards(cards);
  const featured = ranked[0];
  const featuredTone = featured.pct >= 100 ? '#00e87a' : featured.pct >= 50 ? '#00d4ff' : '#9d8cff';
  const updatedCopy = formatDashboardCount(featured.updatedToday, 'block', 'blocks');
  const claimsCopy = formatDashboardCount(featured.claimedToday, 'claim', 'claims');
  const featuredItemsLabel = featured.stat_label || featured.item_name_plural || 'Items';

  spotlight.innerHTML = `
    <article class="dashboard-spotlight-card" onclick="openTracker(${featured.id})">
      <div class="dashboard-spotlight-copy">
        <div class="dashboard-spotlight-kicker">Spotlight Tracker</div>
        <h2 class="dashboard-spotlight-title">${featured.icon || '📋'} ${featured.name}</h2>
        <p class="dashboard-spotlight-sub">${updatedCopy} updated today, ${featured.activeClaims} active claims, and ${featured.crewCount} crew members currently moving this tracker forward.</p>
        <div class="dashboard-spotlight-meta-row">
          <span class="dashboard-spotlight-pill">${claimsCopy} started today</span>
          <span class="dashboard-spotlight-pill">Last activity ${formatDashboardActivityTime(featured.lastActivity)}</span>
        </div>
      </div>
      <div class="dashboard-spotlight-stats">
        <div class="dashboard-spotlight-mini-grid">
          <div class="dashboard-spotlight-mini-card">
            <span class="dashboard-spotlight-mini-label">Blocks</span>
            <strong>${featured.totalBlocks}</strong>
          </div>
          <div class="dashboard-spotlight-mini-card">
            <span class="dashboard-spotlight-mini-label">Completed</span>
            <strong>${featured.completedBlocks}</strong>
          </div>
          <div class="dashboard-spotlight-mini-card">
            <span class="dashboard-spotlight-mini-label">${featuredItemsLabel}</span>
            <strong>${featured.termedItems}</strong>
          </div>
        </div>
        <div class="dashboard-spotlight-score" style="color:${featuredTone}">${featured.pct}%</div>
        <div class="dashboard-spotlight-score-label">Tracker completion</div>
        <div id="dash-velocity-chart" class="dashboard-spotlight-velocity" style="margin:8px 0 6px;"></div>
        <div class="dashboard-spotlight-bar"><div class="dashboard-spotlight-bar-fill" style="width:${featured.pct}%;background:${featuredTone};"></div></div>
        <button type="button" class="dashboard-spotlight-btn" onclick="event.stopPropagation(); openTracker(${featured.id}); return false;">Open Tracker →</button>
      </div>
    </article>
  `;

  return ranked;
}

async function loadVelocitySparkline(trackerId, days = 7) {
  const el = document.getElementById('dash-velocity-chart');
  if (!el) return;
  try {
    const url = `/api/reports/velocity?days=${days}${trackerId ? '&tracker_id=' + trackerId : ''}`;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) return;
    const j = await r.json();
    const d = j.data || {};
    const counts = d.counts || [];
    const dates = d.dates || [];
    if (!counts.length) return;

    const W = 140, H = 38, barW = Math.floor((W - 2) / counts.length) - 2;
    const maxV = Math.max(...counts, 1);
    const bars = counts.map((v, i) => {
      const bh = Math.max(3, Math.round((v / maxV) * (H - 8)));
      const x = i * (barW + 2) + 1;
      const y = H - bh - 2;
      const alpha = 0.35 + 0.65 * (v / maxV);
      const label = dates[i] ? dates[i].slice(5) : '';
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="2" fill="rgba(0,212,255,${alpha.toFixed(2)})" title="${label}: ${v} LBDs"/>`;
    }).join('');

    el.innerHTML = `
      <div style="font-size:10px;color:rgba(238,242,255,0.38);margin-bottom:3px;">7-day LBD throughput · ${d.total || 0} total</div>
      <svg width="${W}" height="${H}" style="display:block;">${bars}</svg>`;
  } catch (e) { /* silently ignored */ }
}

const _liveFeedEvents = [];
function pushLiveActivityEvent(ev) {
  _liveFeedEvents.unshift(ev);
  if (_liveFeedEvents.length > 5) _liveFeedEvents.length = 5;
  _renderLiveFeed();
}

function _renderLiveFeed() {
  const el = document.getElementById('live-activity-feed');
  if (!el) return;
  if (!_liveFeedEvents.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const items = _liveFeedEvents.map(ev => {
    const t = ev.ts ? new Date(ev.ts) : null;
    const timeStr = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="live-feed-item">
      <span class="live-feed-dot"></span>
      <span class="live-feed-text"><strong>${_escapeHtml(ev.actor || 'Crew')}</strong> claimed <strong>${_escapeHtml(ev.block_name || 'a block')}</strong></span>
      <span class="live-feed-time">${timeStr}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="live-feed-header"><span class="live-feed-pulse"></span>Live Activity</div>${items}`;
}

function renderDashboardOverview(cards) {
  const grid = document.getElementById('dashboard-overview-grid');
  const strip = document.getElementById('dashboard-activity-strip');
  if (!grid || !strip) return;

  if (!cards.length) {
    grid.innerHTML = '';
    strip.innerHTML = '';
    return;
  }

  const totalTrackers = cards.length;
  const ranked = rankDashboardCards(cards);
  const featured = ranked[0] || cards[0];
  const activeTrackers = cards.filter(card => card.activeClaims > 0 || card.updatedToday > 0).length;

  // Sum LBD progress across trackers (each card already uses its own completion_status_type)
  let totalItems = 0, termedItems = 0, updatedToday = 0, claimedToday = 0;
  const _seenIds = new Set();
  cards.forEach(card => {
    termedItems += (card.termedItems || 0);
    totalItems += (card.totalItems || 0);
    (card._blocks || []).forEach(b => {
      if (_seenIds.has(b.id)) return;
      _seenIds.add(b.id);
      if (isDateToday(b.last_updated_at)) updatedToday++;
      if (isDateToday(b.claimed_at)) claimedToday++;
    });
  });
  const overallPct = totalItems > 0 ? Math.round((termedItems / totalItems) * 100) : 0;
  const featuredBlocksLabel = featured?.dashboard_blocks_label || 'Power Blocks';
  const activeTrackerLabel = `${activeTrackers}/${totalTrackers} trackers active sitewide`;

  const overviewCards = [
    {
      kicker: 'Live Progress',
      value: `${overallPct}%`,
      meta: `LBD Boxes Terminated: ${termedItems}/${totalItems}`,
      tone: 'cyan'
    },
    {
      kicker: 'Trackers Active',
      value: `${activeTrackers}/${totalTrackers}`,
      meta: `${formatDashboardCount(updatedToday, 'block', 'blocks')} updated today`,
      tone: 'emerald'
    },
    {
      kicker: 'Claims Today',
      value: `${claimedToday}`,
      meta: 'Fresh crew activity across the array',
      tone: 'violet'
    }
  ];

  grid.innerHTML = overviewCards.map(card => `
    <article class="dashboard-overview-card dashboard-tone-${card.tone}">
      <div class="dashboard-overview-kicker">${card.kicker}</div>
      <div class="dashboard-overview-value">${card.value}</div>
      <div class="dashboard-overview-meta">${card.meta}</div>
    </article>
  `).join('');

  const activeFeed = [...cards]
    .sort((left, right) => {
      const activityDelta = (right.updatedToday + right.claimedToday) - (left.updatedToday + left.claimedToday);
      if (activityDelta !== 0) return activityDelta;
      return (right.pct || 0) - (left.pct || 0);
    })
    .slice(0, 6);

  strip.innerHTML = activeFeed.map(card => `
    <button type="button" class="dashboard-activity-chip" onclick="openTracker(${card.id})">
      <span class="dashboard-activity-chip-name">${card.icon || '📋'} ${card.name}</span>
      <span class="dashboard-activity-chip-meta">${formatDashboardCount(card.updatedToday, 'block', 'blocks')} updated today</span>
      <span class="dashboard-activity-chip-meta">${card.activeClaims} active claims</span>
    </button>
  `).join('');
}

async function loadDashboard() {
  const grid = document.getElementById('tracker-hub-grid');
  const countBadge = document.getElementById('dashboard-tracker-count');
  if (!grid) return;
  const ui = (adminSettings && adminSettings.ui_text) ? adminSettings.ui_text : {};
  const loadingText = ui.dashboard_loading || 'LOADING TRACKERS...';
  const emptyText = ui.dashboard_empty || 'No trackers yet. Create one in Admin.';
  grid.innerHTML = `<div style="color:rgba(238,242,255,0.4);text-align:center;padding:60px 20px;font-family:Orbitron,sans-serif;font-size:13px;letter-spacing:1px;">${loadingText}</div>`;

  // Make sure allTrackers is populated
  if (!allTrackers.length) {
    try {
      const r = await api.call('/admin/trackers');
      allTrackers = r.data || [];
    } catch(e) { /* ignore */ }
  }

  if (!allTrackers.length) {
    grid.innerHTML = `<p style="color:rgba(238,242,255,0.35);text-align:center;padding:60px 20px;">${emptyText}</p>`;
    if (countBadge) countBadge.textContent = '0 trackers';
    renderDashboardOverview([]);
    renderDashboardSpotlight([]);
    return;
  }

  // Load stats for each tracker in parallel (only trackers set to show on dashboard)
  const dashboardTrackers = allTrackers.filter(t => t.show_on_dashboard !== false);
  const cards = await Promise.all(dashboardTrackers.map(async t => {
    try {
      const r = await fetch(`/api/tracker/power-blocks?tracker_id=${t.id}`, { credentials: 'include' });
      const d = await r.json();
      const blocks = Array.isArray(d.data) ? d.data : [];
      const totalBlocks = blocks.length;
      const completedBlocks = blocks.filter(b => b.is_completed).length;
      const totalItems = blocks.reduce((s, b) => s + (b.lbd_count || 0), 0);
      // % based on the tracker's own completion_status_type (falls back to last in array)
      const _statusTypes = t.status_types || [];
      const _primaryStatus = t.completion_status_type || (_statusTypes.length ? _statusTypes[_statusTypes.length - 1] : 'term');
      const termedItems = blocks.reduce((s, b) => s + ((b.lbd_summary && b.lbd_summary[_primaryStatus]) || 0), 0);
      const pct = t.progress_unit === 'block'
        ? (totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0)
        : (totalItems > 0 ? Math.round((termedItems / totalItems) * 100) : 0);
      const activeClaims = blocks.filter(b => (Array.isArray(b.claimed_people) && b.claimed_people.length > 0) || !!b.claimed_by).length;
      const claimedToday = blocks.filter(b => isDateToday(b.claimed_at)).length;
      const updatedToday = blocks.filter(b => isDateToday(b.last_updated_at)).length;
      const crewCount = new Set(blocks.flatMap(b => {
        if (Array.isArray(b.claimed_people) && b.claimed_people.length > 0) return b.claimed_people;
        return b.claimed_by ? [b.claimed_by] : [];
      })).size;
      const lastActivity = blocks
        .map(b => b.last_updated_at || b.claimed_at)
        .filter(Boolean)
        .sort((left, right) => (parseServerDate(right)?.getTime() || 0) - (parseServerDate(left)?.getTime() || 0))[0] || null;
      return { ...t, totalBlocks, completedBlocks, totalItems, termedItems, pct, activeClaims, claimedToday, updatedToday, crewCount, lastActivity, _blocks: blocks };
    } catch(e) {
      return { ...t, totalBlocks: 0, completedBlocks: 0, totalItems: 0, termedItems: 0, pct: 0, activeClaims: 0, claimedToday: 0, updatedToday: 0, crewCount: 0, lastActivity: null, _blocks: [] };
    }
  }));

  renderDashboardOverview(cards);
  const rankedCards = renderDashboardSpotlight(cards);
  const featuredTrackerId = rankedCards[0] ? rankedCards[0].id : null;
  loadVelocitySparkline(featuredTrackerId);
  if (countBadge) countBadge.textContent = formatDashboardCount(rankedCards.length, 'tracker');

  grid.innerHTML = rankedCards.map(t => {
    const barColor = t.pct >= 100 ? '#00e87a' : t.pct >= 50 ? '#00d4ff' : '#7c6cfc';
    const completeLabel = t.dashboard_progress_label || ui.dashboard_complete || 'Complete';
    const powerBlocksLabel = t.dashboard_blocks_label || ui.dashboard_power_blocks || 'Power Blocks';
    const openTrackerLabel = t.dashboard_open_label || ui.dashboard_open_tracker || 'Open Tracker';
    const featuredBadge = featuredTrackerId === t.id ? '<span class="thc-featured-badge">Spotlight</span>' : '';
    return `
    <div class="tracker-hub-card" onclick="openTracker(${t.id})">
      <div class="thc-activity-rail">
        <span class="thc-activity-badge">${formatDashboardCount(t.updatedToday, 'block', 'blocks')} updated today</span>
        <span class="thc-activity-badge thc-activity-badge-muted">${t.activeClaims} active claims</span>
      </div>
      <div class="thc-top">
        <span class="thc-icon">${t.icon || '📋'}</span>
        <div class="thc-title-wrap">
          <span class="thc-name">${getTrackerDisplayName(t)}</span>
          ${featuredBadge}
          <span class="thc-pct-badge" style="color:${barColor}">${t.pct}%</span>
        </div>
      </div>
      <div class="thc-meta-row">
        <span class="thc-meta-pill">${t.crewCount} crew active</span>
        <span class="thc-meta-pill">${formatDashboardActivityTime(t.lastActivity)}</span>
      </div>
      <div class="thc-stats">
        <div class="thc-stat-pill thc-pct-pill" style="background:${barColor}18;border-color:${barColor}55;color:${barColor}"><span class="thc-stat-val">${t.pct}%</span> <span class="thc-stat-lbl">${completeLabel}</span></div>
        <div class="thc-stat-pill"><span class="thc-stat-val">${t.totalBlocks}</span> <span class="thc-stat-lbl">${powerBlocksLabel}</span></div>
        <div class="thc-stat-pill"><span class="thc-stat-val">${t.totalItems}</span> <span class="thc-stat-lbl">${t.stat_label || t.item_name_plural || 'Items'}</span></div>
      </div>
      <div class="thc-bar-wrap"><div class="thc-bar-fill" style="width:${t.pct}%;background:${barColor};"></div></div>
      <div class="thc-footer">
        <span class="thc-footer-copy">${formatDashboardCount(t.claimedToday, 'new claim', 'new claims')} today</span>
        <button type="button" class="thc-open-btn" onclick="event.stopPropagation(); openTracker(${t.id}); return false;">${openTrackerLabel} →</button>
      </div>
    </div>`;
  }).join('');
}

async function openTracker(trackerId) {
  const t = allTrackers.find(t => t.id == trackerId);
  if (!t) return;
  currentTracker = t;
  trackerWasExplicitlyChosen = true;
  try {
    await loadAdminSettings();
  } catch (e) {
    console.warn('Failed to load tracker settings:', e);
  }
  updateTrackerCrumb();
  showPage('blocks');
}

// Blocks list
let _blocksCache = {};    // pb_id -> block data for lazy LBD table expansion
let _allBlocksData = [];  // full blocks list from last fetch
let _pbFilters = { zone: '', sort: 'default', expandAll: false };

function _getBlocksPrefsKey() {
  return `blocks_prefs_${currentUser ? currentUser.id : 'guest'}`;
}
function saveBlocksFilterPrefs() {
  try { localStorage.setItem(_getBlocksPrefsKey(), JSON.stringify(_pbFilters)); } catch(e) {}
}
function loadBlocksFilterPrefs() {
  try {
    const saved = localStorage.getItem(_getBlocksPrefsKey());
    if (saved) Object.assign(_pbFilters, JSON.parse(saved));
  } catch(e) {}
}

function populateBlocksZoneFilter(blocks) {
  const sel = document.getElementById('blocks-zone-filter');
  if (!sel) return;
  const zones = [...new Set(blocks.map(b => b.zone).filter(Boolean))].sort();
  const current = _pbFilters.zone;
  if (zones.length > 0) {
    sel.innerHTML = '<option value="">All Zones</option>' + zones.map(z =>
      `<option value="${z}"${z === current ? ' selected' : ''}>${z}</option>`
    ).join('');
  } else if (_adminZoneNames.length > 0) {
    sel.innerHTML = '<option value="">All Zones</option>' + _adminZoneNames.map(z =>
      `<option value="${z}"${z === current ? ' selected' : ''}>${z}</option>`
    ).join('');
  }
}

function applyBlocksFilter() {
  const zoneEl = document.getElementById('blocks-zone-filter');
  const sortEl = document.getElementById('blocks-sort-select');
  if (zoneEl) _pbFilters.zone = zoneEl.value;
  if (sortEl) _pbFilters.sort = sortEl.value;
  saveBlocksFilterPrefs();
  renderBlocks(_allBlocksData);
}

function toggleBlocksExpandAll() {
  _pbFilters.expandAll = !_pbFilters.expandAll;
  const btn = document.getElementById('blocks-expand-btn');
  if (btn) {
    btn.textContent = _pbFilters.expandAll ? '▼ Collapse All' : '▶ Expand All';
    btn.classList.toggle('active', _pbFilters.expandAll);
  }
  saveBlocksFilterPrefs();
  renderBlocks(_allBlocksData);
}

async function loadBlocks() {
  try {
    const response = await api.getPowerBlocks();
    const blocks = Array.isArray(response.data) ? response.data : response;
    blocks.forEach(b => { _blocksCache[b.id] = b; });
    _allBlocksData = blocks;
    loadBlocksFilterPrefs();
    populateBlocksZoneFilter(blocks);
    // Sync sort select
    const sortEl = document.getElementById('blocks-sort-select');
    if (sortEl) sortEl.value = _pbFilters.sort || 'default';
    // Sync expand button
    const btn = document.getElementById('blocks-expand-btn');
    if (btn) {
      btn.textContent = _pbFilters.expandAll ? '▼ Collapse All' : '▶ Expand All';
      btn.classList.toggle('active', _pbFilters.expandAll);
    }
    renderBlocks(blocks);
  } catch (err) {
    console.error('Error loading blocks:', err);
  }
}

function _renderLbdTable(block) {
  const cols = LBD_STATUS_TYPES;
  const lbds = block.lbds || [];
  const hdrSize = parseInt(localStorage.getItem('pbHeaderSize') || '11');
  const headerCells = cols.map(col => {
    const color = STATUS_COLORS[col] || '#555';
    const label = STATUS_LABELS[col] || col;
    return `<th class="lbd-tbl-th" style="color:${color};font-size:${hdrSize}px;white-space:nowrap;" title="${label}">${label}</th>`;
  }).join('');
  const dataRows = lbds.map(lbd => {
    const statusMap = {};
    (lbd.statuses || []).forEach(s => { statusMap[s.status_type] = s.is_completed; });
    const lbdAllDone = cols.every(c => statusMap[c]);
    const cells = cols.map(col => {
      const done = statusMap[col];
      const color = STATUS_COLORS[col] || '#555';
      return done
        ? `<td class="lbd-tbl-td"><span class="lbd-dot lbd-dot--on" style="background:${color}"></span></td>`
        : `<td class="lbd-tbl-td"><span class="lbd-dot lbd-dot--off"></span></td>`;
    }).join('');
    const name = lbd.identifier || lbd.name || `LBD ${lbd.id}`;
    return `<tr class="lbd-tbl-row${lbdAllDone ? ' lbd-tbl-row--done' : ''}">
      <td class="lbd-tbl-name" title="${lbd.inventory_number || name}">${name}</td>${cells}
    </tr>`;
  }).join('');
  return `<div class="lbd-tbl-wrap"><table class="lbd-tbl">
    <thead><tr><th class="lbd-tbl-name-th"></th>${headerCells}</tr></thead>
    <tbody>${dataRows}</tbody>
  </table></div>`;
}

function renderBlocks(blocks) {
  let filtered = [...blocks];
  // Apply zone filter
  if (_pbFilters.zone) {
    filtered = filtered.filter(b => b.zone === _pbFilters.zone);
  }
  // Apply sort
  if (_pbFilters.sort === 'zone') {
    filtered.sort((a, b) => {
      const za = a.zone || '\uFFFF', zb = b.zone || '\uFFFF';
      if (za !== zb) return za.localeCompare(zb);
      return (a.name || '').localeCompare(b.name || '');
    });
  } else if (_pbFilters.sort === 'last_completed') {
    filtered.sort((a, b) => {
      const ta = a.last_updated_at || '';
      const tb = b.last_updated_at || '';
      return tb.localeCompare(ta); // newest first
    });
  }

  const summaryStrip = document.getElementById('blocks-summary-strip');
  if (summaryStrip) {
    const totalBlocksCount = blocks.length;
    const visibleBlocksCount = filtered.length;
    const completedBlocksCount = filtered.filter(block => !!block.is_completed).length;
    const activeClaimsCount = filtered.filter(block => Array.isArray(block.claimed_people) ? block.claimed_people.length > 0 : !!block.claimed_by).length;
    const totalItemsCount = filtered.reduce((sum, block) => sum + (block.lbd_count || 0), 0);
    summaryStrip.innerHTML = `
      <div class="blocks-summary-card">
        <span class="blocks-summary-label">Visible Blocks</span>
        <strong>${visibleBlocksCount}<span>/ ${totalBlocksCount}</span></strong>
      </div>
      <div class="blocks-summary-card">
        <span class="blocks-summary-label">Completed</span>
        <strong>${completedBlocksCount}</strong>
      </div>
      <div class="blocks-summary-card">
        <span class="blocks-summary-label">Active Claims</span>
        <strong>${activeClaimsCount}</strong>
      </div>
      <div class="blocks-summary-card">
        <span class="blocks-summary-label">Tracked Items</span>
        <strong>${totalItemsCount}</strong>
      </div>`;
  }

  let html = '';
  if (!filtered || filtered.length === 0) {
    html = '<div class="blocks-empty-state"><strong>No power blocks match the current filter.</strong><span>Try a different zone or sort order to bring more blocks back into view.</span></div>';
  } else {
    const cols = LBD_STATUS_TYPES;
    const showLbdDetails = !currentTracker || currentTracker.show_per_lbd_ui !== false;

    filtered.forEach(block => {
      const total = block.lbd_count || 0;
      const summary = block.lbd_summary || {};
      const lbds = block.lbds || [];
      const allDone = showLbdDetails
        ? (total > 0 && cols.every(c => (summary[c] || 0) >= total))
        : !!block.is_completed;
      const claimed = block.claimed_by ? `<span class="pb-claimed-pill">👥 ${_escapeHtml(block.claimed_label || block.claimed_by)}</span>` : '';
      const zonePill = block.zone ? `<span class="pb-zone-pill">${block.zone}</span>` : '';

      // Overall completion
      const totalSteps = cols.length * total;
      const doneSteps = cols.reduce((s, c) => s + (summary[c] || 0), 0);
      const overallPct = showLbdDetails
        ? (totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0)
        : (block.is_completed ? 100 : 0);
      const lastUpdatedCopy = block.last_updated_at ? formatDashboardActivityTime(block.last_updated_at) : 'No recent updates';

      // Per-status summary rows (hidden when show_per_lbd_ui is off)
      let statusRows = '';
      if (showLbdDetails) {
        cols.forEach(col => {
          const done = summary[col] || 0;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const color = STATUS_COLORS[col] || '#555';
          const label = STATUS_LABELS[col] || col;
          statusRows += `
              <div class="pb-status-row">
                <div class="pb-status-label" style="color:${color}">${label}</div>
                <div class="pb-status-bar-wrap"><div class="pb-status-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                <div class="pb-status-count">${done}/${total}</div>
              </div>`;
        });
      }

      // Individual LBD table (hidden when show_per_lbd_ui is off)
      let lbdTable = '';
      if (showLbdDetails && lbds.length > 0) {
        if (_pbFilters.expandAll) {
          lbdTable = `
            <div class="lbd-tbl-toggle" onclick="event.stopPropagation();toggleLbdTable(this,${block.id})">▼ Hide Details</div>
            <div class="lbd-tbl-lazy" style="display:block;" data-pb-id="${block.id}" data-loaded="1">${_renderLbdTable(block)}</div>`;
        } else {
          lbdTable = `
            <div class="lbd-tbl-toggle" onclick="event.stopPropagation();toggleLbdTable(this,${block.id})">▶ Show Details</div>
            <div class="lbd-tbl-lazy" style="display:none;" data-pb-id="${block.id}"></div>`;
        }
      }

      html += `
          <div class="block-card${allDone ? ' block-card--complete' : ''}">
            <div class="pb-card-header">
              <div class="pb-card-heading">
                <span class="pb-card-kicker">${currentTracker?.block_label_singular || 'Power Block'}</span>
                <span class="pb-card-name">${block.name}</span>
              </div>
              <span class="pb-card-meta">${claimed}${zonePill}<span class="pb-card-count">${total} ${getPowerBlockCountLabel(total)}</span></span>
            </div>
            <div class="pb-overall-bar-wrap" title="Overall: ${overallPct}% complete">
              <div class="pb-overall-bar-fill" style="width:${overallPct}%"></div>
            </div>
            <div class="pb-card-stats">
              ${showLbdDetails
                ? `<span class="pb-stat-chip">${overallPct}% complete</span><span class="pb-stat-chip">${doneSteps}/${totalSteps} steps</span>`
                : `<span class="pb-stat-chip" style="color:${block.is_completed ? '#00e87a' : '#94a3b8'}">${block.is_completed ? '&#x2713; Complete' : '&#x25CB; In Progress'}</span>`}
              <span class="pb-stat-chip pb-stat-chip-muted">${lastUpdatedCopy}</span>
            </div>
            <div class="pb-status-rows">${statusRows}</div>
            ${lbdTable}
            <button class="btn btn-small btn-primary pb-details-btn" onclick="showBlockModal(${block.id})">View Details</button>
          </div>`;
    });
  }

  document.getElementById('blocks-list').innerHTML = html;
  // Update header size display
  const curSize = parseInt(localStorage.getItem('pbHeaderSize') || '11');
  const sizeDisp = document.getElementById('pb-header-size-display');
  if (sizeDisp) sizeDisp.textContent = curSize + 'px';
}

function toggleLbdTable(toggleEl, pbId) {
  const wrap = toggleEl.nextElementSibling;
  if (!wrap) return;
  const showing = wrap.style.display === 'none';
  wrap.style.display = showing ? 'block' : 'none';
  toggleEl.textContent = showing ? '▼ Hide Details' : '▶ Show Details';
  // Lazily render the table on first open
  if (showing && !wrap.dataset.loaded) {
    wrap.dataset.loaded = '1';
    const block = _blocksCache[pbId];
    if (!block) return;
    wrap.innerHTML = _renderLbdTable(block);
  }
}

function changePBHeaderSize(delta) {
  let size = parseInt(localStorage.getItem('pbHeaderSize') || '11');
  size = Math.max(7, Math.min(24, size + delta));
  localStorage.setItem('pbHeaderSize', size);
  const disp = document.getElementById('pb-header-size-display');
  if (disp) disp.textContent = size + 'px';
  // Update all header cells live
  document.querySelectorAll('.lbd-tbl-th').forEach(th => { th.style.fontSize = size + 'px'; });
}

// PDF Upload
let currentPDF = null;
let currentMapPath = null;
let pageCount = 0;
let selectedPages = [];

async function uploadPDF() {
  const file = document.getElementById('pdf-file').files[0];
  if (!file) {
    showStatus('upload-status', 'Please select a PDF file', 'error');
    return;
  }
  
  const btn = document.getElementById('upload-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  
  try {
    const response = await api.uploadPDF(file);
    if (!response.page_count) {
      showStatus('upload-status', 'Error: PDF processing failed', 'error');
      return;
    }
    currentPDF = response;
    pageCount = response.page_count;
    
    // Show scan LBD section
    document.getElementById('scan-lbd-section').classList.remove('hidden');
    document.getElementById('map-upload-section').classList.remove('hidden');
    
    // Show page selector
    let html = '';
    for (let i = 1; i <= pageCount; i++) {
      html += `
        <label class="page-option">
          <input type="checkbox" value="${i}" onchange="updateSelectedPages()" />
          Page ${i}
        </label>
      `;
    }
    document.getElementById('pages-list').innerHTML = html;
    document.getElementById('page-selector').classList.remove('hidden');
    
    showStatus('upload-status', `PDF uploaded successfully! (${pageCount} pages)`, 'success');
  } catch (err) {
    showStatus('upload-status', `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload PDF';
  }
}

async function uploadMap() {
  const mapFile = document.getElementById('map-file');
  if (!mapFile.files.length) {
    showStatus('map-upload-status', 'Please select a map image', 'error');
    return;
  }

  const btn = document.getElementById('map-upload-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading map...';

  try {
    const formData = new FormData();
    formData.append('file', mapFile.files[0]);
    
    const response = await fetch('/api/pdf/upload-map', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    
    showStatus('map-upload-status', 'Map uploaded successfully! View it on the Site Map page.', 'success');
    currentMapPath = data.map_url;
    localStorage.setItem('siteMapUrl', data.map_url);
  } catch (err) {
    showStatus('map-upload-status', `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Map';
  }
}

// Site Map page functions
async function uploadSiteMap() {
  const fileInput = document.getElementById('sitemap-file');
  if (!fileInput.files.length) {
    showStatus('sitemap-upload-status', 'Please select a map image', 'error');
    return;
  }

  const btn = document.getElementById('sitemap-upload-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  try {
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    
    const response = await fetch('/api/pdf/upload-map', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    
    localStorage.setItem('siteMapUrl', data.map_url);
    currentMapPath = data.map_url;
    displaySiteMap(data.map_url);
  } catch (err) {
    showStatus('sitemap-upload-status', `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Map';
  }
}

async function replaceSiteMap() {
  const fileInput = document.getElementById('sitemap-replace-file');
  if (!fileInput.files.length) return;

  try {
    // 1. Delete old SiteMap records + areas from DB
    try {
      const maps = await api.getAllSiteMaps().catch(() => ({data:[]}));
      for (const m of (maps.data || [])) {
        await api.deleteSiteMap(m.id).catch(() => {});
      }
    } catch(e) { console.warn('Could not delete old sitemaps:', e); }

    // 2. Clear saved bboxes & positions so markers start fresh
    localStorage.removeItem('pb_bboxes');
    localStorage.removeItem('pb_positions');
    localStorage.removeItem('pb_label_offsets');
    pbLabelOffsets = {};

    // 3. Clear scan overlays
    detectedScanRegions = [];
    scanAssignments = {};
    renderScanOverlays();

    // 4. Upload the new map
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    
    const response = await fetch('/api/pdf/upload-map', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    
    localStorage.setItem('siteMapUrl', data.map_url);
    currentMapPath = data.map_url;
    displaySiteMap(data.map_url);

    // 5. Register the new map in the DB so snap-place has a valid map_id
    try {
      await api.registerExistingMap();
    } catch(e) { console.warn('Could not register new map in DB:', e); }

    // 6. Re-render markers as plain circles (no bboxes)
    renderPBMarkers();

    // 7. Reset scan button
    const btn = document.getElementById('scan-map-btn');
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Auto-detect PB Regions'; }
  } catch (err) {
    alert('Error replacing map: ' + err.message);
  }
}

function displaySiteMap(mapUrl) {
  const uploadSection = document.getElementById('sitemap-upload-section');
  const emptySection = document.getElementById('sitemap-empty-section');
  if (uploadSection) {
    uploadSection.classList.add('hidden');
    uploadSection.style.display = 'none';
  }
  if (emptySection) {
    emptySection.classList.add('hidden');
    emptySection.style.display = 'none';
  }
  const display = document.getElementById('sitemap-display');
  display.classList.remove('hidden');
  display.style.display = 'flex';
  document.getElementById('sitemap-image').src = mapUrl;
  // markers are rendered by onMapImageLoaded()
}

function renderSiteMapNoMapState() {
  const isMainAdmin = !!(currentUser && String(currentUser.username || '').toLowerCase() === 'admin');
  const uploadSection = document.getElementById('sitemap-upload-section');
  const emptySection = document.getElementById('sitemap-empty-section');
  const display = document.getElementById('sitemap-display');
  if (display) {
    display.classList.add('hidden');
    display.style.display = 'none';
  }
  if (uploadSection) {
    uploadSection.classList.toggle('hidden', !isMainAdmin);
    uploadSection.style.display = isMainAdmin ? 'block' : 'none';
  }
  if (emptySection) {
    emptySection.classList.toggle('hidden', isMainAdmin);
    emptySection.style.display = isMainAdmin ? 'none' : 'block';
  }
}

function extractSiteMapId(mapUrl) {
  const match = mapUrl ? mapUrl.match(/\/api\/map\/sitemap\/(\d+)\/image/) : null;
  return match ? Number(match[1]) : null;
}

function getCurrentSiteMapRecord(records, mapUrl = currentMapPath) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return null;
  const currentMapId = extractSiteMapId(mapUrl);
  if (currentMapId != null) {
    const matchingMap = list.find((map) => Number(map.id) === currentMapId);
    if (matchingMap) return matchingMap;
  }
  return list[0];
}

async function loadSiteMap() {
  const uploadSection = document.getElementById('sitemap-upload-section');
  const emptySection = document.getElementById('sitemap-empty-section');
  const display = document.getElementById('sitemap-display');
  if (uploadSection) {
    uploadSection.classList.add('hidden');
    uploadSection.style.display = 'none';
  }
  if (emptySection) {
    emptySection.classList.add('hidden');
    emptySection.style.display = 'none';
  }
  if (display) {
    display.classList.add('hidden');
    display.style.display = 'none';
  }

  let foundMap = false;
  // Always fetch the canonical map URL from the server to avoid stale cache
  try {
    const response = await fetch('/api/pdf/get-map');
    const data = await response.json();
    if (data.success && data.map_url) {
      localStorage.setItem('siteMapUrl', data.map_url);
      currentMapPath = data.map_url;
      displaySiteMap(data.map_url);
      foundMap = true;
    } else {
      // Fall back to localStorage if server has no map
      const savedUrl = localStorage.getItem('siteMapUrl');
      if (savedUrl) {
        displaySiteMap(savedUrl);
        foundMap = true;
      }
    }
  } catch (err) {
    console.log('No map from server, using cache:', err);
    const savedUrl = localStorage.getItem('siteMapUrl');
    if (savedUrl) {
      displaySiteMap(savedUrl);
      foundMap = true;
    }
  }

  if (!foundMap) {
    renderSiteMapNoMapState();
    return;
  }
  // Always (re)load power blocks for the map
  try {
    const resp = await api.getPowerBlocks();
    mapPBs = Array.isArray(resp.data) ? resp.data : [];

    // Load saved site area bboxes from the DB if not in localStorage
    const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
    try {
      const maps = await api.getAllSiteMaps();
      const list = maps.data || [];
      const currentMap = getCurrentSiteMapRecord(list);
        siteMapViewState.currentMap = currentMap || null;
      if (currentMap && currentMap.areas) {
        // Always populate loadedMapAreas so zone assign works regardless of cache state
        loadedMapAreas = currentMap.areas;
        const cachedLabelOffsets = JSON.parse(localStorage.getItem('pb_label_offsets') || '{}');
        // Always merge DB area positions into localStorage cache (fills gaps, preserves user overrides)
        let bboxChanged = false;
        for (const area of currentMap.areas) {
          if (area.power_block_id && area.bbox_x != null) {
            const pk = String(area.power_block_id);
            const dbBbox = normalizeMapBBox({
              x: area.bbox_x,
              y: area.bbox_y,
              w: area.bbox_w,
              h: area.bbox_h
            });
            const cachedBbox = normalizeMapBBox(bboxes[pk]);
            const shouldUseDbBbox = isReasonableMapBBox(dbBbox)
              && (!isReasonableMapBBox(cachedBbox)
                || cachedBbox.x !== dbBbox.x
                || cachedBbox.y !== dbBbox.y
                || cachedBbox.w !== dbBbox.w
                || cachedBbox.h !== dbBbox.h);
            if (shouldUseDbBbox) {
              bboxes[pk] = dbBbox;
              bboxChanged = true;
            }
            // Always load polygon data from DB
            if (area.polygon && area.polygon.length >= 3) {
              pbPolygons[pk] = area.polygon;
            }
            // Load per-label color if set
            if (area.label_color) {
              pbLabelColors[pk] = area.label_color;
            }
          }
        }
        if (bboxChanged || Object.keys(bboxes).length > 0) {
          localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
        }
        if (Object.keys(pbPolygons).length > 0) {
          localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));
        }
        localStorage.setItem('pb_label_colors', JSON.stringify(pbLabelColors));
        if (Object.keys(cachedLabelOffsets).length === 0) {
          for (const area of currentMap.areas) {
            if (!area.power_block_id) continue;
            const hasX = area.label_offset_x != null;
            const hasY = area.label_offset_y != null;
            if (hasX || hasY) {
              pbLabelOffsets[String(area.power_block_id)] = {
                x: hasX ? Number(area.label_offset_x) : 0,
                y: hasY ? Number(area.label_offset_y) : 0,
              };
            }
          }
          localStorage.setItem('pb_label_offsets', JSON.stringify(pbLabelOffsets));
        } else {
          pbLabelOffsets = cachedLabelOffsets;
        }
      }
    } catch(e) { console.log('No site areas to load:', e); }

    renderPBMarkers();
    buildZoneFilter();
    renderSiteMapSummary();
    // Auto-sync localStorage positions to DB so mobile apps stay in sync
    syncPositionsToServer();
  } catch (e) {
    console.error('Failed loading PBs for map:', e);
  }
}

// ============================================================
// INTERACTIVE MAP
// ============================================================
let LBD_STATUS_TYPES = ['ground_brackets', 'stuff', 'term'];

// An LBD counts as complete when ALL current tracker columns are checked
function isLBDComplete(lbd) {
  const statuses = lbd.statuses || [];
  return LBD_STATUS_TYPES.every(st =>
    statuses.some(s => s.status_type === st && s.is_completed)
  );
}
let STATUS_COLORS = {
  ground_brackets: '#95E1D3',
  stuff:           '#FF6B6B',
  term:            '#4ECDC4'
};
let STATUS_LABELS = {
  ground_brackets: 'Bracket/Ground',
  stuff:           'Stuffed',
  term:            'Termed'
};

// Admin settings cache
let adminSettings = { colors: STATUS_COLORS, names: STATUS_LABELS, all_columns: LBD_STATUS_TYPES, custom_columns: [], pb_label_font_size: 14 };

// ═══════════════════════════════════════════════════════════════
// AUTH STATE & SOCKET.IO
// ═══════════════════════════════════════════════════════════════

let currentUser = null;  // {id, name, username, is_admin}
let _socket     = null;

// ── Auth check ────────────────────────────────────────────────
async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    const d = await r.json();
    currentUser = d.user || null;
  } catch(e) { currentUser = null; }
  if (currentUser) {
    try {
      await loadTrackers();
      syncActiveTracker(true);
    } catch (e) {
      console.warn('Failed to refresh trackers after auth check:', e);
    }
  }
  _applyRoleUI();
  _initSocket();
}

function _applyRoleUI() {
  const isAdmin = !!(currentUser && currentUser.is_admin);

  document.querySelectorAll('.admin-only').forEach(el => {
    const requiredPerm = el.dataset.perm;
    el.style.display = (requiredPerm ? currentUserCan(requiredPerm) : currentUserCanAccessAdminPage()) ? '' : 'none';
  });

  document.querySelectorAll('.main-admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  syncAdminTabVisibility();

  const ui = document.getElementById('user-info');
  if (ui) {
    if (currentUser) {
      const initials = currentUser.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      let badge = '';
      if (isAdmin) {
        badge = `<span style="font-size:9px;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:4px;padding:1px 6px;font-weight:700;letter-spacing:0.5px;">ADMIN</span>`;
      } else {
        badge = `<span style="font-size:9px;background:rgba(124,108,252,0.15);color:#7c6cfc;border:1px solid rgba(124,108,252,0.3);border-radius:4px;padding:1px 6px;font-weight:700;letter-spacing:0.5px;">${_escapeHtml(currentUserRoleLabel().toUpperCase())}</span>`;
      }
      ui.innerHTML = `<div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:100px;padding:4px 12px 4px 6px;">`
        + `<div style="width:26px;height:26px;background:linear-gradient(135deg,#00d4ff,#7c6cfc);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;flex-shrink:0;">${initials}</div>`
        + `<span style="font-size:12px;color:#eef2ff;font-weight:500;">${currentUser.name}</span>`
        + badge
        + `<button onclick="logout()" style="font-size:11px;background:none;color:#4a5568;border:none;cursor:pointer;padding:2px 4px;margin-left:2px;transition:color 0.2s;" onmouseover="this.style.color='#ff4c6a'" onmouseout="this.style.color='#4a5568'">&#x2715;</button>`
        + `</div>`;
    } else {
      ui.innerHTML = `<button onclick="showLoginModal()" style="font-size:12px;background:linear-gradient(135deg,#00d4ff,#009abc);color:#000;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-weight:700;font-family:Inter,sans-serif;">Sign In</button>`;
    }
  }
}

// ── Login modal helpers ───────────────────────────────────────
function resetLoginLogoAnimation() {
  const shell = document.getElementById('login-logo-shell');
  const video = document.getElementById('login-logo-video');
  if (shell) shell.classList.remove('is-animating');
  if (video) {
    video.pause();
    try {
      video.currentTime = 0.01;
    } catch (e) {
      console.warn('Failed resetting login logo video:', e);
    }
  }
}

function setAppShellVisible(isVisible) {
  const app = document.getElementById('app');
  if (!app) return;
  app.style.display = isVisible ? '' : 'none';
}

function hideLoginModal() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
  resetLoginLogoAnimation();
  stopLoginAnimation();
}

function continueAsGuestSession() {
  currentUser = null;
  _applyRoleUI();
  setAppShellVisible(true);
  hideLoginModal();
  showPage('dashboard');
}

function playLoginLogoAnimation() {
  const shell = document.getElementById('login-logo-shell');
  const video = document.getElementById('login-logo-video');
  if (!shell || !video) return;
  shell.classList.add('is-animating');
  try {
    video.currentTime = 0.01;
  } catch (e) {
    console.warn('Failed rewinding login logo video:', e);
  }
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(err => {
      console.warn('Failed playing login logo video:', err);
      shell.classList.remove('is-animating');
    });
  }
}

function primeLoginLogoAnimation() {
  const video = document.getElementById('login-logo-video');
  if (!video || video.dataset.primed === 'true') return;

  const applyFirstFrame = () => {
    try {
      video.currentTime = 0.01;
      video.pause();
      video.dataset.primed = 'true';
    } catch (e) {
      console.warn('Failed priming login logo video:', e);
    }
  };

  if (video.readyState >= 2) {
    applyFirstFrame();
    return;
  }

  video.addEventListener('loadeddata', applyFirstFrame, { once: true });
  video.load();
}

function showLoginModal(tab = 'signin') {
  const o = document.getElementById('login-overlay');
  assignSessionCrown();
  setAppShellVisible(false);
  switchLoginTab(tab);
  primeLoginLogoAnimation();
  resetLoginLogoAnimation();
  if (o) { o.style.display = 'flex'; startLoginAnimation(); }
}

function switchLoginTab(tab) {
  const isSignin = tab === 'signin';
  const isRegister = tab === 'register';
  const siBtn = document.getElementById('tab-signin-btn');
  const regBtn = document.getElementById('tab-register-btn');
  const submitBtn = document.getElementById('login-submit-btn');
  const tokenWrap = document.getElementById('login-register-token-wrap');
  const pinWrap = document.getElementById('login-pin-wrap');
  if (siBtn)  { siBtn.style.color  = isSignin ? '#00d4ff' : '#4a5568'; siBtn.style.borderBottomColor  = isSignin ? '#00d4ff' : 'transparent'; }
  if (regBtn) { regBtn.style.color = isSignin ? '#4a5568' : '#00d4ff'; regBtn.style.borderBottomColor = isSignin ? 'transparent' : '#00d4ff'; }
  _setLoginButtonLabel(isSignin ? 'Sign In' : 'Create Account');
  submitBtn._mode = tab;
  if (tokenWrap) tokenWrap.style.display = isRegister ? 'block' : 'none';
  if (pinWrap) pinWrap.style.display = 'block';
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';
  const helpEl = document.getElementById('login-help');
  if (helpEl) helpEl.style.display = 'none';
}

function _setLoginHelp(msg) {
  const el = document.getElementById('login-help');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function _setLoginButtonLabel(text) {
  const btnText = document.getElementById('login-btn-text');
  if (btnText) {
    btnText.textContent = text;
    return;
  }
  const btn = document.getElementById('login-submit-btn');
  if (btn) btn.textContent = text;
}

async function _finalizeAuthenticatedSession(user) {
  currentUser = user;
  assignSessionCrown(true);
  try { sessionStorage.removeItem(SESSION_CROWN_KEY); } catch (e) {}
  window.location.reload();
}

async function submitLogin() {
  const nameEl = document.getElementById('login-name');
  const pinEl  = document.getElementById('login-pin');
  const tokenEl = document.getElementById('login-job-token');
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-submit-btn');
  const name   = (nameEl.value || '').trim();
  const pin    = (pinEl.value || '').trim();
  const jobToken = (tokenEl.value || '').trim();
  const mode   = btn._mode || 'signin';

  if (errEl) errEl.style.display = 'none';
  const helpEl = document.getElementById('login-help');
  if (helpEl) helpEl.style.display = 'none';
  if (mode === 'signin' && (!name || !pin)) { _loginError('Please enter your name and PIN'); return; }
  if (mode === 'register' && (!name || !pin || !jobToken)) { _loginError('Name, PIN, and job token are required'); return; }

  btn.disabled = true;
  _setLoginButtonLabel('...');
  playLoginLogoAnimation();

  try {
    let endpoint = '/api/auth/login';
    let payload = { name, pin };
    if (mode === 'register') {
      endpoint = '/api/auth/register';
      payload = { name, pin, job_token: jobToken };
    }
    const r = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (!r.ok) {
      resetLoginLogoAnimation();
      _loginError(d.error || 'Error');
    } else if (d.user) {
      if (mode === 'register' && d.message) {
        _setLoginHelp(d.message);
      }
      await _finalizeAuthenticatedSession(d.user);
    }
  } catch(e) {
    resetLoginLogoAnimation();
    _loginError('Network error — try again');
  }

  btn.disabled = false;
  _setLoginButtonLabel(mode === 'register' ? 'Create Account' : 'Sign In');
}

function _loginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  currentUser = null;
  allTrackers = [];
  currentTracker = null;
  trackerWasExplicitlyChosen = false;
  renderHeaderTrackerSwitcher();
  try { sessionStorage.removeItem(SESSION_CROWN_KEY); } catch (e) {}
  _applyRoleUI();
  if (_socket) { _socket.disconnect(); _socket = null; }
  showLoginModal();
}

// ── Socket.IO client ──────────────────────────────────────────
function _initSocket() {
  if (_socket) return;  // already connected
  if (typeof io === 'undefined') return;  // socket.io CDN not loaded

  _socket = io({ transports: ['polling', 'websocket'] });

  _socket.on('status_update', function(data) {
    // Update cached PB data
    const pbIdx = mapPBs.findIndex(p => p.id === data.pb_id);
    if (pbIdx >= 0) {
      const pb = mapPBs[pbIdx];
      const lbd = (pb.lbds || []).find(l => l.id === data.lbd_id);
      if (lbd) {
        const st = (lbd.statuses || []).find(s => s.status_type === data.status_type);
        if (st) st.is_completed = data.is_completed;
        if (pb.lbd_summary) {
          pb.lbd_summary[data.status_type] =
            (pb.lbds || []).filter(l =>
              (l.statuses || []).some(s => s.status_type === data.status_type && s.is_completed)
            ).length;
        }
      }
      // Targeted marker color update instead of full rebuild
      _updateMarkerColor(pb);
    }
    // If panel is open for this PB, refresh the button + stats
    if (activePBId === data.pb_id) {
      const btn = document.getElementById(`status-btn-${data.lbd_id}-${data.status_type}`);
      if (btn && btn.dataset.ownUpdate === '1') { btn.dataset.ownUpdate = '0'; return; }
      api.getPowerBlock(data.pb_id).then(r => {
        const i = mapPBs.findIndex(p => p.id === data.pb_id);
        if (i >= 0) mapPBs[i] = r.data;
        if (activePBId === data.pb_id) showPBPanel(r.data);
      }).catch(() => {});
    }
  });

  _socket.on('bulk_update', function(data) {
    api.getPowerBlock(data.pb_id).then(r => {
      const i = mapPBs.findIndex(p => p.id === data.pb_id);
      if (i >= 0) mapPBs[i] = r.data;
      _updateMarkerColor(r.data);
      if (activePBId === data.pb_id) showPBPanel(r.data);
    }).catch(() => {});
  });

  _socket.on('claim_update', function(data) {
    if (!currentTracker || !currentTracker.id) return;
    api.getPowerBlock(data.pb_id, currentTracker.id).then(r => {
      const nextBlock = r.data;
      const mapIndex = mapPBs.findIndex(p => p.id === data.pb_id);
      if (mapIndex >= 0) {
        mapPBs[mapIndex] = nextBlock;
        _updateMarkerColor(nextBlock);
      }
      _blocksCache[data.pb_id] = nextBlock;
      _allBlocksData = _allBlocksData.map(block => block.id === data.pb_id ? nextBlock : block);
      claimPageState.blocks = claimPageState.blocks.map(block => block.id === data.pb_id ? nextBlock : block);
      if (pageName === 'claim') {
        renderClaimPage();
      }
      if (activePBId === data.pb_id) {
        showPBPanel(nextBlock);
      }
    }).catch(() => {});
  });

  _socket.on('live_activity', function(data) {
    pushLiveActivityEvent(data);
  });
}

// ─────────────────────────────────────────────────────────────


async function loadAdminSettings() {
  try {
    const r = await api.getAdminSettings();
    const d = r.data;
    adminSettings = d;
    LBD_STATUS_TYPES = d.all_columns || LBD_STATUS_TYPES;
    STATUS_COLORS    = Object.assign({}, STATUS_COLORS, d.colors || {});
    STATUS_LABELS    = {};
    LBD_STATUS_TYPES.forEach(k => {
      STATUS_LABELS[k] = (d.names && d.names[k]) ? d.names[k] : k.replace(/_/g,' ');
    });
    // Load persisted zone names from settings
    if (Array.isArray(d.zone_names) && d.zone_names.length > 0) {
      _adminZoneNames = d.zone_names.slice();
    }
    applyAppearance(d.appearance);
    applyUIText(d.ui_text);
  } catch(e) { console.warn('Admin settings not loaded:', e); }
  renderLegend();
}

function applyAppearance(a) {
  if (!a) return;
  const root = document.documentElement;
  if (a.color_cyan)   root.style.setProperty('--cyan', a.color_cyan);
  if (a.color_purple) root.style.setProperty('--purple', a.color_purple);
  if (a.color_green)  root.style.setProperty('--green', a.color_green);
  if (a.color_red)    root.style.setProperty('--red', a.color_red);
  if (a.color_bg)     root.style.setProperty('--bg', a.color_bg);
  if (a.pb_number_color) root.style.setProperty('--pb-number-color', a.pb_number_color);
  if (a.pb_number_active_color) root.style.setProperty('--pb-number-active-color', a.pb_number_active_color);
  if (a.pb_number_outline_color) root.style.setProperty('--pb-number-outline-color', a.pb_number_outline_color);
  const set = (id, val) => { if (val !== undefined && val !== null) { const e = document.getElementById(id); if (e) e.textContent = val; } };
  // brand-rest1 holds everything after the leading "P"
  if (a.brand_word1 !== undefined) {
    const e = document.getElementById('brand-rest1');
    if (e) e.textContent = a.brand_word1.replace(/^P/i, '');
  }
  set('brand-sep-sym',      a.brand_sep);
  set('brand-word2',        a.brand_word2);
  set('login-title-text',   a.login_title);
  set('login-subtitle-text',a.login_subtitle);
  set('login-btn-text',     a.login_btn);
}

function applyUIText(t) {
  if (!t) return;
  const navWorklog = t.nav_worklog === 'Work Log' ? 'Claim' : t.nav_worklog;
  const titleWorklog = t.title_worklog === 'Work Log' ? 'Claim' : t.title_worklog;
  const pairs = {
    'nav-link-dashboard': t.nav_dashboard,
    'nav-link-upload':    t.nav_upload,
    'nav-link-blocks':    t.nav_blocks,
    'nav-link-sitemap':   t.nav_sitemap,
    'nav-link-claim':     navWorklog,
    'nav-link-reports':   t.nav_reports,
    'nav-link-admin':     t.nav_admin,
    'page-title-dashboard': t.title_dashboard,
    'page-title-blocks':    t.title_blocks,
    'page-title-upload':    t.title_upload,
    'page-title-claim':     titleWorklog,
    'page-title-reports':   t.title_reports,
    'page-title-admin':     t.title_admin,
  };
  for (const [id, val] of Object.entries(pairs)) {
    if (val !== undefined && val !== '') {
      const e = document.getElementById(id);
      if (e) e.textContent = val;
    }
  }
  // Dashboard subtitle element (not a page title h1)
  if (t.sub_dashboard) {
    const e = document.getElementById('page-subtitle-dashboard');
    if (e) e.textContent = t.sub_dashboard;
  }
}

function previewThemeColor(cssVar, value) {
  document.documentElement.style.setProperty(cssVar, value);
}

function renderLegend() {
  const el = document.getElementById('legend-items');
  if (!el) return;
  const legend = document.getElementById('map-legend');
  const overlayMode = currentTracker ? 'tracker' : 'baseline';
  if (legend) {
    legend.style.display = overlayMode === 'tracker' ? 'flex' : 'none';
  }
  if (overlayMode !== 'tracker') {
    el.innerHTML = '';
    return;
  }
  // Fixed entries always present
  let html = `
    <span style="width:11px;height:11px;background:#6c757d;border-radius:3px;display:inline-block;"></span>Not started
    <span style="width:11px;height:11px;background:#ffc107;border-radius:3px;display:inline-block;"></span>In progress`;
  // Dynamic entries from current STATUS_TYPES
  LBD_STATUS_TYPES.forEach(k => {
    const color = STATUS_COLORS[k] || '#888';
    const label = STATUS_LABELS[k] || k.replace(/_/g,' ');
    html += `<span style="width:11px;height:11px;background:${color};border-radius:3px;display:inline-block;"></span>${label}`;
  });
  html += `<span style="width:11px;height:11px;background:#28a745;border-radius:3px;display:inline-block;"></span>All Complete`;
  el.innerHTML = html;
}

let mapPBs = [];
let mapEditMode = false;
let dragState = null;
let activePBId = null;

// Default PB rectangle size (percentage of map)
const DEFAULT_PB_W = 1.4;
const DEFAULT_PB_H = 5.0;

// ── Snap-to-outline placement state ──
let snapPlaceMode = false;
let snapPlaceQueue = [];   // ordered PB ids remaining to place
let snapPlaceMapId = null; // cached map id for snap API calls
let snapClearOneMode = false; // click-to-clear individual PB mode
let pbPolygons = JSON.parse(localStorage.getItem('pb_polygons') || '{}');
let pbLabelColors = JSON.parse(localStorage.getItem('pb_label_colors') || '{}'); // keyed by PB id string
let labelAdjustMode = false;
// also store all loaded areas so admin tab can list them
let loadedMapAreas = [];
let pbLabelOffsets = JSON.parse(localStorage.getItem('pb_label_offsets') || '{}'); // keyed by PB id string
let siteMapViewState = {
  currentMap: null,
};
const DEFAULT_PB_LABEL_POSITION_OVERRIDES = {
  '11': { x: 4, y: 1 },
  '33': { x: -3, y: 0 },
  '48': { x: -3, y: 2 },
  '81': { x: 2, y: -2 },
  '117': { x: 0, y: -1 },
  '118': { x: 0, y: -1 },
  '119': { x: 0, y: -1 },
};
const MAX_SNAP_BBOX_W_PCT = 20;
const MAX_SNAP_BBOX_H_PCT = 20;
const MAX_SNAP_BBOX_AREA_PCT = 80;

// Snap threshold in % of map dimensions

function isReasonableMapBBox(bbox) {
  if (!bbox) return false;
  const width = Number(bbox.w ?? bbox.w_pct);
  const height = Number(bbox.h ?? bbox.h_pct);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  return width <= MAX_SNAP_BBOX_W_PCT
    && height <= MAX_SNAP_BBOX_H_PCT
    && (width * height) <= MAX_SNAP_BBOX_AREA_PCT;
}

function normalizeMapBBox(bbox) {
  if (!bbox) return null;
  const x = Number(bbox.x ?? bbox.x_pct);
  const y = Number(bbox.y ?? bbox.y_pct);
  const w = Number(bbox.w ?? bbox.w_pct);
  const h = Number(bbox.h ?? bbox.h_pct);
  if (![x, y, w, h].every(Number.isFinite)) {
    return null;
  }
  return { x, y, w, h };
}

function clearPBHiddenState(pbId) {
  const normalizedId = String(pbId);
  const hidden = JSON.parse(localStorage.getItem('pb_hidden') || '[]')
    .filter((id) => String(id) !== normalizedId);
  localStorage.setItem('pb_hidden', JSON.stringify(hidden));
}

function getNearbySnapReferenceBBox(pbId, xPct, yPct) {
  const targetId = String(pbId);
  const candidates = [];
  const savedBboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');

  Object.entries(savedBboxes).forEach(([candidateId, bbox]) => {
    if (candidateId === targetId) return;
    const normalized = normalizeMapBBox(bbox);
    if (!isReasonableMapBBox(normalized)) return;
    candidates.push(normalized);
  });

  loadedMapAreas.forEach((area) => {
    if (!area || String(area.power_block_id) === targetId) return;
    const normalized = normalizeMapBBox({
      x: area.bbox_x,
      y: area.bbox_y,
      w: area.bbox_w,
      h: area.bbox_h
    });
    if (!isReasonableMapBBox(normalized)) return;
    candidates.push(normalized);
  });

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    const leftCx = left.x + (left.w / 2);
    const leftCy = left.y + (left.h / 2);
    const rightCx = right.x + (right.w / 2);
    const rightCy = right.y + (right.h / 2);
    const leftDist = Math.hypot(leftCx - xPct, leftCy - yPct);
    const rightDist = Math.hypot(rightCx - xPct, rightCy - yPct);
    return leftDist - rightDist;
  });

  const sample = candidates.slice(0, Math.min(3, candidates.length));
  return {
    w: sample.reduce((sum, bbox) => sum + bbox.w, 0) / sample.length,
    h: sample.reduce((sum, bbox) => sum + bbox.h, 0) / sample.length,
  };
}

function buildOversizedSnapFallbackBBox(pbId, clickXPct, clickYPct, sourceBbox) {
  const normalizedSource = normalizeMapBBox(sourceBbox);
  const anchorX = normalizedSource ? normalizedSource.x + (normalizedSource.w / 2) : clickXPct;
  const anchorY = normalizedSource ? normalizedSource.y + (normalizedSource.h / 2) : clickYPct;
  const reference = getNearbySnapReferenceBBox(pbId, anchorX, anchorY);
  const width = reference ? reference.w : DEFAULT_PB_W;
  const height = reference ? reference.h : DEFAULT_PB_H;
  return {
    x: Math.max(0, Math.min(100 - width, anchorX - (width / 2))),
    y: Math.max(0, Math.min(100 - height, anchorY - (height / 2))),
    w: width,
    h: height,
  };
}

function getPBLabelOffset(pbKey) {
  const fallback = DEFAULT_PB_LABEL_POSITION_OVERRIDES[pbKey] || { x: 0, y: 0 };
  const saved = pbLabelOffsets[pbKey];
  if (!saved) return fallback;
  return {
    x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : fallback.x,
    y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : fallback.y,
  };
}
const SNAP_THRESHOLD = 1.2;

function getRenderableMapPBs() {
  if (Array.isArray(mapPBs) && mapPBs.length > 0) {
    return mapPBs;
  }
  if (!Array.isArray(loadedMapAreas) || loadedMapAreas.length === 0) {
    return [];
  }
  const seen = new Set();
  return loadedMapAreas
    .filter((area) => {
      if (!area || area.bbox_x == null) return false;
      const pid = area.power_block_id || area.id;
      if (seen.has(pid)) return false;
      seen.add(pid);
      return true;
    })
    .map((area) => ({
      id: area.power_block_id || area.id,
      name: area.name,
      power_block_number: area.name,
      bbox_x: area.bbox_x,
      bbox_y: area.bbox_y,
      bbox_w: area.bbox_w,
      bbox_h: area.bbox_h,
      polygon: area.polygon,
      lbd_count: 0,
      lbd_summary: {},
      lbds: [],
      __baseline_only: true,
    }));
}

function getMapPBVisualState(pb) {
  const lbds = pb?.lbds || [];
  const total = Number(pb?.lbd_count || lbds.length || 0);

  // block_only tracking: completion is the block flag, no per-item breakdown
  if (currentTracker?.tracking_mode === 'block_only') {
    const allDone = !!pb.is_completed;
    const inProgress = !allDone && !!pb.claimed_by;
    return { total: 0, summary: {}, completedTypes: [], partialTypes: [], allDone, inProgress };
  }

  const summary = pb?.lbd_summary || {};
  const completedTypes = [];
  const partialTypes = [];

  // When a tracker is active, evaluate completion only against its status types
  const effectiveStatusTypes = (currentTracker && Array.isArray(currentTracker.status_types) && currentTracker.status_types.length)
    ? currentTracker.status_types
    : LBD_STATUS_TYPES;

  for (const st of effectiveStatusTypes) {
    const done = Number(summary[st] || 0);
    if (total > 0 && done >= total) {
      completedTypes.push(st);
    } else if (done > 0) {
      partialTypes.push(st);
    }
  }

  // A block is fully done when every tracker status type is 100% completed
  const allDone = total > 0 && completedTypes.length === effectiveStatusTypes.length && completedTypes.length > 0;
  const inProgress = completedTypes.length > 0 || partialTypes.length > 0;
  return { total, summary, completedTypes, partialTypes, allDone, inProgress };
}

function updateSiteMapOverlayButtons() {
  return;
}

function renderSiteMapSummary() {
  const subtitle = document.getElementById('sitemap-viewer-subtitle');
  const summary = document.getElementById('sitemap-summary-strip');
  const renderablePBs = getRenderableMapPBs();
  const trackerName = currentTracker?.name || 'Overview (No Tracker)';
  const completed = mapPBs.filter((pb) => getMapPBVisualState(pb).allDone).length;
  const inProgress = mapPBs.filter((pb) => getMapPBVisualState(pb).inProgress && !getMapPBVisualState(pb).allDone).length;
  const claimed = mapPBs.filter((pb) => pb.claimed_by).length;

  if (subtitle) {
    subtitle.textContent = currentTracker
      ? `${trackerName} is active on the map.`
      : 'No tracker is active. The map is showing the neutral overview until you choose one.';
  }

  if (summary) {
    summary.innerHTML = `
      <div class="sitemap-summary-card">
        <span class="sitemap-summary-label">Tracker</span>
        <strong>${_escapeHtml(trackerName)}</strong>
      </div>
      <div class="sitemap-summary-card">
        <span class="sitemap-summary-label">${currentTracker?.block_label_plural || 'Power Blocks'}</span>
        <strong>${renderablePBs.length}</strong>
      </div>
      <div class="sitemap-summary-card">
        <span class="sitemap-summary-label">Completed</span>
        <strong>${completed}</strong>
      </div>
      <div class="sitemap-summary-card">
        <span class="sitemap-summary-label">In Progress</span>
        <strong>${inProgress}</strong>
      </div>
      <div class="sitemap-summary-card">
        <span class="sitemap-summary-label">Claimed</span>
        <strong>${claimed}</strong>
      </div>`;
  }

  updateSiteMapOverlayButtons();
  renderLegend();
}

function setSiteMapOverlayMode(mode) {
  renderSiteMapSummary();
  renderPBMarkers();
}

// Find the best snap target: check all 4 corners of the dragged rect against
// all 4 corners of every other placed marker. Returns {x, y, w, h} or null.
function findSnapTarget(dragId, rawX, rawY, rawW, rawH) {
  const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  // Corners of the dragged rect: TL, TR, BL, BR
  const dragCorners = [
    { cx: rawX,        cy: rawY },        // top-left
    { cx: rawX + rawW, cy: rawY },        // top-right
    { cx: rawX,        cy: rawY + rawH }, // bottom-left
    { cx: rawX + rawW, cy: rawY + rawH }  // bottom-right
  ];

  let bestDist = SNAP_THRESHOLD;
  let bestSnap = null;

  for (const [id, b] of Object.entries(bboxes)) {
    if (String(id) === String(dragId)) continue;
    // Corners of this target
    const targetCorners = [
      { cx: b.x,       cy: b.y },        // TL
      { cx: b.x + b.w, cy: b.y },        // TR
      { cx: b.x,       cy: b.y + b.h },  // BL
      { cx: b.x + b.w, cy: b.y + b.h }   // BR
    ];
    for (let di = 0; di < 4; di++) {
      for (let ti = 0; ti < 4; ti++) {
        const dx = dragCorners[di].cx - targetCorners[ti].cx;
        const dy = dragCorners[di].cy - targetCorners[ti].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          // Offset so dragged corner aligns with target corner, adopt target size
          const snapX = targetCorners[ti].cx - (di % 2 === 1 ? b.w : 0);
          const snapY = targetCorners[ti].cy - (di >= 2    ? b.h : 0);
          bestSnap = { x: snapX, y: snapY, w: b.w, h: b.h, targetId: id };
        }
      }
    }
  }
  return bestSnap;
}

// Clear any existing snap highlight
function clearSnapHighlight() {
  document.querySelectorAll('.pb-snap-highlight').forEach(el => el.classList.remove('pb-snap-highlight'));
}

// Single global drag handlers (supports move + resize + snap)
document.addEventListener('mousemove', e => {
  if (!dragState) return;
  if (dragState.mode === 'label-move') {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const nextX = Math.max(-18, Math.min(18, dragState.origLabelX + dx));
    const nextY = Math.max(-18, Math.min(18, dragState.origLabelY + dy));
    dragState.labelEl.style.transform = `translate(${nextX}px, ${nextY}px)`;
    return;
  }
  const container = document.getElementById('map-container');
  if (!container) return;
  const cW = container.offsetWidth;
  const cH = container.offsetHeight;
  const dxPct = (e.clientX - dragState.startX) / cW * 100;
  const dyPct = (e.clientY - dragState.startY) / cH * 100;

  if (dragState.mode === 'move') {
    let newX = Math.max(0, Math.min(100 - dragState.origW, dragState.origX + dxPct));
    let newY = Math.max(0, Math.min(100 - dragState.origH, dragState.origY + dyPct));
    let curW = parseFloat(dragState.marker.style.width);
    let curH = parseFloat(dragState.marker.style.height);

    // Try to snap (hold Shift to disable)
    clearSnapHighlight();
    if (!e.shiftKey) {
      const snap = findSnapTarget(dragState.pbId, newX, newY, curW, curH);
      if (snap) {
        newX = snap.x;
        newY = snap.y;
        curW = snap.w;
        curH = snap.h;
        dragState.marker.style.width  = curW + '%';
        dragState.marker.style.height = curH + '%';
        const targetEl = document.querySelector(`[data-pb-id="${snap.targetId}"]`);
        if (targetEl) targetEl.classList.add('pb-snap-highlight');
        dragState.snapped = true;
      } else {
        dragState.snapped = false;
      }
    } else {
      dragState.snapped = false;
    }

    dragState.marker.style.left = newX + '%';
    dragState.marker.style.top  = newY + '%';
  } else if (dragState.mode === 'resize') {
    const corner = dragState.corner || 'br';
    let newX = dragState.origX, newY = dragState.origY;
    let newW = dragState.origW, newH = dragState.origH;

    if (corner === 'br') {
      newW = Math.max(0.5, dragState.origW + dxPct);
      newH = Math.max(0.5, dragState.origH + dyPct);
    } else if (corner === 'bl') {
      newW = Math.max(0.5, dragState.origW - dxPct);
      newH = Math.max(0.5, dragState.origH + dyPct);
      newX = dragState.origX + dragState.origW - newW;
    } else if (corner === 'tr') {
      newW = Math.max(0.5, dragState.origW + dxPct);
      newH = Math.max(0.5, dragState.origH - dyPct);
      newY = dragState.origY + dragState.origH - newH;
    } else if (corner === 'tl') {
      newW = Math.max(0.5, dragState.origW - dxPct);
      newH = Math.max(0.5, dragState.origH - dyPct);
      newX = dragState.origX + dragState.origW - newW;
      newY = dragState.origY + dragState.origH - newH;
    }

    dragState.marker.style.left   = newX + '%';
    dragState.marker.style.top    = newY + '%';
    dragState.marker.style.width  = newW + '%';
    dragState.marker.style.height = newH + '%';
  }
});

document.addEventListener('mouseup', () => {
  if (!dragState) return;
  if (dragState.mode === 'label-move') {
    const pbId = String(dragState.pbId);
    const match = (dragState.labelEl.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    const nextOffset = {
      x: match ? Number(match[1]) : dragState.origLabelX,
      y: match ? Number(match[2]) : dragState.origLabelY,
    };
    pbLabelOffsets[pbId] = nextOffset;
    localStorage.setItem('pb_label_offsets', JSON.stringify(pbLabelOffsets));
    dragState.labelEl.style.cursor = 'grab';
    dragState = null;
    return;
  }
  clearSnapHighlight();
  dragState.marker.style.cursor = 'grab';
  dragState.marker.style.zIndex = '20';
  const pbId = dragState.pbId;
  const newX = parseFloat(dragState.marker.style.left);
  const newY = parseFloat(dragState.marker.style.top);
  const newW = parseFloat(dragState.marker.style.width);
  const newH = parseFloat(dragState.marker.style.height);

  const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  bboxes[String(pbId)] = { x: newX, y: newY, w: newW, h: newH };
  localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));

  // Shift/scale the snap polygon to stay in sync with the moved bbox
  const key = String(pbId);
  if (pbPolygons[key]) {
    if (dragState.mode === 'move') {
      const dx = newX - dragState.origX;
      const dy = newY - dragState.origY;
      pbPolygons[key] = pbPolygons[key].map(pt => ({
        x_pct: pt.x_pct + dx,
        y_pct: pt.y_pct + dy
      }));
    } else if (dragState.mode === 'resize') {
      const ox = dragState.origX, oy = dragState.origY;
      const ow = dragState.origW, oh = dragState.origH;
      pbPolygons[key] = pbPolygons[key].map(pt => ({
        x_pct: newX + (pt.x_pct - ox) / ow * newW,
        y_pct: newY + (pt.y_pct - oy) / oh * newH
      }));
    }
    localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));
  }

  dragState = null;
});

// ── Legend drag & resize (all edges) ──
(function initLegendDrag() {
  let legendDrag = null;
  
  function restoreLegendPos() {
    const saved = localStorage.getItem('legend_pos');
    if (!saved) return;
    try {
      const p = JSON.parse(saved);
      const leg = document.getElementById('map-legend');
      if (!leg) return;
      if (p.left != null) { leg.style.left = p.left + 'px'; leg.style.right = 'auto'; }
      if (p.top != null) leg.style.top = p.top + 'px';
      if (p.width != null) leg.style.width = p.width + 'px';
      if (p.height != null) leg.style.height = p.height + 'px';
    } catch(e) {}
  }

  document.addEventListener('DOMContentLoaded', restoreLegendPos);
  setTimeout(restoreLegendPos, 200);

  document.addEventListener('mousedown', e => {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    const edgeEl = e.target.closest('.legend-edge');

    if (edgeEl && legend.contains(edgeEl)) {
      e.preventDefault();
      e.stopPropagation();
      const rect = legend.getBoundingClientRect();
      const parentRect = legend.offsetParent.getBoundingClientRect();
      legendDrag = {
        mode: 'resize',
        edge: edgeEl.dataset.edge,
        el: legend,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left - parentRect.left,
        origTop: rect.top - parentRect.top,
        origW: legend.offsetWidth,
        origH: legend.offsetHeight
      };
    } else if (legend.contains(e.target)) {
      e.preventDefault();
      const rect = legend.getBoundingClientRect();
      const parentRect = legend.offsetParent.getBoundingClientRect();
      legendDrag = {
        mode: 'move',
        el: legend,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left - parentRect.left,
        origTop: rect.top - parentRect.top
      };
      legend.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', e => {
    if (!legendDrag) return;
    const dx = e.clientX - legendDrag.startX;
    const dy = e.clientY - legendDrag.startY;
    const el = legendDrag.el;

    if (legendDrag.mode === 'move') {
      el.style.left = (legendDrag.origLeft + dx) + 'px';
      el.style.top  = (legendDrag.origTop + dy) + 'px';
      el.style.right = 'auto';
    } else if (legendDrag.mode === 'resize') {
      const edge = legendDrag.edge;
      let newL = legendDrag.origLeft, newT = legendDrag.origTop;
      let newW = legendDrag.origW, newH = legendDrag.origH;

      if (edge === 'right'  || edge === 'br' || edge === 'tr') newW = Math.max(80, legendDrag.origW + dx);
      if (edge === 'left'   || edge === 'bl' || edge === 'tl') { newW = Math.max(80, legendDrag.origW - dx); newL = legendDrag.origLeft + legendDrag.origW - newW; }
      if (edge === 'bottom' || edge === 'br' || edge === 'bl') newH = Math.max(30, legendDrag.origH + dy);
      if (edge === 'top'    || edge === 'tr' || edge === 'tl') { newH = Math.max(30, legendDrag.origH - dy); newT = legendDrag.origTop + legendDrag.origH - newH; }

      el.style.left = newL + 'px';
      el.style.top  = newT + 'px';
      el.style.right = 'auto';
      el.style.width = newW + 'px';
      el.style.height = newH + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!legendDrag) return;
    legendDrag.el.style.cursor = 'grab';
    const pos = {
      left: parseInt(legendDrag.el.style.left),
      top: parseInt(legendDrag.el.style.top),
      width: legendDrag.el.offsetWidth,
      height: legendDrag.el.offsetHeight
    };
    localStorage.setItem('legend_pos', JSON.stringify(pos));
    legendDrag = null;
  });
})();

// ============================================================
// SNAP-TO-OUTLINE PLACEMENT MODE
// ============================================================

async function toggleSnapPlace() {
  snapPlaceMode = !snapPlaceMode;
  const btn = document.getElementById('snap-place-btn');
  const bar = document.getElementById('snap-place-bar');
  const hint = document.getElementById('snap-place-hint');

  if (snapPlaceMode) {
    // Exit edit mode if active
    if (mapEditMode) toggleMapEditMode();
    if (labelAdjustMode) toggleLabelAdjustMode();

    // Ensure map is registered
    let maps = await api.getAllSiteMaps().catch(() => ({data:[]}));
    let list = maps.data || [];
    if (list.length === 0) {
      try {
        await api.registerExistingMap();
        maps = await api.getAllSiteMaps();
        list = maps.data || [];
      } catch(e) { console.warn('register attempt failed:', e); }
    }
    if (list.length === 0) {
      alert('No site maps found. Upload a map first.');
      snapPlaceMode = false;
      return;
    }
    snapPlaceMapId = list[0].id;

    // Build placement queue: PBs sorted by number, skip already-polygoned ones
    const sorted = [...mapPBs].sort((a, b) => {
      const na = parseInt(a.power_block_number || a.name.replace(/\D/g, '')) || 0;
      const nb = parseInt(b.power_block_number || b.name.replace(/\D/g, '')) || 0;
      return na - nb;
    });
    snapPlaceQueue = sorted.map(pb => pb.id);

    // UI updates
    if (btn) { btn.textContent = '✅ Done Placing'; btn.classList.remove('btn-secondary'); btn.classList.add('btn-success'); }
    if (bar) bar.style.display = 'flex';
    if (hint) hint.style.display = 'block';
    updateSnapPlaceBar();

    // Add click handler to map image
    const mapImg = document.getElementById('sitemap-image');
    if (mapImg) mapImg.addEventListener('click', snapPlaceClick);

    const container = document.getElementById('map-container');
    if (container) container.style.cursor = 'crosshair';

    // Disable pointer-events on overlays so clicks reach the image
    const markers = document.getElementById('pb-markers');
    if (markers) markers.style.pointerEvents = 'none';
    const textLbls = document.getElementById('text-labels');
    if (textLbls) textLbls.style.pointerEvents = 'none';

  } else {
    // Exit snap-place mode
    snapClearOneMode = false;
    if (btn) { btn.textContent = '🎯 Snap Place'; btn.classList.remove('btn-success'); btn.classList.add('btn-secondary'); }
    if (bar) bar.style.display = 'none';
    if (hint) hint.style.display = 'none';

    const mapImg = document.getElementById('sitemap-image');
    if (mapImg) mapImg.removeEventListener('click', snapPlaceClick);

    const container = document.getElementById('map-container');
    if (container) container.style.cursor = '';

    // Re-enable pointer-events on overlays
    const markers = document.getElementById('pb-markers');
    if (markers) markers.style.pointerEvents = '';
    const textLbls = document.getElementById('text-labels');
    if (textLbls) textLbls.style.pointerEvents = '';

    // Clean up clear-one state
    snapClearOneMode = false;

    snapPlaceQueue = [];
    snapPlaceMapId = null;

    // Re-render to show polygon shapes
    renderPBMarkers();
  }
}

function updateSnapPlaceBar() {
  const bar = document.getElementById('snap-place-bar');
  if (!bar) return;

  const placed = Object.keys(pbPolygons).length;
  const total = mapPBs.length;
  const currentPbId = snapPlaceQueue.length > 0 ? snapPlaceQueue[0] : null;
  const currentPb = currentPbId ? mapPBs.find(p => p.id === currentPbId) : null;

  let html = `<span style="color:#00d4ff;font-weight:700;font-size:13px;">🎯 Snap Place Mode</span>`;
  html += `<span style="color:#8892b0;font-size:12px;margin-left:8px;">Placed: ${placed}/${total}</span>`;

  if (currentPb) {
    html += `<span style="color:#eef2ff;font-size:13px;margin-left:12px;">Next: <strong style="color:#ffc107;">${currentPb.name}</strong> — click inside its outline on the map</span>`;
  } else {
    html += `<span style="color:#28a745;font-size:13px;margin-left:12px;">All PBs placed!</span>`;
  }

  // Jump to PB # input
  html += `<span style="margin-left:12px;display:inline-flex;align-items:center;gap:4px;">`;
  html += `<label style="color:#8892b0;font-size:11px;">Go to PB #</label>`;
  html += `<input id="snap-place-goto" type="number" min="1" style="width:60px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#eef2ff;border-radius:6px;padding:3px 6px;font-size:12px;text-align:center;" onkeydown="if(event.key==='Enter')snapPlaceGoto()">`;
  html += `<button onclick="snapPlaceGoto()" style="background:rgba(0,212,255,0.15);border:1px solid rgba(0,212,255,0.3);color:#00d4ff;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;">Go</button>`;
  html += `</span>`;

  // Skip button
  if (currentPb) {
    html += `<button onclick="snapPlaceSkip()" style="margin-left:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#8892b0;border-radius:6px;padding:4px 12px;font-size:11px;cursor:pointer;">Skip ⏭</button>`;
  }

  // Undo button
  html += `<button onclick="snapPlaceUndo()" style="margin-left:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#ff8fa3;border-radius:6px;padding:4px 12px;font-size:11px;cursor:pointer;">Undo ↩</button>`;

  // Clear one PB toggle
  const clearOneActive = snapClearOneMode;
  html += `<button onclick="toggleSnapClearOne()" style="margin-left:6px;background:${clearOneActive ? 'rgba(255,76,106,0.3)' : 'rgba(255,193,7,0.12)'};border:1px solid ${clearOneActive ? 'rgba(255,76,106,0.5)' : 'rgba(255,193,7,0.3)'};color:${clearOneActive ? '#ff4c6a' : '#ffc107'};border-radius:6px;padding:4px 12px;font-size:11px;cursor:pointer;">${clearOneActive ? '❌ Cancel Clear' : '🗑 Clear One'}</button>`;

  // Clear all polygons
  html += `<button onclick="snapPlaceClearAll()" style="margin-left:6px;background:rgba(255,76,106,0.12);border:1px solid rgba(255,76,106,0.3);color:#ff8fa3;border-radius:6px;padding:4px 12px;font-size:11px;cursor:pointer;">Clear All</button>`;

  bar.innerHTML = html;
}

async function snapPlaceClick(e) {
  if (!snapPlaceMode || snapPlaceQueue.length === 0) return;
  e.preventDefault();
  e.stopPropagation();

  const mapImg = document.getElementById('sitemap-image');
  if (!mapImg) return;

  const rect = mapImg.getBoundingClientRect();
  const x_pct = ((e.clientX - rect.left) / rect.width) * 100;
  const y_pct = ((e.clientY - rect.top) / rect.height) * 100;

  const pbId = snapPlaceQueue[0];
  const pb = mapPBs.find(p => p.id === pbId);
  if (!pb) { snapPlaceQueue.shift(); updateSnapPlaceBar(); return; }

  // Show loading cursor
  const container = document.getElementById('map-container');
  if (container) container.style.cursor = 'wait';

  try {
    const result = await api.snapOutline(snapPlaceMapId, x_pct, y_pct);

    if (!result.success && result.error && !result.oversized) {
      showSnapFeedback('⚠ ' + result.error, 'warn');
      if (container) container.style.cursor = 'crosshair';
      return;
    }

    const polygon = Array.isArray(result.polygon) ? result.polygon : null;
    const bbox = normalizeMapBBox(result.bbox);
    const oversizedSnap = !!result.oversized || (bbox && !isReasonableMapBBox(bbox));
    const placementBbox = oversizedSnap
      ? buildOversizedSnapFallbackBBox(pbId, x_pct, y_pct, bbox)
      : bbox;
    const polygonToSave = oversizedSnap ? null : polygon;

    if (!oversizedSnap && (!polygon || polygon.length < 3)) {
      showSnapFeedback('⚠ No outline detected at that position. Try again.', 'warn');
      if (container) container.style.cursor = 'crosshair';
      return;
    }

    if (!placementBbox) {
      showSnapFeedback('⚠ Could not place this PB at that position. Try again.', 'warn');
      if (container) container.style.cursor = 'crosshair';
      return;
    }

    // Store polygon and bbox
    if (polygonToSave && polygonToSave.length >= 3) {
      pbPolygons[String(pbId)] = polygonToSave;
    } else {
      delete pbPolygons[String(pbId)];
    }
    localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));

    const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
    bboxes[String(pbId)] = {
      x: placementBbox.x,
      y: placementBbox.y,
      w: placementBbox.w,
      h: placementBbox.h
    };
    localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
    clearPBHiddenState(pbId);

    // Save to DB
    const areaResult = await api.createSiteArea({
      site_map_id: snapPlaceMapId,
      power_block_id: pbId,
      name: pb.name,
      bbox_x: placementBbox.x, bbox_y: placementBbox.y,
      bbox_w: placementBbox.w, bbox_h: placementBbox.h,
      polygon: polygonToSave,
      label_font_size: adminSettings.pb_label_font_size || 14
    });
    if (areaResult?.data) {
      loadedMapAreas = loadedMapAreas.filter((area) => String(area.power_block_id) !== String(pbId));
      loadedMapAreas.push(areaResult.data);
    }

    // Advance queue
    snapPlaceQueue.shift();

    const msg = oversizedSnap
      ? `📍 ${pb.name} placed using nearby PB size`
      : result.fallback
        ? `📍 ${pb.name} placed (no outline detected — default box used)`
        : `✅ ${pb.name} placed!`;
    showSnapFeedback(msg, oversizedSnap || result.fallback ? 'warn' : 'ok');

    // Re-render
    renderPBMarkers();
    updateSnapPlaceBar();

    // Flash the placed marker
    const marker = document.getElementById(`pb-marker-${pbId}`);
    if (marker) {
      marker.style.transition = 'filter 0.3s';
      marker.style.filter = 'brightness(1.8)';
      setTimeout(() => { marker.style.filter = ''; }, 600);
    }

  } catch(err) {
    console.error('Snap place error:', err);
    showSnapFeedback('❌ ' + (err.message || 'Detection failed'), 'warn');
  }

  if (container) container.style.cursor = 'crosshair';
}

function snapPlaceSkip() {
  if (snapPlaceQueue.length > 0) {
    // Move current PB to end of queue
    snapPlaceQueue.push(snapPlaceQueue.shift());
    updateSnapPlaceBar();
  }
}

function snapPlaceGoto() {
  const input = document.getElementById('snap-place-goto');
  if (!input) return;
  const num = parseInt(input.value);
  if (!num || num < 1) return;

  // Find the PB in the queue whose number matches
  const idx = snapPlaceQueue.findIndex(id => {
    const pb = mapPBs.find(p => p.id === id);
    if (!pb) return false;
    const pbNum = parseInt(pb.power_block_number || pb.name.replace(/\D/g, '')) || 0;
    return pbNum === num;
  });

  if (idx === -1) {
    // Not in queue — might already be placed or doesn't exist
    const pb = mapPBs.find(p => {
      const pbNum = parseInt(p.power_block_number || p.name.replace(/\D/g, '')) || 0;
      return pbNum === num;
    });
    if (!pb) {
      showSnapFeedback(`⚠ PB ${num} not found`, 'warn');
    } else {
      showSnapFeedback(`⚠ PB ${num} already placed`, 'warn');
    }
    return;
  }

  // Rotate queue so the target PB is at the front
  const before = snapPlaceQueue.splice(0, idx);
  snapPlaceQueue.push(...before);
  updateSnapPlaceBar();
  showSnapFeedback(`➡ Jumped to PB ${num}`, 'ok');
}

function snapPlaceUndo() {
  // Remove the most recently placed polygon
  const allIds = Object.keys(pbPolygons);
  if (allIds.length === 0) return;
  const lastId = allIds[allIds.length - 1];
  delete pbPolygons[lastId];
  localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));

  // Put it back at front of queue
  const numId = parseInt(lastId);
  if (!isNaN(numId)) {
    snapPlaceQueue.unshift(numId);
  }

  renderPBMarkers();
  updateSnapPlaceBar();
  showSnapFeedback('↩ Undid last placement', 'ok');
}

function toggleSnapClearOne() {
  snapClearOneMode = !snapClearOneMode;
  const markers = document.getElementById('pb-markers');
  const mapImg = document.getElementById('sitemap-image');
  const container = document.getElementById('map-container');

  if (snapClearOneMode) {
    // Enable clicking on markers, pause normal placement clicks
    if (markers) markers.style.pointerEvents = '';
    if (mapImg) mapImg.removeEventListener('click', snapPlaceClick);
    if (container) container.style.cursor = 'pointer';
    showSnapFeedback('Click a placed PB to clear it', 'ok');
  } else {
    // Restore normal snap-place behavior
    if (markers) markers.style.pointerEvents = 'none';
    if (mapImg) mapImg.addEventListener('click', snapPlaceClick);
    if (container) container.style.cursor = 'crosshair';
  }
  updateSnapPlaceBar();
}

function snapClearOnePB(pb) {
  // Remove polygon
  delete pbPolygons[String(pb.id)];
  localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));

  // Put it back in the queue
  const numId = parseInt(pb.id);
  if (!isNaN(numId) && !snapPlaceQueue.includes(numId)) {
    const pbNum = parseInt(pb.power_block_number || pb.name.replace(/\D/g, '')) || 0;
    let insertIdx = snapPlaceQueue.findIndex(id => {
      const qPb = mapPBs.find(p => p.id === id);
      const qNum = qPb ? (parseInt(qPb.power_block_number || qPb.name.replace(/\D/g, '')) || 0) : 0;
      return qNum > pbNum;
    });
    if (insertIdx === -1) insertIdx = snapPlaceQueue.length;
    snapPlaceQueue.splice(insertIdx, 0, numId);
  }

  showSnapFeedback(`\ud83d\uddd1 Cleared ${pb.name}`, 'ok');

  // Exit clear-one mode, restore normal placement
  snapClearOneMode = false;
  const markers = document.getElementById('pb-markers');
  if (markers) markers.style.pointerEvents = 'none';
  const mapImg = document.getElementById('sitemap-image');
  if (mapImg) mapImg.addEventListener('click', snapPlaceClick);
  const container = document.getElementById('map-container');
  if (container) container.style.cursor = 'crosshair';

  renderPBMarkers();
  updateSnapPlaceBar();
}

function snapPlaceClearAll() {
  if (!confirm('Remove all polygon shapes? (PB positions will remain)')) return;
  pbPolygons = {};
  localStorage.removeItem('pb_polygons');
  renderPBMarkers();
  updateSnapPlaceBar();
  showSnapFeedback('Cleared all polygon shapes', 'ok');
}

function showSnapFeedback(msg, type) {
  let el = document.getElementById('snap-feedback');
  if (!el) {
    el = document.createElement('div');
    el.id = 'snap-feedback';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 22px;border-radius:10px;font-size:13px;font-weight:600;font-family:Inter,sans-serif;pointer-events:none;transition:opacity 0.4s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  if (type === 'ok') {
    el.style.background = 'rgba(40,167,69,0.92)';
    el.style.color = '#fff';
  } else {
    el.style.background = 'rgba(255,193,7,0.92)';
    el.style.color = '#000';
  }
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

function syncOverlaySize() {
  const img = document.getElementById('sitemap-image');
  if (!img || !img.offsetWidth) return;
  const w = img.offsetWidth + 'px';
  const h = img.offsetHeight + 'px';
  const markers = document.getElementById('pb-markers');
  const overlays = document.getElementById('scan-region-overlays');
  const textLabels = document.getElementById('text-labels');
  if (markers) { markers.style.width = w; markers.style.height = h; }
  if (overlays) { overlays.style.width = w; overlays.style.height = h; }
  if (textLabels) { textLabels.style.width = w; textLabels.style.height = h; }
}

function onMapImageLoaded() {
  syncOverlaySize();
  renderPBMarkers();
  renderTextLabels();
}
window.addEventListener('resize', () => { syncOverlaySize(); });

function renderPBMarkers() {
  syncOverlaySize();
  const container = document.getElementById('pb-markers');
  if (!container) return;
  container.innerHTML = '';

  const renderablePBs = getRenderableMapPBs();
  const savedBboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  const hiddenPBs   = JSON.parse(localStorage.getItem('pb_hidden') || '[]');
  const hasPlacedLayout = Object.keys(savedBboxes).length > 0 || Object.keys(pbPolygons).length > 0 || loadedMapAreas.some((area) => area && area.bbox_x != null);

  renderablePBs.forEach((pb, i) => {
    if (hiddenPBs.includes(pb.id)) return;
    const key = String(pb.id);
    const savedBbox = normalizeMapBBox(savedBboxes[key]);

    // Look up area position from loadedMapAreas as fallback
    let areaBbox = null;
    const matchArea = loadedMapAreas.find(a => a && String(a.power_block_id) === key);
    if (matchArea && matchArea.bbox_x != null) {
      areaBbox = normalizeMapBBox({
        x: matchArea.bbox_x,
        y: matchArea.bbox_y,
        w: matchArea.bbox_w,
        h: matchArea.bbox_h
      });
    }

    const usableSavedBbox = isReasonableMapBBox(savedBbox) ? savedBbox : null;
    const usableAreaBbox = isReasonableMapBBox(areaBbox) ? areaBbox : null;

    // Legacy map view should only render PBs that have real saved positions once a layout exists.
    if (!usableSavedBbox && !usableAreaBbox && hasPlacedLayout && !mapEditMode && !snapPlaceMode) {
      return;
    }

    // Default grid layout for PBs that haven't been placed yet
    const col = i % 16;
    const row = Math.floor(i / 16);
    const defaultBbox = {
      x: col * (DEFAULT_PB_W + 0.3) + 1,
      y: row * (DEFAULT_PB_H + 0.5) + 1,
      w: DEFAULT_PB_W,
      h: DEFAULT_PB_H
    };
    const areaBboxBaseline = pb.__baseline_only && pb.bbox_x != null
      ? normalizeMapBBox({ x: pb.bbox_x, y: pb.bbox_y, w: pb.bbox_w, h: pb.bbox_h })
      : null;
    const usableBaselineBbox = isReasonableMapBBox(areaBboxBaseline) ? areaBboxBaseline : null;
    const bbox = usableSavedBbox || usableAreaBbox || usableBaselineBbox || defaultBbox;

    const { total, summary, completedTypes, partialTypes, allDone, inProgress } = getMapPBVisualState(pb);
    const isActive = false; // markers always render the same regardless of selection
    const num = (pb.power_block_number || pb.name.replace('INV-', '')).toString();
    const overlayMode = currentTracker ? 'tracker' : 'baseline';
    const hasActiveTracker = !!currentTracker;

    // Build background
    let bgStyle;
    if (overlayMode !== 'tracker') {
      bgStyle = 'linear-gradient(180deg, rgba(8,13,28,0.12), rgba(8,13,28,0.22))';
    } else if (allDone) {
      bgStyle = '#28a745';
    } else if (completedTypes.length >= 2) {
      const colors = completedTypes.map(t => STATUS_COLORS[t] || '#999');
      const step = 100 / colors.length;
      const stops = colors.map((c, idx) =>
        `${c} ${Math.round(idx * step)}%, ${c} ${Math.round((idx + 1) * step)}%`
      ).join(', ');
      bgStyle = `linear-gradient(135deg, ${stops})`;
    } else if (completedTypes.length === 1) {
      bgStyle = STATUS_COLORS[completedTypes[0]] || '#ffc107';
    } else if (partialTypes.length > 0) {
      bgStyle = '#ffc107';
    } else {
      bgStyle = '#6c757d';
    }

    // Per-tracker custom map color for in-progress markers
    if (overlayMode === 'tracker' && currentTracker?.map_color && inProgress && !allDone) {
      bgStyle = currentTracker.map_color;
    }

    const borderColor = overlayMode === 'tracker'
      ? (allDone ? '#1e7e34' : inProgress ? '#d39e00' : '#555')
      : 'rgba(138,223,255,0.48)';

    const m = document.createElement('div');
    m.id = `pb-marker-${pb.id}`;
    m.dataset.pbId = pb.id;

    // All markers are rectangles
    const configuredFontSize = Number(adminSettings?.pb_label_font_size || 14);
    const baseFontSize = Math.max(5, Math.min(9, Math.round(configuredFontSize * 0.4)));
    const digitPenalty = Math.max(0, num.length - 2);
    const fontSize = Math.max(4, baseFontSize - digitPenalty);
    const appearance = adminSettings?.appearance || {};
    const labelColor = hasActiveTracker
      ? (appearance.pb_number_active_color || '#ffffff')
      : (appearance.pb_number_color || '#ffffff');
    const outlineColor = appearance.pb_number_outline_color || '#000000';
    m.style.cssText = [
      'position:absolute',
      `left:${bbox.x}%`,
      `top:${bbox.y}%`,
      `width:${bbox.w}%`,
      `height:${bbox.h}%`,
      `background:${bgStyle}`,
      `border:${isActive ? '3px solid #fff' : '2px solid ' + borderColor}`,
      `box-shadow:${isActive ? '0 0 0 3px #0d6efd,0 4px 14px rgba(0,0,0,.6)' : (overlayMode === 'tracker' ? '0 2px 6px rgba(0,0,0,.3)' : '0 8px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)')}`,
      'border-radius:4px',
      'display:flex;flex-direction:column;align-items:center;justify-content:center',
      'color:transparent;font-weight:900',
      `font-size:${fontSize}px`,
      `cursor:${mapEditMode ? 'grab' : 'pointer'}`,
      'user-select:none',
      'z-index:20',
      'text-align:center;line-height:1.1',
      'overflow:hidden',
      'text-shadow:none',
      'padding:1px'
    ].join(';');

    // Apply polygon clip-path if this PB has been snap-placed (only in view mode)
    const matchedArea = loadedMapAreas.find(a => a && String(a.power_block_id) === key);
    const polyData = pbPolygons[key] || pb.polygon || (matchedArea && matchedArea.polygon);
    if (polyData && polyData.length >= 3 && !mapEditMode) {
      // Convert polygon points from map-% coords to element-relative %
      const clipPoints = polyData.map(pt => {
        const relX = ((pt.x_pct - bbox.x) / bbox.w * 100).toFixed(1);
        const relY = ((pt.y_pct - bbox.y) / bbox.h * 100).toFixed(1);
        return `${relX}% ${relY}%`;
      }).join(', ');
      m.style.clipPath = `polygon(${clipPoints})`;
      m.style.webkitClipPath = `polygon(${clipPoints})`;
      m.style.borderRadius = '0';
      m.style.border = 'none';
      // Use drop-shadow to create an outline effect around the clipped shape
      m.style.filter = overlayMode === 'tracker'
        ? `drop-shadow(0 0 1.5px ${borderColor}) drop-shadow(0 0 0.5px #000)`
        : 'drop-shadow(0 0 2px rgba(138,223,255,0.55)) drop-shadow(0 0 12px rgba(0,0,0,0.28))';
    }

    // Tooltip with full info
    const statusInfo = LBD_STATUS_TYPES.map(st => {
      const done = summary[st] || 0;
      return `${STATUS_LABELS[st] || st}: ${done}/${total}`;
    }).join(' | ');
    m.title = `PB ${pb.name} — ${total} LBDs\n${statusInfo}`;

    // PB number — centered, unaffected by "In Progress" label
    const labelOffset = getPBLabelOffset(key);
    const numSpan = document.createElement('span');
    numSpan.textContent = num;
    numSpan.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;white-space:nowrap;max-width:100%;text-overflow:clip;z-index:1;pointer-events:none;color:${labelColor};font-weight:900;text-shadow:-1px -1px 0 ${outlineColor}, 1px -1px 0 ${outlineColor}, -1px 1px 0 ${outlineColor}, 1px 1px 0 ${outlineColor}, 0 0 8px rgba(0,0,0,0.35);-webkit-text-stroke:1px ${outlineColor};paint-order:stroke fill;transform:translate(${labelOffset.x}px, ${labelOffset.y}px);`;
    m.appendChild(numSpan);

    // "In Progress" indicator — absolutely positioned so it doesn't shift the number
    if (overlayMode === 'tracker' && inProgress && !allDone) {
      const ipSpan = document.createElement('span');
      ipSpan.textContent = 'In Progress';
      const ipFontSize = Math.max(5, Math.min(10, fontSize * 0.4));
      ipSpan.style.cssText = `position:absolute;bottom:1px;left:0;right:0;text-align:center;font-size:${ipFontSize}px;opacity:0.85;white-space:nowrap;letter-spacing:0.2px;overflow:hidden;z-index:1;`;
      m.appendChild(ipSpan);
    }

    if (mapEditMode) {
      // Delete/hide button (top-right corner)
      const delBtn = document.createElement('div');
      delBtn.title = 'Hide this PB from the map';
      delBtn.style.cssText = 'position:absolute;top:-7px;right:-7px;width:15px;height:15px;background:#dc3545;color:#fff;border-radius:50%;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:30;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.4);';
      delBtn.textContent = '×';
      delBtn.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        const hidden = JSON.parse(localStorage.getItem('pb_hidden') || '[]');
        if (!hidden.includes(pb.id)) hidden.push(pb.id);
        localStorage.setItem('pb_hidden', JSON.stringify(hidden));
        renderPBMarkers();
      });
      m.appendChild(delBtn);

      // Move handler on the main body
      m.addEventListener('mousedown', e => {
        if (e.target.classList.contains('pb-resize-handle')) return; // let resize handle take it
        e.preventDefault();
        dragState = {
          mode: 'move',
          marker: m,
          pbId: pb.id,
          startX: e.clientX,
          startY: e.clientY,
          origX: parseFloat(m.style.left),
          origY: parseFloat(m.style.top),
          origW: parseFloat(m.style.width),
          origH: parseFloat(m.style.height)
        };
        m.style.cursor = 'grabbing';
        m.style.zIndex = '100';
      });

      // Resize handles on all 4 corners
      const corners = [
        { key: 'tl', css: 'left:0;top:0',     cursor: 'nwse-resize', radius: '4px 0 0 0' },
        { key: 'tr', css: 'right:0;top:0',    cursor: 'nesw-resize', radius: '0 4px 0 0' },
        { key: 'bl', css: 'left:0;bottom:0',  cursor: 'nesw-resize', radius: '0 0 0 4px' },
        { key: 'br', css: 'right:0;bottom:0', cursor: 'nwse-resize', radius: '0 0 4px 0' }
      ];
      corners.forEach(c => {
        const handle = document.createElement('div');
        handle.className = 'pb-resize-handle';
        handle.style.cssText = [
          'position:absolute',
          c.css,
          'width:10px;height:10px',
          'background:rgba(255,255,255,0.8)',
          `cursor:${c.cursor}`,
          `border-radius:${c.radius}`,
          'z-index:25'
        ].join(';');
        handle.addEventListener('mousedown', e => {
          e.preventDefault();
          e.stopPropagation();
          dragState = {
            mode: 'resize',
            corner: c.key,
            marker: m,
            pbId: pb.id,
            startX: e.clientX,
            startY: e.clientY,
            origX: parseFloat(m.style.left),
            origY: parseFloat(m.style.top),
            origW: parseFloat(m.style.width),
            origH: parseFloat(m.style.height)
          };
          m.style.zIndex = '100';
        });
        m.appendChild(handle);
      });
    } else if (labelAdjustMode) {
      m.style.cursor = 'default';
      numSpan.style.pointerEvents = 'auto';
      numSpan.style.cursor = 'grab';
      numSpan.title = `Drag PB ${num} number only`;
      numSpan.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const currentOffset = getPBLabelOffset(key);
        dragState = {
          mode: 'label-move',
          labelEl: numSpan,
          pbId: pb.id,
          startX: e.clientX,
          startY: e.clientY,
          origLabelX: currentOffset.x,
          origLabelY: currentOffset.y,
        };
        numSpan.style.cursor = 'grabbing';
      });
    } else {
      // View mode: click fetches fresh data and opens panel
      m.style.cursor = mapDeleteMode ? 'crosshair' : (zoneAssignMode ? 'cell' : 'pointer');
      m.addEventListener('click', async () => {
        // Intercept click in delete mode
        if (mapDeleteMode) {
          instantDeleteArea(pb);
          return;
        }
        // Intercept click in zone assign mode
        if (zoneAssignMode) {
          assignZoneToMarker(pb);
          return;
        }
        // Intercept click in snap-place clear-one mode
        if (snapClearOneMode && pbPolygons[String(pb.id)]) {
          snapClearOnePB(pb);
          return;
        }
        // On mobile/touch devices: tap goes straight to claim dialog
        const isMobileView = window.innerWidth <= 768 || ('ontouchstart' in window);
        if (isMobileView && currentUser) {
          showClaimPeopleDialogById(pb.id);
          return;
        }
        try {
          const r = await api.getPowerBlock(pb.id);
          const idx = mapPBs.findIndex(p => p.id === pb.id);
          if (idx >= 0) mapPBs[idx] = r.data;
          showPBPanel(r.data);
        } catch(e) {
          console.error('Failed to load PB:', e);
          showPBPanel(pb); // fallback to cached
        }
      });
      m.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const fresh = mapPBs.find(p => p.id === pb.id) || pb;
        showMapQuickPopover(fresh, e.clientX, e.clientY);
      });
    }

    container.appendChild(m);
  });
  syncHiddenBtn();
  if (typeof applyZoneFilter === 'function') applyZoneFilter();
}

async function syncPositionsToServer() {
  const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  const labelOffsets = JSON.parse(localStorage.getItem('pb_label_offsets') || '{}');
  if (Object.keys(bboxes).length === 0 && Object.keys(labelOffsets).length === 0) return;
  try {
    const maps = await api.getAllSiteMaps();
    const list = maps.data || [];
    if (list.length === 0) return;
    const mapId = list[0].id;
    await api.syncPositions(mapId, bboxes, labelOffsets);
    console.log('Positions synced to server');
  } catch (e) {
    console.error('Failed to sync positions:', e);
  }
}

function toggleMapEditMode() {
  mapEditMode = !mapEditMode;
  const btn = document.getElementById('edit-mode-btn');
  const hint = document.getElementById('map-edit-hint');
  if (mapEditMode) {
    if (labelAdjustMode) toggleLabelAdjustMode();
    btn.textContent = '✅ Done Editing';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-success');
    if (hint) hint.style.display = 'block';
    closePBPanel();
  } else {
    btn.textContent = '✏️ Edit Positions';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-secondary');
    if (hint) hint.style.display = 'none';
    // Sync positions to server so Flutter/mobile apps get correct data
    syncPositionsToServer();
  }
  renderPBMarkers();
  renderTextLabels();
}

function toggleLabelAdjustMode() {
  labelAdjustMode = !labelAdjustMode;
  const btn = document.getElementById('label-adjust-btn');
  const hint = document.getElementById('label-edit-hint');
  if (labelAdjustMode) {
    if (mapEditMode) toggleMapEditMode();
    if (snapPlaceMode) toggleSnapPlace();
    if (moveAllMode) toggleMoveAll();
    if (mapDeleteMode) toggleDeleteMode();
    if (zoneAssignMode) toggleZoneAssignMode();
    if (btn) {
      btn.textContent = '✅ Done Numbers';
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-success');
    }
    if (hint) hint.style.display = 'block';
    closePBPanel();
  } else {
    if (btn) {
      btn.textContent = '🔢 Adjust Numbers';
      btn.classList.remove('btn-success');
      btn.classList.add('btn-secondary');
    }
    if (hint) hint.style.display = 'none';
    syncPositionsToServer();
  }
  renderPBMarkers();
}

// ── Restore hidden PB markers ──
function restoreHiddenPBs() {
  localStorage.removeItem('pb_hidden');
  document.getElementById('restore-hidden-btn').style.display = 'none';
  renderPBMarkers();
}

// Keep "Show Hidden" button visible only when there are hidden PBs
function syncHiddenBtn() {
  const hidden = JSON.parse(localStorage.getItem('pb_hidden') || '[]');
  const btn = document.getElementById('restore-hidden-btn');
  if (btn) btn.style.display = hidden.length > 0 ? '' : 'none';
}

// ── Move All mode ── drag to move every PB + label at once
let moveAllMode = false;
let moveAllDrag = null;

function toggleMoveAll() {
  moveAllMode = !moveAllMode;
  const btn = document.getElementById('moveall-btn');
  if (moveAllMode) {
    if (labelAdjustMode) toggleLabelAdjustMode();
    btn.textContent = '✅ Done Moving';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-success');
    const container = document.getElementById('map-container');
    container.style.cursor = 'move';
    container._moveAllDown = e => {
      if (e.target.id === 'sitemap-image' || e.target.id === 'pb-markers' || e.target.id === 'map-container' || e.target.id === 'text-labels') {
        e.preventDefault();
        moveAllDrag = { startX: e.clientX, startY: e.clientY };
        // Snapshot current positions
        document.querySelectorAll('#pb-markers > div').forEach(m => {
          m.dataset.origX = parseFloat(m.style.left);
          m.dataset.origY = parseFloat(m.style.top);
        });
        document.querySelectorAll('#text-labels > div').forEach(l => {
          l.dataset.origX = parseFloat(l.style.left);
          l.dataset.origY = parseFloat(l.style.top);
        });
      }
    };
    container._moveAllMove = e => {
      if (!moveAllDrag) return;
      const cW = container.offsetWidth;
      const cH = container.offsetHeight;
      const dxPct = (e.clientX - moveAllDrag.startX) / cW * 100;
      const dyPct = (e.clientY - moveAllDrag.startY) / cH * 100;
      document.querySelectorAll('#pb-markers > div').forEach(m => {
        m.style.left = (parseFloat(m.dataset.origX) + dxPct) + '%';
        m.style.top  = (parseFloat(m.dataset.origY) + dyPct) + '%';
      });
      document.querySelectorAll('#text-labels > div').forEach(l => {
        l.style.left = (parseFloat(l.dataset.origX) + dxPct) + '%';
        l.style.top  = (parseFloat(l.dataset.origY) + dyPct) + '%';
      });
    };
    container._moveAllUp = () => {
      if (!moveAllDrag) return;
      const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
      document.querySelectorAll('#pb-markers > div').forEach(m => {
        const pbId = m.dataset.pbId;
        if (pbId && bboxes[pbId]) {
          bboxes[pbId].x = parseFloat(m.style.left);
          bboxes[pbId].y = parseFloat(m.style.top);
        }
        delete m.dataset.origX; delete m.dataset.origY;
      });
      localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));

      const labels = JSON.parse(localStorage.getItem('map_text_labels') || '[]');
      document.querySelectorAll('#text-labels > div').forEach(l => {
        const id = parseInt(l.dataset.labelId);
        const lbl = labels.find(lb => lb.id === id);
        if (lbl) { lbl.x = parseFloat(l.style.left); lbl.y = parseFloat(l.style.top); }
        delete l.dataset.origX; delete l.dataset.origY;
      });
      localStorage.setItem('map_text_labels', JSON.stringify(labels));
      moveAllDrag = null;
    };
    container.addEventListener('mousedown', container._moveAllDown);
    document.addEventListener('mousemove', container._moveAllMove);
    document.addEventListener('mouseup', container._moveAllUp);
  } else {
    btn.textContent = '✥ Move All';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-secondary');
    const container = document.getElementById('map-container');
    container.style.cursor = '';
    if (container._moveAllDown) container.removeEventListener('mousedown', container._moveAllDown);
    if (container._moveAllMove) document.removeEventListener('mousemove', container._moveAllMove);
    if (container._moveAllUp) document.removeEventListener('mouseup', container._moveAllUp);
    moveAllDrag = null;
  }
}

// ── PB Font Size slider ──
function showFontSizeSlider() {
  let modal = document.getElementById('fontsize-modal');
  if (modal) { modal.remove(); return; }

  const currentSize = parseInt(localStorage.getItem('pb_font_size') || '0');
  modal = document.createElement('div');
  modal.id = 'fontsize-modal';
  modal.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #ccc;border-radius:10px;padding:20px 30px;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.25);text-align:center;min-width:300px;';
  modal.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:12px;">PB Label Font Size</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span style="font-size:12px;">Auto</span>
      <input type="range" id="pb-font-slider" min="0" max="36" value="${currentSize}" style="flex:1;">
      <span style="font-size:12px;">36px</span>
    </div>
    <div style="font-size:13px;color:#555;margin-bottom:14px;">Current: <strong id="pb-font-value">${currentSize === 0 ? 'Auto' : currentSize + 'px'}</strong></div>
    <div style="display:flex;gap:8px;justify-content:center;">
      <button onclick="applyPBFontSize()" style="background:#0d6efd;color:#fff;border:none;border-radius:5px;padding:6px 20px;cursor:pointer;font-size:13px;">Apply</button>
      <button onclick="document.getElementById('fontsize-modal').remove()" style="background:#6c757d;color:#fff;border:none;border-radius:5px;padding:6px 20px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('pb-font-slider').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('pb-font-value').textContent = v === 0 ? 'Auto' : v + 'px';
  });
}

function applyPBFontSize() {
  const size = parseInt(document.getElementById('pb-font-slider').value);
  localStorage.setItem('pb_font_size', size);
  document.getElementById('fontsize-modal').remove();
  renderPBMarkers();
}

// ── Toggle white background (hide/show map image) ──
function toggleWhiteBg() {
  const img = document.getElementById('sitemap-image');
  const outer = document.getElementById('map-outer');
  if (!img) return;
  if (img.style.visibility === 'hidden') {
    img.style.visibility = 'visible';
    outer.style.background = '#1a1a2e';
    localStorage.removeItem('map_white_bg');
  } else {
    img.style.visibility = 'hidden';
    outer.style.background = '#ffffff';
    localStorage.setItem('map_white_bg', '1');
  }
}
// Restore on load
(function restoreWhiteBg() {
  function apply() {
    if (localStorage.getItem('map_white_bg') === '1') {
      const img = document.getElementById('sitemap-image');
      const outer = document.getElementById('map-outer');
      if (img) { img.style.visibility = 'hidden'; }
      if (outer) { outer.style.background = '#ffffff'; }
    }
  }
  document.addEventListener('DOMContentLoaded', apply);
  setTimeout(apply, 300);
})();

// ── Scale entire layout ──
function showScaleSlider() {
  let modal = document.getElementById('scale-modal');
  if (modal) { modal.remove(); return; }

  modal = document.createElement('div');
  modal.id = 'scale-modal';
  modal.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #ccc;border-radius:10px;padding:20px 30px;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.25);text-align:center;min-width:320px;';
  modal.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:12px;">Scale All PB Positions & Sizes</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span style="font-size:12px;">50%</span>
      <input type="range" id="scale-slider" min="50" max="200" value="100" style="flex:1;">
      <span style="font-size:12px;">200%</span>
    </div>
    <div style="font-size:13px;color:#555;margin-bottom:14px;">Current: <strong id="scale-value">100</strong>%</div>
    <div style="display:flex;gap:8px;justify-content:center;">
      <button onclick="applyScale()" style="background:#0d6efd;color:#fff;border:none;border-radius:5px;padding:6px 20px;cursor:pointer;font-size:13px;">Apply</button>
      <button onclick="document.getElementById('scale-modal').remove()" style="background:#6c757d;color:#fff;border:none;border-radius:5px;padding:6px 20px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('scale-slider').addEventListener('input', e => {
    document.getElementById('scale-value').textContent = e.target.value;
  });
}

function applyScale() {
  const pct = parseInt(document.getElementById('scale-slider').value) / 100;
  const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  for (const key of Object.keys(bboxes)) {
    bboxes[key].x *= pct;
    bboxes[key].y *= pct;
    bboxes[key].w *= pct;
    bboxes[key].h *= pct;
  }
  localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));

  // Scale text labels too
  const labels = JSON.parse(localStorage.getItem('map_text_labels') || '[]');
  labels.forEach(l => {
    l.x *= pct;
    l.y *= pct;
    l.fontSize = Math.round((l.fontSize || 14) * pct);
  });
  localStorage.setItem('map_text_labels', JSON.stringify(labels));

  document.getElementById('scale-modal').remove();
  renderPBMarkers();
  renderTextLabels();
}

// ── Text Labels ──
function getTextLabels() {
  return JSON.parse(localStorage.getItem('map_text_labels') || '[]');
}

function saveTextLabels(labels) {
  localStorage.setItem('map_text_labels', JSON.stringify(labels));
}

function addTextLabel() {
  const text = prompt('Enter label text:');
  if (!text) return;
  const colorPicker = document.getElementById('text-label-color');
  const color = colorPicker ? colorPicker.value : '#ffffff';
  const labels = getTextLabels();
  labels.push({
    id: Date.now(),
    text: text,
    x: 5,  // % from left
    y: 5,  // % from top
    fontSize: 14,
    color: color,
    bold: true
  });
  saveTextLabels(labels);
  renderTextLabels();
}

function renderTextLabels() {
  const container = document.getElementById('text-labels');
  if (!container) return;

  // Sync size with map
  const img = document.getElementById('sitemap-image');
  if (img && img.offsetWidth) {
    container.style.width = img.offsetWidth + 'px';
    container.style.height = img.offsetHeight + 'px';
  }

  container.innerHTML = '';
  const labels = getTextLabels();

  labels.forEach(lbl => {
    const el = document.createElement('div');
    el.dataset.labelId = lbl.id;
    el.style.cssText = [
      'position:absolute',
      `left:${lbl.x}%`,
      `top:${lbl.y}%`,
      `font-size:${lbl.fontSize || 14}px`,
      `color:${lbl.color || '#000'}`,
      `font-weight:${lbl.bold ? '700' : '400'}`,
      'white-space:nowrap',
      'user-select:none',
      'z-index:40',
      `cursor:${mapEditMode ? 'grab' : (mapDeleteMode ? 'crosshair' : 'default')}`,
      'text-shadow:0 1px 3px rgba(255,255,255,0.8)'
    ].join(';');
    el.textContent = lbl.text;
    el.title = mapEditMode ? 'Drag to move • Right-click to edit/delete' : (mapDeleteMode ? 'Click to delete this label' : lbl.text);

    if (mapDeleteMode) {
      // Delete mode: click to instantly delete the label
      el.addEventListener('click', () => {
        if (confirm('Delete label "' + lbl.text + '"?')) {
          const ls = getTextLabels().filter(l => l.id !== lbl.id);
          saveTextLabels(ls);
          renderTextLabels();
        }
      });
    }

    if (mapEditMode) {
      // Font-size resize handle (bottom-right corner)
      const resizeHandle = document.createElement('div');
      resizeHandle.title = 'Drag to resize text';
      resizeHandle.style.cssText = [
        'position:absolute', 'right:-6px', 'bottom:-6px',
        'width:12px', 'height:12px', 'background:#0d6efd',
        'border:2px solid #fff', 'border-radius:3px',
        'cursor:nwse-resize', 'z-index:50',
        'box-shadow:0 1px 4px rgba(0,0,0,.4)'
      ].join(';');
      el.style.position = 'absolute'; // ensure relative positioning for handle
      resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const origSize = lbl.fontSize || 14;
        function onMove(ev) {
          const dx = ev.clientX - startX;
          const newSize = Math.max(6, Math.min(120, Math.round(origSize + dx * 0.4)));
          lbl.fontSize = newSize;
          el.style.fontSize = newSize + 'px';
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          saveTextLabels(labels);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      el.appendChild(resizeHandle);

      // Drag to move
      el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.target === resizeHandle) return;
        e.preventDefault();
        const container = document.getElementById('map-container');
        const cW = container.offsetWidth;
        const cH = container.offsetHeight;
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = lbl.x;
        const origY = lbl.y;

        function onMove(ev) {
          const dx = (ev.clientX - startX) / cW * 100;
          const dy = (ev.clientY - startY) / cH * 100;
          el.style.left = Math.max(0, origX + dx) + '%';
          el.style.top  = Math.max(0, origY + dy) + '%';
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          lbl.x = parseFloat(el.style.left);
          lbl.y = parseFloat(el.style.top);
          saveTextLabels(labels);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // Right-click context menu for edit/delete
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        // Remove existing context menu
        const old = document.getElementById('label-ctx-menu');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.id = 'label-ctx-menu';
        menu.style.cssText = 'position:fixed;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:10000;padding:4px 0;min-width:140px;';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        const items = [
          { text: '✏️ Edit Text', action: () => {
            const newText = prompt('Edit label text:', lbl.text);
            if (newText !== null) { lbl.text = newText; saveTextLabels(labels); renderTextLabels(); }
          }},
          { text: '🔤 Font Size', action: () => {
            const sz = prompt('Font size (px):', lbl.fontSize || 14);
            if (sz !== null) { lbl.fontSize = parseInt(sz) || 14; saveTextLabels(labels); renderTextLabels(); }
          }},
          { text: '🎨 Color', action: () => {
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = lbl.color && lbl.color.startsWith('#') ? lbl.color : '#ffffff';
            picker.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
            document.body.appendChild(picker);
            picker.addEventListener('input', () => { lbl.color = picker.value; saveTextLabels(labels); renderTextLabels(); });
            picker.addEventListener('change', () => { lbl.color = picker.value; saveTextLabels(labels); renderTextLabels(); picker.remove(); });
            picker.click();
          }},
          { text: lbl.bold ? '▪ Unbold' : '▪ Bold', action: () => {
            lbl.bold = !lbl.bold; saveTextLabels(labels); renderTextLabels();
          }},
          { text: '🗑️ Delete', action: () => {
            if (confirm('Delete this label?')) {
              const ls = getTextLabels().filter(l => l.id !== lbl.id);
              saveTextLabels(ls);
              renderTextLabels();
            }
          }}
        ];

        items.forEach(item => {
          const btn = document.createElement('div');
          btn.textContent = item.text;
          btn.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:12px;';
          btn.addEventListener('mouseenter', () => btn.style.background = '#f0f0f0');
          btn.addEventListener('mouseleave', () => btn.style.background = '');
          btn.addEventListener('click', () => { menu.remove(); item.action(); });
          menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        // Close on click elsewhere
        setTimeout(() => {
          document.addEventListener('click', function close() {
            menu.remove();
            document.removeEventListener('click', close);
          }, { once: true });
        }, 10);
      });
    }

    container.appendChild(el);
  });
}

function showMapQuickPopover(pb, clientX, clientY) {
  const popover = document.getElementById('map-quick-popover');
  if (!popover) return;

  const statusTypes = (currentTracker?.status_types || LBD_STATUS_TYPES).slice();
  const summary = pb.lbd_summary || {};
  const total = pb.lbd_count || 0;

  const rows = statusTypes.map(st => {
    const done = summary[st] || 0;
    const allDone = total > 0 && done >= total;
    const label = STATUS_LABELS[st] || st.replace(/_/g, ' ');
    const color = STATUS_COLORS[st] || '#4f8cff';
    return `<div class="map-qp-row">
      <span class="map-qp-label" style="color:${color}">${_escapeHtml(label)}</span>
      <span class="map-qp-count">${done}/${total}</span>
      <button class="map-qp-btn${allDone ? ' is-done' : ''}"
        onclick="mapQuickMarkAll(${pb.id}, '${st}', ${!allDone})"
        style="border-color:${color}20;color:${allDone ? color : 'rgba(238,242,255,0.55)'}">
        ${allDone ? '✓ Done' : 'Mark all'}
      </button>
    </div>`;
  }).join('');

  popover.innerHTML = `
    <div class="map-qp-header">
      <span class="map-qp-name">${_escapeHtml(pb.name)}</span>
      <button class="map-qp-close" onclick="document.getElementById('map-quick-popover').style.display='none'">✕</button>
    </div>
    ${rows}
    <div class="map-qp-footer"><button class="map-qp-open" onclick="document.getElementById('map-quick-popover').style.display='none';showPBPanel(mapPBs.find(b=>b.id===${pb.id})||${JSON.stringify({id:pb.id,name:pb.name})})">Open full panel →</button></div>
  `;

  // Position near cursor (keep within viewport)
  const W = 240, vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.min(clientX + 8, vw - W - 10);
  const top = Math.min(clientY + 8, vh - 280);
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popover.style.display = 'block';
}

async function mapQuickMarkAll(blockId, statusType, complete) {
  try {
    await api.bulkComplete(blockId, [statusType], complete);
    const r = await api.getPowerBlock(blockId);
    const i = mapPBs.findIndex(p => p.id === blockId);
    if (i >= 0) { mapPBs[i] = r.data; _updateMarkerColor(r.data); }
    // Refresh popover if still open for this block
    const popover = document.getElementById('map-quick-popover');
    if (popover && popover.style.display !== 'none') {
      const pb = mapPBs.find(b => b.id === blockId) || r.data;
      const rect = popover.getBoundingClientRect();
      showMapQuickPopover(pb, rect.left - 8, rect.top - 8);
    }
  } catch(e) { /* ignore */ }
}

// Close map popover when clicking outside
document.addEventListener('click', (e) => {
  const pop = document.getElementById('map-quick-popover');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) {
    pop.style.display = 'none';
  }
});

function showPBPanel(pb) {
  activePBId = pb.id;
  if (!currentTracker) {
    renderOverviewPBPanel(pb);
    return;
  }
  // Don't re-render markers — keep them locked in place

  const lbds  = pb.lbds || [];
  const total = pb.lbd_count || 0;
  const done  = lbds.filter(l => isLBDComplete(l)).length;
  const remaining = total - done;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;

  document.getElementById('lbd-panel-title').textContent = pb.name;
  document.getElementById('lbd-panel-stats').innerHTML =
    `<span style="font-weight:600;color:#333;">${total}</span> total  · ` +
    `<span style="font-weight:700;color:#28a745;">${done} complete</span>  · ` +
    `<span style="font-weight:600;color:#dc3545;">${remaining} remaining</span>`;
  const progressBar = document.getElementById('lbd-panel-bar');
  if (progressBar) progressBar.style.display = 'block';
  document.getElementById('lbd-panel-bar-fill').style.width = pct + '%';
  document.getElementById('lbd-panel-bar-fill').style.background =
    pct >= 100 ? '#28a745' : pct > 0 ? '#ffc107' : '#dc3545';

  // Build grid template: LBD label column + one column per status type
  const colCount = LBD_STATUS_TYPES.length;
  const gridCols = `70px repeat(${colCount}, 1fr)`;

  // Header row + bulk row + claim banner
  const claimedPeople = Array.isArray(pb.claimed_people) ? pb.claimed_people : [];
  const claimedLabel = pb.claimed_label || claimedPeople.join(', ') || pb.claimed_by || '';
  const pbClaimed = blockHasClaim(pb);
  let mapClaimBanner = '';
  if (currentUser && currentTracker?.claims_enabled !== false) {
    if (pbClaimed) {
      mapClaimBanner = `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(21,101,192,0.1);border:1px solid rgba(21,101,192,0.2);border-radius:6px;">
        <div style="font-size:12px;color:#8adfff;">&#128204; Claimed by <strong>${_escapeHtml(claimedLabel || 'Crew')}</strong></div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
          ${currentUserCan('claim_create') ? `<button onclick="showClaimPeopleDialogById(${pb.id})" style="background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:600;">Add Claim</button>` : ''}
          ${currentUserCan('claim_delete') ? `<button onclick="claimBlock(${pb.id},'unclaim').then(()=>{const r=mapPBs.find(b=>b.id===${pb.id});if(r){r.claimed_by=null;r.claimed_people=[];r.claim_assignments={};r.claimed_label='';showPBPanel(r);}})" style="background:rgba(255,76,106,0.1);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:600;">Release</button>` : ''}
        </div>
      </div>`;
    } else if (currentUserCan('claim_create')) {
      mapClaimBanner = `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
        <div style="margin-top:6px;">
          <button onclick="showClaimPeopleDialogById(${pb.id})" style="background:rgba(0,232,122,0.15);color:#00e87a;border:1px solid rgba(0,232,122,0.3);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:700;">Add Claim</button>
        </div>
      </div>`;
    }
  }

  const headerEl = document.getElementById('lbd-grid-header');
  const mapNoteHtml = (currentTracker?.notes_enabled !== false) && pb.notes
    ? `<div style="margin-bottom:6px;padding:6px 10px;background:rgba(165,180,252,0.07);border:1px solid rgba(165,180,252,0.15);border-radius:7px;font-size:11px;color:#c4b5fd;font-style:italic;">&#128203; ${_escapeHtml(pb.notes)}</div>`
    : '';

  // Block-mode: simplified panel when per-LBD UI is disabled for this tracker
  if (currentTracker && currentTracker.show_per_lbd_ui === false) {
    headerEl.innerHTML = `
      ${buildPBIfcActionMarkup(pb, true)}
      ${mapNoteHtml}
      ${mapClaimBanner}
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button onclick="bulkMapAll(${pb.id},true)" style="flex:1;padding:10px;background:rgba(0,232,122,0.15);color:#00e87a;border:1px solid rgba(0,232,122,0.3);border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">&#x2713; Mark Complete</button>
        <button onclick="bulkMapAll(${pb.id},false)" style="flex:1;padding:10px;background:rgba(255,76,106,0.1);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:6px;cursor:pointer;font-size:13px;">&#x21A9; Mark Incomplete</button>
      </div>
    `;
    const _blockTone = pb.is_completed ? '#00e87a' : '#94a3b8';
    const _blockText = pb.is_completed ? '&#x2713; Block marked complete' : (done + '/' + total + ' items complete');
    document.getElementById('lbd-panel').style.display = 'flex';
    document.getElementById('lbd-panel-list').innerHTML = `<div style="padding:20px 4px;text-align:center;color:${_blockTone};font-size:13px;">${_blockText}</div>`;
    return;
  }

  headerEl.innerHTML = `
    ${buildPBIfcActionMarkup(pb, true)}
    ${mapNoteHtml}
    ${mapClaimBanner}
    <div style="display:grid;grid-template-columns:${gridCols};gap:3px;align-items:end;margin-bottom:4px;">
      <div style="font-size:10px;color:#4a5568;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">LBD</div>
      ${LBD_STATUS_TYPES.map(st =>
        `<div style="text-align:center;font-size:9px;color:#8892b0;font-weight:600;line-height:1.2;" title="${STATUS_LABELS[st]||st}">${STATUS_LABELS[st]||st}</div>`
      ).join('')}
    </div>
    <div style="display:grid;grid-template-columns:${gridCols};gap:3px;align-items:center;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;">
      <div style="font-size:9px;color:#4a5568;font-weight:600;">Bulk</div>
      ${LBD_STATUS_TYPES.map(st => `
        <div style="display:flex;gap:1px;">
          <button onclick="bulkMapColumn(${pb.id},'${st}',true)" title="Complete all ${STATUS_LABELS[st]||st}"
            style="flex:1;background:${STATUS_COLORS[st]||'#888'};color:#000;border:none;border-radius:3px 0 0 3px;padding:2px 0;cursor:pointer;font-size:10px;font-weight:700;">&#x2713;</button>
          <button onclick="bulkMapColumn(${pb.id},'${st}',false)" title="Clear all ${STATUS_LABELS[st]||st}"
            style="flex:1;background:rgba(255,255,255,0.08);color:#8892b0;border:none;border-radius:0 3px 3px 0;padding:2px 0;cursor:pointer;font-size:10px;">&#x25CB;</button>
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:4px;justify-content:flex-end;margin-bottom:6px;">
      <button onclick="bulkMapAll(${pb.id},true)" style="background:rgba(0,232,122,0.15);color:#00e87a;border:1px solid rgba(0,232,122,0.3);border-radius:4px;padding:3px 12px;cursor:pointer;font-size:10px;font-weight:700;">All &#x2713;</button>
      <button onclick="bulkMapAll(${pb.id},false)" style="background:rgba(255,76,106,0.12);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:4px;padding:3px 12px;cursor:pointer;font-size:10px;font-weight:700;">Clear All</button>
    </div>
  `;

  // Remove old bulk bar if it exists
  const oldBulk = document.getElementById('map-bulk-bar');
  if (oldBulk) oldBulk.remove();

  const panel = document.getElementById('lbd-panel');
  panel.style.display = 'flex';

  const listEl = document.getElementById('lbd-panel-list');
  if (lbds.length === 0) {
    listEl.innerHTML = '<p style="color:#4a5568;text-align:center;padding:40px 0;font-family:Inter,sans-serif;">No LBDs found for this block</p>';
    return;
  }

  const sorted = [...lbds].sort((a, b) => {
    const na = parseInt((a.identifier || '').replace(/\D/g, '')) || 0;
    const nb = parseInt((b.identifier || '').replace(/\D/g, '')) || 0;
    return na - nb;
  });

  listEl.innerHTML = sorted.map(lbd => {
    const lPct = lbd.completion_percentage || 0;
    const statuses = lbd.statuses || [];
    const btns = LBD_STATUS_TYPES.map(st => {
      const s = statuses.find(x => x.status_type === st);
      const done = s ? s.is_completed : false;
      const col = STATUS_COLORS[st];
      return '<button'
        + ' id="status-btn-' + lbd.id + '-' + st + '"'
        + ' onclick="toggleMapStatus(' + lbd.id + ',\'' + st + '\',' + done + ',this,' + pb.id + ')"'
        + ' title="' + (STATUS_LABELS[st] || st.replace(/_/g,' ')) + '"'
        + ' style="border-radius:4px;border:1px solid ' + (done ? col : 'rgba(255,255,255,0.08)') + ';'
        + 'background:' + (done ? col : 'rgba(255,255,255,0.04)') + ';color:' + (done ? '#000' : '#4a5568') + ';'
        + 'font-size:11px;font-weight:' + (done ? '700' : '400') + ';cursor:pointer;padding:4px 0;line-height:1;width:100%;">'
        + (done ? '&#x2713;' : '&middot;')
        + '</button>';
    }).join('');

    return '<div id="lbd-row-' + lbd.id + '" style="'
        + 'display:grid;grid-template-columns:' + gridCols + ';gap:3px;align-items:center;'
        + 'padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);'
        + 'background:' + (isLBDComplete(lbd) ? 'rgba(0,232,122,0.06)' : 'transparent') + ';'
        + '">'
      + '<div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#eef2ff;" title="' + (lbd.inventory_number || '') + '">' + (lbd.identifier || lbd.name) + '</div>'
      + btns
      + '</div>';
  }).join('');
}

function closePBPanel() {
  activePBId = null;
  document.getElementById('lbd-panel').style.display = 'none';
}

function getPowerBlockIfcState(blockId) {
  return mapPBs.find((pb) => Number(pb.id) === Number(blockId))
    || _blocksCache[blockId]
    || null;
}

function viewPowerBlockIfc(blockId) {
  const pb = getPowerBlockIfcState(blockId);
  if (!pb || !pb.ifc_url || !pb.has_ifc) {
    alert(currentUser ? 'No IFC drawing is assigned to this power block.' : 'Sign in with a created user to view IFC drawings.');
    return;
  }
  window.open(pb.ifc_url, '_blank', 'noopener');
}

function downloadPowerBlockIfc(blockId) {
  const pb = getPowerBlockIfcState(blockId);
  if (!pb || !pb.ifc_url || !pb.has_ifc) {
    alert(currentUser ? 'No IFC drawing is assigned to this power block.' : 'Sign in with a created user to view IFC drawings.');
    return;
  }
  const link = document.createElement('a');
  link.href = pb.ifc_url;
  link.download = pb.ifc_filename || `${pb.name || 'power-block'}-IFC.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function buildPBIfcActionMarkup(pb, compact = false) {
  if (!pb) return '';

  const containerStyle = compact
    ? 'margin-bottom:8px;padding:10px 12px;border:1px solid rgba(0,212,255,0.16);border-radius:10px;background:rgba(0,212,255,0.05);'
    : 'padding:14px 16px;border:1px solid rgba(0,212,255,0.16);border-radius:12px;background:rgba(0,212,255,0.05);';
  const metaBits = [];
  if (pb.ifc_filename) metaBits.push(_escapeHtml(pb.ifc_filename));
  if (pb.ifc_page_number != null) metaBits.push(`Page ${_escapeHtml(pb.ifc_page_number)}`);

  if (pb.has_ifc && pb.ifc_url) {
    return `
      <div style="${containerStyle}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div>
            <div style="font-size:11px;font-weight:700;color:#8adfff;letter-spacing:0.7px;text-transform:uppercase;">IFC Drawing</div>
            <div style="font-size:12px;color:#cbd5e1;margin-top:4px;">${metaBits.length ? metaBits.join(' • ') : 'Open the IFC PDF for this power block.'}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary" onclick="viewPowerBlockIfc(${pb.id})" style="padding:6px 12px;font-size:11px;">View IFC</button>
            <button type="button" class="btn btn-primary" onclick="downloadPowerBlockIfc(${pb.id})" style="padding:6px 12px;font-size:11px;">Download IFC</button>
          </div>
        </div>
      </div>`;
  }

  const noIfcMessage = currentUser
    ? 'No IFC drawing is assigned to this power block yet.'
    : 'Sign in with a created user to view IFC drawings from the map.';
  return `
    <div style="${containerStyle}">
      <div style="font-size:11px;font-weight:700;color:#8adfff;letter-spacing:0.7px;text-transform:uppercase;">IFC Drawing</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">${noIfcMessage}</div>
    </div>`;
}

function renderOverviewPBPanel(pb) {
  const panel = document.getElementById('lbd-panel');
  const headerEl = document.getElementById('lbd-grid-header');
  const listEl = document.getElementById('lbd-panel-list');
  const progressBar = document.getElementById('lbd-panel-bar');

  document.getElementById('lbd-panel-title').textContent = pb.name;
  document.getElementById('lbd-panel-stats').textContent = pb.ifc_page_number != null
    ? `Neutral overview • IFC page ${pb.ifc_page_number}`
    : 'Neutral overview • tracker details hidden';
  if (progressBar) progressBar.style.display = 'none';

  headerEl.innerHTML = buildPBIfcActionMarkup(pb, false);
  listEl.innerHTML = `
    <div style="padding:12px 4px 4px;color:#94a3b8;font-size:12px;line-height:1.7;">
      Overview mode stays neutral. LBD statuses, completion progress, and claim details are hidden until you choose a tracker.
    </div>`;

  panel.style.display = 'flex';
}

async function bulkMapColumn(pbId, statusType, complete) {
  // Optimistic local update
  const pb = mapPBs.find(p => p.id === pbId);
  if (pb) {
    (pb.lbds || []).forEach(lbd => {
      const st = (lbd.statuses || []).find(s => s.status_type === statusType);
      if (st) st.is_completed = complete;
      else { lbd.statuses = lbd.statuses || []; lbd.statuses.push({ status_type: statusType, is_completed: complete }); }
    });
    if (pb.lbd_summary) pb.lbd_summary[statusType] = complete ? (pb.lbd_count || 0) : 0;
    showPBPanel(pb);
    _updateMarkerColor(pb);
  }
  // Fire API in background
  try {
    await api.bulkComplete(pbId, [statusType], complete);
  } catch(e) { alert('Bulk error: ' + e.message); }
}

async function bulkMapAll(pbId, complete) {
  // Optimistic local update
  const pb = mapPBs.find(p => p.id === pbId);
  if (pb) {
    (pb.lbds || []).forEach(lbd => {
      LBD_STATUS_TYPES.forEach(statusType => {
        const st = (lbd.statuses || []).find(s => s.status_type === statusType);
        if (st) st.is_completed = complete;
        else { lbd.statuses = lbd.statuses || []; lbd.statuses.push({ status_type: statusType, is_completed: complete }); }
      });
    });
    if (pb.lbd_summary) LBD_STATUS_TYPES.forEach(st => { pb.lbd_summary[st] = complete ? (pb.lbd_count || 0) : 0; });
    showPBPanel(pb);
    _updateMarkerColor(pb);
  }
  // Fire API in background
  try {
    await api.bulkComplete(pbId, LBD_STATUS_TYPES, complete);
  } catch(e) { alert('Bulk error: ' + e.message); }
}

async function toggleMapStatus(lbdId, statusType, currentDone, btn, pbId) {
  const newDone = !currentDone;
  const col = STATUS_COLORS[statusType];

  // Instant optimistic update — button
  btn.style.background = newDone ? col : 'rgba(255,255,255,0.04)';
  btn.style.color       = newDone ? '#000' : '#4a5568';
  btn.style.border      = '1px solid ' + (newDone ? col : 'rgba(255,255,255,0.08)');
  btn.style.fontWeight  = newDone ? '700' : '400';
  btn.innerHTML         = newDone ? '\u2713' : '\u00b7';
  btn.onclick = () => toggleMapStatus(lbdId, statusType, newDone, btn, pbId);

  // Update local cache instantly — no server refetch
  const pb = mapPBs.find(p => p.id === pbId);
  if (pb) {
    const lbd = (pb.lbds || []).find(l => l.id === lbdId);
    if (lbd) {
      const st = (lbd.statuses || []).find(s => s.status_type === statusType);
      if (st) { st.is_completed = newDone; }
      else { lbd.statuses = lbd.statuses || []; lbd.statuses.push({ status_type: statusType, is_completed: newDone }); }
    }
    if (pb.lbd_summary) {
      pb.lbd_summary[statusType] = (pb.lbds || []).filter(l =>
        (l.statuses || []).some(s => s.status_type === statusType && s.is_completed)
      ).length;
    }
    const lbds = pb.lbds || [];
    const total = pb.lbd_count || lbds.length;
    const done  = lbds.filter(l => isLBDComplete(l)).length;
    const remaining = total - done;
    const pct   = total > 0 ? Math.round(done / total * 100) : 0;
    const statsEl = document.getElementById('lbd-panel-stats');
    if (statsEl) statsEl.innerHTML =
      '<span style="font-weight:600;color:#333;">' + total + '</span> total  \u00b7 ' +
      '<span style="font-weight:700;color:#28a745;">' + done + ' complete</span>  \u00b7 ' +
      '<span style="font-weight:600;color:#dc3545;">' + remaining + ' remaining</span>';
    const fill = document.getElementById('lbd-panel-bar-fill');
    if (fill) { fill.style.width = pct + '%'; fill.style.background = pct >= 100 ? '#28a745' : pct > 0 ? '#ffc107' : '#dc3545'; }
    const updLbd = lbds.find(l => l.id === lbdId);
    if (updLbd) {
      const row = document.getElementById('lbd-row-' + lbdId);
      if (row) row.style.background = isLBDComplete(updLbd) ? 'rgba(0,232,122,0.06)' : 'transparent';
    }
    _updateMarkerColor(pb);
  }

  // Fire API call in background — don't block the UI
  try {
    await api.updateLBDStatus(lbdId, statusType, {
      is_completed: newDone,
      completed_at: newDone ? new Date().toISOString() : null
    });
  } catch (e) {
    console.error('Status update failed:', e);
    btn.style.background = currentDone ? col : 'rgba(255,255,255,0.04)';
    btn.style.color       = currentDone ? '#000' : '#4a5568';
    btn.style.fontWeight  = currentDone ? '700' : '400';
    btn.innerHTML         = currentDone ? '\u2713' : '\u00b7';
    btn.onclick = () => toggleMapStatus(lbdId, statusType, currentDone, btn, pbId);
    alert('Failed to save status. Please try again.');
  }
}

// Update a single PB marker color without rebuilding all markers
function _updateMarkerColor(pb) {
  if (!pb) return;
  renderSiteMapSummary();
  renderPBMarkers();
}

function updateSelectedPages() {
  selectedPages = [];
  document.querySelectorAll('.page-option input').forEach(cb => {
    if (cb.checked) selectedPages.push(parseInt(cb.value));
  });
}

function applyPageRange() {
  const rangeInput = document.getElementById('page-range-input').value.trim();
  if (!rangeInput) {
    showStatus('upload-status', 'Please enter a page range', 'error');
    return;
  }

  try {
    const pagesToSelect = parsePageRange(rangeInput, pageCount);
    
    // Clear all first
    document.querySelectorAll('.page-option input').forEach(cb => cb.checked = false);
    
    // Check the selected pages
    document.querySelectorAll('.page-option input').forEach(cb => {
      const pageNum = parseInt(cb.value);
      if (pagesToSelect.includes(pageNum)) {
        cb.checked = true;
      }
    });
    
    updateSelectedPages();
    showStatus('upload-status', `Selected ${selectedPages.length} page(s)`, 'success');
  } catch (err) {
    showStatus('upload-status', `Error: ${err.message}`, 'error');
  }
}

function clearAllPages() {
  document.querySelectorAll('.page-option input').forEach(cb => cb.checked = false);
  updateSelectedPages();
  document.getElementById('page-range-input').value = '';
}

function parsePageRange(rangeStr, maxPages) {
  const pages = new Set();
  const parts = rangeStr.split(',').map(p => p.trim());
  
  for (const part of parts) {
    if (!part) continue;
    
    if (part.includes('-')) {
      // Range like "1-50"
      const [start, end] = part.split('-').map(x => x.trim());
      const startNum = parseInt(start);
      const endNum = parseInt(end);
      
      if (isNaN(startNum) || isNaN(endNum)) {
        throw new Error(`Invalid range format: ${part}`);
      }
      
      if (startNum < 1 || endNum > maxPages || startNum > endNum) {
        throw new Error(`Range out of bounds: ${part} (valid: 1-${maxPages})`);
      }
      
      for (let i = startNum; i <= endNum; i++) {
        pages.add(i);
      }
    } else {
      // Single page like "100"
      const pageNum = parseInt(part);
      
      if (isNaN(pageNum)) {
        throw new Error(`Invalid page number: ${part}`);
      }
      
      if (pageNum < 1 || pageNum > maxPages) {
        throw new Error(`Page number out of bounds: ${pageNum} (valid: 1-${maxPages})`);
      }
      
      pages.add(pageNum);
    }
  }
  
  return Array.from(pages).sort((a, b) => a - b);
}

async function extractPages() {
  if (selectedPages.length === 0) {
    showStatus('upload-status', 'Please select at least one page', 'error');
    return;
  }
  
  const btn = document.getElementById('extract-btn');
  btn.disabled = true;
  btn.textContent = 'Extracting...';
  
  try {
    console.log('Starting page extraction...');
    console.log('PDF Path:', currentPDF.pdf_path);
    console.log('Selected Pages:', selectedPages);
    
    const response = await api.extractPages(currentPDF.pdf_path, selectedPages);
    
    console.log('Full API Response:', response);
    console.log('Response Keys:', Object.keys(response));
    
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from server');
    }
    
    // Handle different response structures
    let pages = response.extracted_pages || response.data?.extracted_pages || [];
    
    if (!Array.isArray(pages)) {
      console.error('extracted_pages is not an array:', pages);
      throw new Error('Invalid page data format from server');
    }
    
    if (pages.length === 0) {
      throw new Error('No pages were extracted');
    }
    
    console.log(`Successfully extracted ${pages.length} pages`);
    
    // Create power blocks
    const blockData = pages.map(p => ({
      page_number: p.page_number,
      image_path: p.image_path,
      block_name: `Block ${p.page_number}`,
      description: ''
    }));
    
    console.log('Creating power blocks...');
    await api.createPowerBlocks(blockData);
    console.log('Power blocks created');
    
    // Show extracted pages
    let html = '';
    pages.forEach(page => {
      html += `
        <div class="extracted-item">
          <div class="page-info">Page ${page.page_number}</div>
          <img src="${page.image_path}" alt="Page ${page.page_number}" />
        </div>
      `;
    });
    
    document.getElementById('extracted-list').innerHTML = html;
    document.getElementById('extracted-pages').classList.remove('hidden');
    
    showStatus('upload-status', `Extracted ${pages.length} page(s) successfully!`, 'success');
  } catch (err) {
    console.error('Error in extractPages:', err);
    console.error('Stack:', err.stack);
    showStatus('upload-status', `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extract Pages';
  }
}

async function scanPDFForLBDs() {
  if (!currentPDF || !currentPDF.pdf_path) {
    showStatus('scan-status', 'Please upload a PDF first', 'error');
    return;
  }
  
  const btn = document.getElementById('scan-btn');
  btn.disabled = true;
  btn.textContent = 'Scanning PDF (processing in background)...';
  
  try {
    console.log('Starting PDF scan for LBDs...');
    const response = await api.scanLBDs(currentPDF.pdf_path);
    
    console.log('Scan response:', response);
    
    // Handle 202 Accepted response (background processing)
    if (response.status === 'processing') {
      showProgressBar('scan-status', 0, 0, 0, 0, 0);
      
      // Poll for completion
      let attempts = 0;
      const maxAttempts = 1200; // 20 minutes with 1 second checks
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        attempts++;
        
        try {
          // Get current progress from server
          const status = await api.getScanStatus();
          console.log('Scan status:', status);
          
          // Update progress bar with all details
          showProgressBar(
            'scan-status',
            status.percentage || 0,
            status.pages_scanned || 0,
            status.total_pages || 0,
            status.power_blocks_found || 0,
            status.lbds_found || 0,
            status.db_status || '',
            status.save_percentage || 0,
            status.save_current || 0,
            status.save_total || 0
          );
          
          // Check if complete
          if (status.status === 'complete') {
            console.log('Scan completed!');
            showStatus('scan-status', `✓ ${status.message}`, 'success');
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            loadBlocks();
            showPage('blocks');
            return;
          }
          
          // Check for error
          if (status.status === 'error') {
            throw new Error(status.message || 'Scan failed');
          }
          
        } catch (e) {
          console.error('Error checking status:', e);
          // Continue polling, might be temporary error
        }
        
        if (attempts >= maxAttempts) {
          throw new Error('Scan took too long (timeout after 20 minutes)');
        }
      }
      
      throw new Error('Scan took too long (timeout after 20 minutes)');
    }
    
    // Immediate success response (shouldn't happen with async scan)
    showStatus('scan-status', `Found ${response.power_blocks_created} power blocks with ${response.lbds_created} total LBDs!`, 'success');
    loadBlocks();
    showPage('blocks');
    
  } catch (err) {
    console.error('Error scanning PDF:', err);
    showStatus('scan-status', `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan PDF for LBDs';
  }
}

// New function to display detailed progress bar
function showProgressBar(elementId, percentage, pageScanned, totalPages, pbFound, lbdsFound, dbStatus, savePercentage, saveCurrent, saveTotal) {
  const element = document.getElementById(elementId);
  element.classList.remove('hidden');
  element.className = 'alert alert-info progress-container';

  // Save progress bar (shown when DB saving is in progress)
  let saveBarHtml = '';
  if (saveTotal > 0) {
    saveBarHtml = `
      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-weight:600;">
          <span>Saving to Database:</span>
          <span>${saveCurrent}/${saveTotal} &nbsp;(${savePercentage}%)</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width:${savePercentage}%;background:linear-gradient(90deg,#fd7e14,#ffc107);"></div>
        </div>
      </div>
    `;
  } else if (dbStatus) {
    saveBarHtml = `<div style="margin-top:10px;font-weight:bold;color:#0c5460;">${dbStatus}</div>`;
  }

  const progressHTML = `
    <div class="progress-info">
      <div class="progress-stat">
        <span class="stat-label">Progress:</span>
        <span class="stat-value">${percentage}%</span>
      </div>
      <div class="progress-stat">
        <span class="stat-label">Pages Scanned:</span>
        <span class="stat-value">${pageScanned}/${totalPages}</span>
      </div>
      <div class="progress-stat">
        <span class="stat-label">Power Blocks Found:</span>
        <span class="stat-value">${pbFound}</span>
      </div>
      <div class="progress-stat">
        <span class="stat-label">LBDs Found:</span>
        <span class="stat-value">${lbdsFound}</span>
      </div>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" style="width: ${percentage}%"></div>
    </div>
    ${saveBarHtml}
  `;
  
  element.innerHTML = progressHTML;
}

// Utility functions
function showStatus(elementId, message, type) {
  const element = document.getElementById(elementId);
  element.classList.remove('hidden');
  if (type === 'error') {
    element.className = 'alert alert-error';
  } else if (type === 'info') {
    element.className = 'alert alert-info';
  } else {
    element.className = 'alert alert-success';
  }
  element.textContent = message;
}

// ============================================================
// CLAIM PAGE
// ============================================================
let claimPageState = {
  blocks: [],
  selectedBlockId: null,
  selectedBlockIds: [],
  search: '',
  zoneFilter: '',
  sort: 'number_asc',
  statusFilter: 'all',
  rangeStart: '',
  rangeEnd: '',
  peopleSuggestions: [],
  scanDraft: null,
  scanFileName: '',
  scanCrewText: '',
  scanWorkDate: todayIsoDate(),
  loading: false,
  scanLoading: false,
  scanSubmitting: false,
  blockHistory: {},       // { [blockId]: { loading: bool, data: [] } }
  historyOpen: {},        // { [blockId]: bool }
  noteEditing: null,      // blockId currently in edit mode
};

function claimSelectedBlock() {
  return claimPageState.blocks.find(block => Number(block.id) === Number(claimPageState.selectedBlockId)) || null;
}

function claimNormalizeSelectedBlockIds(blockIds) {
  const validIds = new Set(claimPageState.blocks.map((block) => Number(block.id)));
  const normalized = [];
  const seen = new Set();
  (blockIds || []).forEach((value) => {
    const blockId = Number(value);
    if (!Number.isFinite(blockId) || !validIds.has(blockId) || seen.has(blockId)) return;
    seen.add(blockId);
    normalized.push(blockId);
  });
  return normalized;
}

function claimSetSelectedBlockIds(blockIds) {
  claimPageState.selectedBlockIds = claimNormalizeSelectedBlockIds(blockIds);
}

function claimSelectedBlocks() {
  const selectedIds = new Set(claimPageState.selectedBlockIds.map((value) => Number(value)));
  return claimPageState.blocks.filter((block) => selectedIds.has(Number(block.id)));
}

function canReleaseClaim(block) {
  return !!(block && currentUserCan('claim_delete'));
}

function blockHasClaim(block) {
  if (!block) return false;
  const claimedPeople = Array.isArray(block.claimed_people) ? block.claimed_people.filter(Boolean) : [];
  const assignments = block.claim_assignments && typeof block.claim_assignments === 'object'
    ? Object.keys(block.claim_assignments).length
    : 0;
  return Boolean(block.claimed_by || claimedPeople.length || assignments);
}

function claimClaimedLbdCount(block) {
  if (!block || !block.claim_assignments || typeof block.claim_assignments !== 'object') return 0;
  const claimedIds = new Set();
  Object.values(block.claim_assignments).forEach((ids) => {
    if (!Array.isArray(ids)) return;
    ids.forEach((value) => {
      const id = Number(value);
      if (Number.isFinite(id) && id > 0) claimedIds.add(id);
    });
  });
  return claimedIds.size;
}

function claimBlockClaimProgress(block) {
  const totalItems = Number(block?.lbd_count || 0);
  if (!totalItems) return 0;
  return Math.max(0, Math.min(1, claimClaimedLbdCount(block) / totalItems));
}

function claimTotalSteps(block) {
  return Number(block?.lbd_count || 0) * LBD_STATUS_TYPES.length;
}

function claimCompletionRatio(block) {
  const totalSteps = claimTotalSteps(block);
  if (!totalSteps) return 0;
  return Math.max(0, Math.min(1, claimCompletedSteps(block) / totalSteps));
}

function claimFormatPct(progress) {
  const percent = progress * 100;
  return Math.abs(percent - Math.round(percent)) < 0.005
    ? `${Math.round(percent)}%`
    : `${percent.toFixed(2)}%`;
}

function claimBlockIsFullyClaimed(block) {
  const totalItems = Number(block?.lbd_count || 0);
  return totalItems > 0 && claimClaimedLbdCount(block) >= totalItems;
}

function claimBlockVisualState(block) {
  const claimProgress = claimBlockClaimProgress(block);
  const completed = claimBlockIsCompleted(block);
  const inProgress = claimBlockIsInProgress(block);
  const fullyClaimed = claimBlockIsFullyClaimed(block);
  return {
    complete: completed || fullyClaimed,
    inProgress: !(completed || fullyClaimed) && (claimProgress > 0 || inProgress),
    claimProgress,
  };
}

function claimBlockNumber(block) {
  const raw = block.power_block_number || block.name || '';
  const match = String(raw).match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function claimCompletedSteps(block) {
  const summary = block.lbd_summary || {};
  return LBD_STATUS_TYPES.reduce((total, statusType) => total + Number(summary[statusType] || 0), 0);
}

function claimBlockIsInProgress(block) {
  const totalSteps = claimTotalSteps(block);
  if (!totalSteps) return false;
  const completedSteps = claimCompletedSteps(block);
  return completedSteps > 0 && completedSteps < totalSteps;
}

function claimBlockIsCompleted(block) {
  const totalSteps = claimTotalSteps(block);
  if (!totalSteps) return false;
  return claimCompletedSteps(block) >= totalSteps;
}

function claimCompareBlocks(a, b, sortKey) {
  if (sortKey === 'number_desc') {
    return claimBlockNumber(b) - claimBlockNumber(a) || String(a.name || '').localeCompare(String(b.name || ''));
  }
  if (sortKey === 'recent_claimed') {
    const aTime = a.claimed_at ? (Date.parse(a.claimed_at) || 0) : 0;
    const bTime = b.claimed_at ? (Date.parse(b.claimed_at) || 0) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return claimBlockNumber(a) - claimBlockNumber(b);
  }
  return claimBlockNumber(a) - claimBlockNumber(b) || String(a.name || '').localeCompare(String(b.name || ''));
}

function claimZoneOptions() {
  const zones = [...new Set(claimPageState.blocks.map((block) => block.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (zones.length === 0 && Array.isArray(_adminZoneNames) && _adminZoneNames.length > 0) {
    return _adminZoneNames.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  return zones;
}

function claimFilteredBlocks() {
  const query = claimPageState.search.trim().toLowerCase();
  let filtered = [...claimPageState.blocks];

  if (claimPageState.zoneFilter) {
    filtered = filtered.filter((block) => (block.zone || '') === claimPageState.zoneFilter);
  }

  if (claimPageState.statusFilter === 'unclaimed') {
    filtered = filtered.filter((block) => !blockHasClaim(block));
  } else if (claimPageState.statusFilter === 'recently_claimed') {
    filtered = filtered.filter((block) => !!block.claimed_at);
  } else if (claimPageState.statusFilter === 'in_progress') {
    filtered = filtered.filter((block) => claimBlockIsInProgress(block));
  } else if (claimPageState.statusFilter === 'completed') {
    filtered = filtered.filter((block) => claimBlockIsCompleted(block));
  }

  if (query) {
    filtered = filtered.filter((block) => {
      const haystack = [block.name, block.zone, block.claimed_label, block.claimed_by]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  filtered.sort((a, b) => claimCompareBlocks(a, b, claimPageState.sort));
  return filtered;
}

function claimSelectBlock(blockId) {
  claimPageState.selectedBlockId = Number(blockId);
  claimPageState.scanDraft = null;
  claimPageState.scanFileName = '';
  renderClaimPage();
}

function claimToggleBlockSelection(blockId, shouldSelect) {
  const next = new Set(claimPageState.selectedBlockIds.map((value) => Number(value)));
  const normalizedId = Number(blockId);
  if (shouldSelect) next.add(normalizedId);
  else next.delete(normalizedId);
  claimSetSelectedBlockIds(Array.from(next));
  if (shouldSelect) {
    claimPageState.selectedBlockId = normalizedId;
  }
  renderClaimPage();
}

function claimUpdateSearch(value) {
  claimPageState.search = String(value || '');
  renderClaimPage();
}

function claimUpdateZoneFilter(value) {
  claimPageState.zoneFilter = String(value || '');
  renderClaimPage();
}

function claimUpdateSort(value) {
  claimPageState.sort = String(value || 'number_asc');
  renderClaimPage();
}

function claimUpdateStatusFilter(value) {
  claimPageState.statusFilter = String(value || 'all');
  renderClaimPage();
}

function claimUpdateRangeStart(value) {
  claimPageState.rangeStart = String(value || '');
}

function claimUpdateRangeEnd(value) {
  claimPageState.rangeEnd = String(value || '');
}

function claimSelectVisibleBlocks() {
  const filtered = claimFilteredBlocks();
  claimSetSelectedBlockIds(filtered.map((block) => block.id));
  if (filtered.length) {
    claimPageState.selectedBlockId = Number(filtered[0].id);
  }
  renderClaimPage();
}

function claimClearSelectedBlocks() {
  claimPageState.selectedBlockIds = [];
  renderClaimPage();
}

function claimSelectRange() {
  const start = Number.parseInt(claimPageState.rangeStart, 10);
  const end = Number.parseInt(claimPageState.rangeEnd, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    alert('Enter both a start and end PB number first.');
    return;
  }

  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  const matchingBlocks = claimFilteredBlocks().filter((block) => {
    const blockNumber = claimBlockNumber(block);
    return Number.isFinite(blockNumber) && blockNumber >= lower && blockNumber <= upper;
  });

  if (!matchingBlocks.length) {
    alert(`No visible power blocks matched the range ${lower}-${upper}.`);
    return;
  }

  claimSetSelectedBlockIds(matchingBlocks.map((block) => block.id));
  claimPageState.selectedBlockId = Number(matchingBlocks[0].id);
  renderClaimPage();
}

async function claimReleaseSelectedBlock() {
  const block = claimSelectedBlock();
  if (!block) return;
  await claimBlock(block.id, 'unclaim');
}

async function showBulkClaimDialog() {
  const blocks = claimSelectedBlocks();
  if (blocks.length === 1) {
    await showClaimPeopleDialog(blocks[0]);
    return;
  }
  if (!blocks.length) {
    alert('Select at least one power block first.');
    return;
  }

  let suggestions = Array.isArray(claimPageState.peopleSuggestions) ? claimPageState.peopleSuggestions.slice() : [];
  if (!suggestions.length) {
    try {
      const response = await api.getClaimPeople();
      suggestions = Array.isArray(response.data) ? response.data : [];
      claimPageState.peopleSuggestions = suggestions;
    } catch (e) {
      suggestions = [];
    }
  }

  const blockNames = blocks.map((block) => String(block.name || '').trim()).filter(Boolean);
  const totalItems = blocks.reduce((sum, block) => sum + Number(block.lbd_count || 0), 0);
  const defaultPeople = currentUser?.name ? [currentUser.name] : [];
  const defaultWorkDate = todayIsoDate();
  const statusHeaderButtons = LBD_STATUS_TYPES.map((statusType) => {
    const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
    return `<button type="button" class="btn btn-secondary bulk-claim-apply-status" data-status-type="${_escapeHtml(statusType)}" style="padding:6px 10px;font-size:11px;">Apply ${label} To All</button>`;
  }).join('');
  const sortedBulkLbdsByBlock = Object.fromEntries(blocks.map((block) => [
    String(block.id),
    (Array.isArray(block.lbds) ? [...block.lbds] : []).sort((left, right) => getLbdDisplayLabel(left).localeCompare(getLbdDisplayLabel(right), undefined, { numeric: true, sensitivity: 'base' }))
  ]));
  const blockRowsHtml = blocks.map((block) => {
    const labels = LBD_STATUS_TYPES.map((statusType) => {
      const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
      return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;">
        <input type="checkbox" class="bulk-claim-block-status" data-block-id="${block.id}" value="${_escapeHtml(statusType)}" />
        <span style="color:#eef2ff;font-size:12px;">${label}</span>
      </label>`;
    }).join('');
    return `<div class="bulk-claim-block-row" data-block-id="${block.id}" style="padding:12px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="color:#eef2ff;font-size:13px;font-weight:700;">${_escapeHtml(block.name)}</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:4px;">${block.lbd_count || 0} ${getPowerBlockCountLabel(block.lbd_count || 0)} in this block</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary bulk-claim-block-select-all" data-block-id="${block.id}" style="padding:5px 9px;font-size:11px;">All Tasks</button>
          <button type="button" class="btn btn-secondary bulk-claim-block-clear" data-block-id="${block.id}" style="padding:5px 9px;font-size:11px;">Clear</button>
        </div>
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
        ${labels}
      </div>
      <div class="bulk-claim-block-assignments" data-block-id="${block.id}" style="margin-top:12px;"></div>
    </div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'claim-people-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(3,8,20,0.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:10px;overflow-y:auto;-webkit-overflow-scrolling:touch;';

  const optionsHtml = suggestions.map((name) => {
    const escaped = _escapeHtml(name);
    const checked = defaultPeople.includes(name) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;background:rgba(255,255,255,0.04);cursor:pointer;min-height:44px;">
      <input type="checkbox" class="claim-person-option" value="${escaped}" ${checked} style="width:20px;height:20px;min-width:20px;" />
      <span style="color:#eef2ff;font-size:14px;">${escaped}</span>
    </label>`;
  }).join('');

  overlay.innerHTML = `
    <div style="width:min(980px,100%);max-height:90vh;overflow:auto;background:#0f172a;border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,0.45);-webkit-overflow-scrolling:touch;">
      <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;">
        <div>
          <div style="color:#eef2ff;font-size:18px;font-weight:700;">Bulk Claim ${blocks.length} Power Blocks</div>
          <div style="color:#94a3b8;font-size:12px;margin-top:4px;">One submission will claim ${blocks.length} blocks and ${totalItems} ${getPowerBlockCountLabel(totalItems)} with the same crew setup.</div>
        </div>
        <button type="button" id="bulk-claim-close" style="background:transparent;border:none;color:#94a3b8;font-size:24px;cursor:pointer;padding:4px 8px;">×</button>
      </div>
      <div id="bulk-claim-editor">
        <div style="margin-top:16px;">
          <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Selected power blocks</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${blockNames.slice(0, 20).map((name) => `<span style="padding:6px 10px;border-radius:999px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.18);color:#d7f7ff;font-size:12px;">${_escapeHtml(name)}</span>`).join('')}${blockNames.length > 20 ? `<span style="padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-size:12px;">+${blockNames.length - 20} more</span>` : ''}</div>
        </div>
        <div style="margin-top:18px;">
          <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Crew on these blocks</label>
          <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
            ${optionsHtml || '<div style="color:#94a3b8;font-size:12px;">No saved people yet — add names below.</div>'}
          </div>
          <div style="margin-top:12px;">
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Add extra crew names</label>
            <textarea id="bulk-claim-extra-names" class="claim-modal-textarea" rows="2" placeholder="Type names separated by commas or new lines" style="width:100%;resize:vertical;font-size:14px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;"></textarea>
          </div>
          <div style="margin-top:12px;">
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Claim Date</label>
            <input id="bulk-claim-work-date" type="date" value="${_escapeHtml(defaultWorkDate)}" style="width:100%;min-height:42px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;" />
            <div style="margin-top:6px;color:#94a3b8;font-size:11px;">Use a past date when you need to catch up old claims.</div>
          </div>
        </div>
        <div style="margin-top:18px;">
          <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Work types by power block</label>
          <div style="color:#94a3b8;font-size:12px;margin-bottom:10px;">Choose the finished work types for each PB, then pick the exact LBDs that were actually completed for that task.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
            <button type="button" class="btn btn-secondary" id="bulk-claim-select-all-tasks" style="padding:6px 10px;font-size:11px;">Select Every Task For Every Block</button>
            <button type="button" class="btn btn-secondary" id="bulk-claim-clear-all-tasks" style="padding:6px 10px;font-size:11px;">Clear All Tasks</button>
            ${statusHeaderButtons}
          </div>
          <div style="display:grid;gap:10px;max-height:460px;overflow:auto;padding-right:4px;">
            ${blockRowsHtml}
          </div>
        </div>
      </div>
      <div id="bulk-claim-review" style="display:none;margin-top:16px;padding:16px;border-radius:14px;border:1px solid rgba(0,212,255,0.16);background:rgba(0,212,255,0.05);">
        <div style="font-size:12px;font-weight:700;color:#8adfff;letter-spacing:0.7px;text-transform:uppercase;">Review Bulk Claim</div>
        <div id="bulk-claim-review-content" style="margin-top:12px;"></div>
      </div>
      <div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
        <button type="button" id="bulk-claim-cancel" class="btn btn-secondary" style="min-height:44px;padding:10px 20px;font-size:14px;">Cancel</button>
        <button type="button" id="bulk-claim-back" class="btn btn-secondary" style="display:none;min-height:44px;padding:10px 20px;font-size:14px;">Back</button>
        <button type="button" id="bulk-claim-review-btn" class="btn btn-primary" style="min-height:44px;padding:10px 20px;font-size:14px;">Review Bulk Claim</button>
        <button type="button" id="bulk-claim-submit" class="btn btn-success" style="display:none;min-height:44px;padding:10px 20px;font-size:14px;">Submit Bulk Claim</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const editorPanel = overlay.querySelector('#bulk-claim-editor');
  const reviewPanel = overlay.querySelector('#bulk-claim-review');
  const reviewContent = overlay.querySelector('#bulk-claim-review-content');
  const reviewBtn = overlay.querySelector('#bulk-claim-review-btn');
  const backBtn = overlay.querySelector('#bulk-claim-back');
  const submitBtn = overlay.querySelector('#bulk-claim-submit');
  const bulkAssignmentsByBlock = {};

  blocks.forEach((block) => {
    bulkAssignmentsByBlock[String(block.id)] = {};
  });

  const getBulkBlockLbds = (blockId) => sortedBulkLbdsByBlock[String(blockId)] || [];

  const getBulkBlockState = (blockId) => {
    const key = String(blockId);
    if (!bulkAssignmentsByBlock[key]) bulkAssignmentsByBlock[key] = {};
    return bulkAssignmentsByBlock[key];
  };

  const getSelectedStatusesForBlock = (blockId) => {
    const state = getBulkBlockState(blockId);
    return LBD_STATUS_TYPES.filter((statusType) => Object.prototype.hasOwnProperty.call(state, statusType));
  };

  const syncBlockStatusInputs = (blockId) => {
    const selected = new Set(getSelectedStatusesForBlock(blockId));
    overlay.querySelectorAll(`.bulk-claim-block-status[data-block-id="${blockId}"]`).forEach((input) => {
      input.checked = selected.has(String(input.value || '').trim());
    });
  };

  const syncBulkTaskSelectionCount = (blockId, statusType) => {
    const countEl = overlay.querySelector(`.bulk-claim-task-selected-count[data-block-id="${blockId}"][data-status-type="${statusType}"]`);
    if (!countEl) return;
    const selectedCount = (getBulkBlockState(blockId)[statusType] || []).length;
    const totalCount = getBulkBlockLbds(blockId).length;
    countEl.textContent = `${selectedCount} of ${totalCount} ${getPowerBlockCountLabel(totalCount)} selected`;
  };

  const renderBulkBlockAssignments = (blockId) => {
    const block = blocks.find((entry) => String(entry.id) === String(blockId));
    const container = overlay.querySelector(`.bulk-claim-block-assignments[data-block-id="${blockId}"]`);
    if (!block || !container) return;

    const selectedStatuses = getSelectedStatusesForBlock(blockId);
    if (!selectedStatuses.length) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;">Select one or more work types to choose the exact LBDs finished in this PB.</div>';
      return;
    }

    const blockLbds = getBulkBlockLbds(blockId);
    const blockState = getBulkBlockState(blockId);
    container.innerHTML = selectedStatuses.map((statusType) => {
      const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
      const selectedIds = new Set((blockState[statusType] || []).map(Number).filter(Number.isFinite));
      const options = blockLbds.map((lbd) => {
        const lbdId = Number(lbd.id);
        const checked = selectedIds.has(lbdId) ? 'checked' : '';
        const name = _escapeHtml(getLbdDisplayLabel(lbd));
        return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;min-height:40px;">
          <input type="checkbox" class="bulk-claim-lbd-option" data-block-id="${block.id}" data-status-type="${_escapeHtml(statusType)}" value="${lbd.id}" ${checked} />
          <span style="color:#eef2ff;font-size:12px;">${name}</span>
        </label>`;
      }).join('');

      return `<div style="margin-top:10px;padding:12px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(15,23,42,0.55);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="color:#eef2ff;font-size:12px;font-weight:700;">${label}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="bulk-claim-task-selected-count" data-block-id="${block.id}" data-status-type="${_escapeHtml(statusType)}" style="color:#94a3b8;font-size:11px;">${selectedIds.size} of ${blockLbds.length} ${getPowerBlockCountLabel(blockLbds.length)} selected</div>
            <button type="button" class="btn btn-secondary bulk-claim-task-select-all" data-block-id="${block.id}" data-status-type="${_escapeHtml(statusType)}" style="padding:5px 9px;font-size:11px;">Select All</button>
            <button type="button" class="btn btn-secondary bulk-claim-task-clear" data-block-id="${block.id}" data-status-type="${_escapeHtml(statusType)}" style="padding:5px 9px;font-size:11px;">Clear</button>
          </div>
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;max-height:170px;overflow:auto;padding-right:4px;">
          ${options || '<div style="color:#94a3b8;font-size:12px;">No LBDs found for this block.</div>'}
        </div>
      </div>`;
    }).join('');
  };

  const setBlockStatusSelection = (blockId, statusType, shouldCheck) => {
    const normalizedStatusType = String(statusType || '').trim();
    if (!normalizedStatusType) return;
    const blockState = getBulkBlockState(blockId);
    if (shouldCheck) {
      if (!Object.prototype.hasOwnProperty.call(blockState, normalizedStatusType)) {
        blockState[normalizedStatusType] = getBulkBlockLbds(blockId).map((lbd) => Number(lbd.id)).filter(Number.isFinite);
      }
    } else {
      delete blockState[normalizedStatusType];
    }
    syncBlockStatusInputs(blockId);
    renderBulkBlockAssignments(blockId);
  };

  const setBlockStatuses = (blockId, statusTypes) => {
    const selected = new Set((statusTypes || []).map((statusType) => String(statusType || '').trim()).filter(Boolean));
    LBD_STATUS_TYPES.forEach((statusType) => {
      const shouldCheck = selected.has(statusType);
      const blockState = getBulkBlockState(blockId);
      if (shouldCheck) {
        if (!Object.prototype.hasOwnProperty.call(blockState, statusType)) {
          blockState[statusType] = getBulkBlockLbds(blockId).map((lbd) => Number(lbd.id)).filter(Number.isFinite);
        }
      } else {
        delete blockState[statusType];
      }
    });
    syncBlockStatusInputs(blockId);
    renderBulkBlockAssignments(blockId);
  };

  const setAllBlocksStatus = (statusType, shouldCheck) => {
    blocks.forEach((block) => {
      const blockState = getBulkBlockState(block.id);
      if (shouldCheck) {
        if (!Object.prototype.hasOwnProperty.call(blockState, statusType)) {
          blockState[statusType] = getBulkBlockLbds(block.id).map((lbd) => Number(lbd.id)).filter(Number.isFinite);
        }
      } else {
        delete blockState[statusType];
      }
      syncBlockStatusInputs(block.id);
      renderBulkBlockAssignments(block.id);
    });
  };

  const setTaskLbdSelection = (blockId, statusType, shouldSelect) => {
    const normalizedStatusType = String(statusType || '').trim();
    if (!normalizedStatusType) return;
    const blockState = getBulkBlockState(blockId);
    if (!Object.prototype.hasOwnProperty.call(blockState, normalizedStatusType)) return;
    blockState[normalizedStatusType] = shouldSelect
      ? getBulkBlockLbds(blockId).map((lbd) => Number(lbd.id)).filter(Number.isFinite)
      : [];
    overlay.querySelectorAll(`.bulk-claim-lbd-option[data-block-id="${blockId}"][data-status-type="${normalizedStatusType}"]`).forEach((input) => {
      input.checked = Boolean(shouldSelect);
    });
    syncBulkTaskSelectionCount(blockId, normalizedStatusType);
  };

  const updateTaskLbdSelection = (blockId, statusType, lbdId, checked) => {
    const normalizedStatusType = String(statusType || '').trim();
    const normalizedLbdId = Number(lbdId);
    if (!normalizedStatusType || !Number.isFinite(normalizedLbdId)) return;
    const blockState = getBulkBlockState(blockId);
    if (!Object.prototype.hasOwnProperty.call(blockState, normalizedStatusType)) {
      blockState[normalizedStatusType] = [];
    }
    const selectedIds = new Set((blockState[normalizedStatusType] || []).map(Number).filter(Number.isFinite));
    if (checked) {
      selectedIds.add(normalizedLbdId);
    } else {
      selectedIds.delete(normalizedLbdId);
    }
    blockState[normalizedStatusType] = Array.from(selectedIds);
    syncBulkTaskSelectionCount(blockId, normalizedStatusType);
  };

  const buildDraft = () => {
    const checkedPeople = Array.from(overlay.querySelectorAll('.claim-person-option:checked'))
      .map((input) => String(input.value || '').trim())
      .filter(Boolean);
    const extraPeople = claimParseCrewNames(overlay.querySelector('#bulk-claim-extra-names')?.value || '');
    const workDate = String(overlay.querySelector('#bulk-claim-work-date')?.value || todayIsoDate());
    const assignmentsByBlock = {};
    const statusTypeSet = new Set();
    blocks.forEach((block) => {
      const blockState = getBulkBlockState(block.id);
      Object.entries(blockState).forEach(([statusType, lbdIds]) => {
        const normalizedIds = Array.isArray(lbdIds) ? lbdIds.map(Number).filter(Number.isFinite) : [];
        if (!normalizedIds.length) return;
        if (!assignmentsByBlock[block.id]) assignmentsByBlock[block.id] = {};
        assignmentsByBlock[block.id][statusType] = normalizedIds;
        statusTypeSet.add(statusType);
      });
    });
    return {
      people: _dedupeClaimNames([...checkedPeople, ...extraPeople]),
      assignmentsByBlock,
      statusTypes: Array.from(statusTypeSet),
      workDate,
    };
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.classList.contains('bulk-claim-block-status')) {
      setBlockStatusSelection(target.dataset.blockId, target.value, target.checked);
      return;
    }
    if (target.classList.contains('bulk-claim-lbd-option')) {
      updateTaskLbdSelection(target.dataset.blockId, target.dataset.statusType, target.value, target.checked);
    }
  });
  overlay.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    if (button.classList.contains('bulk-claim-task-select-all')) {
      setTaskLbdSelection(button.dataset.blockId, button.dataset.statusType, true);
      return;
    }
    if (button.classList.contains('bulk-claim-task-clear')) {
      setTaskLbdSelection(button.dataset.blockId, button.dataset.statusType, false);
    }
  });
  overlay.querySelector('#bulk-claim-close').addEventListener('click', close);
  overlay.querySelector('#bulk-claim-cancel').addEventListener('click', close);
  overlay.querySelector('#bulk-claim-select-all-tasks').addEventListener('click', () => {
    blocks.forEach((block) => setBlockStatuses(block.id, LBD_STATUS_TYPES));
  });
  overlay.querySelector('#bulk-claim-clear-all-tasks').addEventListener('click', () => {
    blocks.forEach((block) => setBlockStatuses(block.id, []));
  });
  overlay.querySelectorAll('.bulk-claim-apply-status').forEach((button) => {
    button.addEventListener('click', () => {
      const statusType = String(button.dataset.statusType || '').trim();
      if (!statusType) return;
      const inputs = Array.from(overlay.querySelectorAll(`.bulk-claim-block-status[value="${statusType}"]`));
      const shouldCheck = inputs.some((input) => !input.checked);
      setAllBlocksStatus(statusType, shouldCheck);
    });
  });
  overlay.querySelectorAll('.bulk-claim-block-select-all').forEach((button) => {
    button.addEventListener('click', () => {
      const blockId = button.dataset.blockId;
      setBlockStatuses(blockId, LBD_STATUS_TYPES);
    });
  });
  overlay.querySelectorAll('.bulk-claim-block-clear').forEach((button) => {
    button.addEventListener('click', () => {
      const blockId = button.dataset.blockId;
      setBlockStatuses(blockId, []);
    });
  });

  blocks.forEach((block) => {
    syncBlockStatusInputs(block.id);
    renderBulkBlockAssignments(block.id);
  });

  reviewBtn.addEventListener('click', () => {
    const draft = buildDraft();
    if (!draft.people.length) {
      alert('Choose at least one crew member before reviewing the bulk claim.');
      return;
    }
    const perBlockRows = blocks.map((block) => {
      const assignments = draft.assignmentsByBlock[block.id] || {};
      const labels = Object.entries(assignments).map(([statusType, lbdIds]) => {
        const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
        const selectedNames = getBulkBlockLbds(block.id)
          .filter((lbd) => lbdIds.includes(Number(lbd.id)))
          .map((lbd) => _escapeHtml(getLbdDisplayLabel(lbd)));
        const preview = selectedNames.slice(0, 6).join(', ');
        const extraCount = selectedNames.length > 6 ? `, +${selectedNames.length - 6} more` : '';
        return `<div style="margin-top:6px;color:#94a3b8;font-size:12px;">
          <span style="color:#eef2ff;">${label}</span> • ${lbdIds.length} ${getPowerBlockCountLabel(lbdIds.length)}
          ${preview ? `<div style="margin-top:4px;color:#8adfff;">${preview}${extraCount}</div>` : ''}
        </div>`;
      }).join('');
      return `<div style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
        <div style="font-weight:700;color:#eef2ff;">${_escapeHtml(block.name)}</div>
        <div style="margin-top:4px;color:#94a3b8;font-size:12px;">${labels || 'Crew only, no task assignments'}</div>
      </div>`;
    }).join('');
    reviewContent.innerHTML = `
      <div style="display:grid;gap:12px;">
        <div>
          <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Crew</div>
          <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${draft.people.map(_escapeHtml).join(', ')}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Work Types By Block</div>
          <div style="margin-top:8px;display:grid;gap:8px;">${perBlockRows}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Claim Date</div>
          <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${_escapeHtml(draft.workDate)}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Selected Blocks</div>
          <div style="margin-top:6px;color:#eef2ff;font-size:14px;">${blockNames.map(_escapeHtml).join(', ')}</div>
        </div>
      </div>`;
    editorPanel.style.display = 'none';
    reviewPanel.style.display = 'block';
    reviewBtn.style.display = 'none';
    backBtn.style.display = 'inline-flex';
    submitBtn.style.display = 'inline-flex';
    submitBtn._draft = draft;
  });

  backBtn.addEventListener('click', () => {
    editorPanel.style.display = 'block';
    reviewPanel.style.display = 'none';
    reviewBtn.style.display = 'inline-flex';
    backBtn.style.display = 'none';
    submitBtn.style.display = 'none';
  });

  submitBtn.addEventListener('click', async () => {
    const draft = submitBtn._draft || buildDraft();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      await api.bulkClaimBlocks(blocks.map((block) => block.id), 'claim', draft.people, draft.assignmentsByBlock, draft.statusTypes, draft.workDate);
      close();
      await loadClaimPage();
      if (document.getElementById('blocks-list')) {
        loadBlocks();
      }
    } catch (e) {
      alert('Bulk claim failed: ' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Bulk Claim';
    }
  });
}

function claimSetScanCrewText(value) {
  claimPageState.scanCrewText = String(value || '');
}

function claimSetScanWorkDate(value) {
  claimPageState.scanWorkDate = String(value || todayIsoDate());
}

function claimAppendCrewName(name) {
  const parts = claimPageState.scanCrewText
    .split(/[\n,]/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.some(part => part.toLowerCase() === String(name).trim().toLowerCase())) {
    parts.push(String(name).trim());
  }
  claimPageState.scanCrewText = parts.join(', ');
  renderClaimPage();
}

function claimResetScanDraft() {
  claimPageState.scanDraft = null;
  claimPageState.scanFileName = '';
  claimPageState.scanLoading = false;
  claimPageState.scanSubmitting = false;
  renderClaimPage();
}

function claimParseCrewNames(text) {
  return String(text || '')
    .split(/[\n,]/)
    .map(name => name.trim())
    .filter(Boolean);
}

function claimReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read claim scan file'));
    reader.readAsDataURL(file);
  });
}

async function claimDraftScanFile(input) {
  const block = claimSelectedBlock();
  const file = input && input.files ? input.files[0] : null;
  if (!block) {
    alert('Select a power block before uploading a claim scan.');
    if (input) input.value = '';
    return;
  }
  if (!file) return;

  claimPageState.scanLoading = true;
  claimPageState.scanDraft = null;
  claimPageState.scanFileName = file.name;
  renderClaimPage();

  try {
    const imageBase64 = await claimReadFileAsDataUrl(file);
    const response = await api.draftClaimScan({
      power_block_id: block.id,
      tracker_id: currentTracker ? currentTracker.id : null,
      image_base64: imageBase64,
      file_name: file.name,
    });
    claimPageState.scanDraft = response.data || null;
    if (!claimPageState.scanCrewText && currentUser?.name) {
      claimPageState.scanCrewText = currentUser.name;
    }
  } catch (e) {
    alert('Claim scan draft failed: ' + e.message);
  } finally {
    claimPageState.scanLoading = false;
    renderClaimPage();
  }
}

async function claimSubmitScanDraft() {
  const block = claimSelectedBlock();
  const draft = claimPageState.scanDraft;
  if (!block || !draft) return;

  const people = claimParseCrewNames(claimPageState.scanCrewText);
  if (people.length === 0) {
    alert('Add at least one crew member before submitting the scan claim.');
    return;
  }

  claimPageState.scanSubmitting = true;
  renderClaimPage();
  try {
    const response = await api.submitClaimScan({
      power_block_id: block.id,
      tracker_id: currentTracker ? currentTracker.id : null,
      people,
      work_date: claimPageState.scanWorkDate,
      assignments: draft.assignments || {},
      draft,
    });
    if (_blocksCache[block.id] && response.data && response.data.claim) {
      Object.assign(_blocksCache[block.id], response.data.claim);
    }
    claimPageState.scanDraft = null;
    claimPageState.scanFileName = '';
    await loadClaimPage();
  } catch (e) {
    alert('Claim scan submit failed: ' + e.message);
    claimPageState.scanSubmitting = false;
    renderClaimPage();
  }
}

async function claimToggleHistory(blockId) {
  const id = Number(blockId);
  claimPageState.historyOpen[id] = !claimPageState.historyOpen[id];
  if (claimPageState.historyOpen[id] && !claimPageState.blockHistory[id]) {
    claimPageState.blockHistory[id] = { loading: true, data: [] };
    renderClaimPage();
    try {
      const r = await fetch(`/api/tracker/power-blocks/${id}/history`, { credentials: 'include' });
      const j = await r.json();
      claimPageState.blockHistory[id] = { loading: false, data: j.data || [] };
    } catch (e) {
      claimPageState.blockHistory[id] = { loading: false, data: [] };
    }
  }
  renderClaimPage();
}

function claimStartNoteEdit(blockId) {
  claimPageState.noteEditing = Number(blockId);
  renderClaimPage();
  // Focus the textarea after render
  requestAnimationFrame(() => {
    const ta = document.getElementById(`claim-note-textarea-${blockId}`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  });
}

function claimCancelNoteEdit(blockId) {
  claimPageState.noteEditing = null;
  renderClaimPage();
}

async function claimSaveNote(blockId) {
  const id = Number(blockId);
  const ta = document.getElementById(`claim-note-textarea-${id}`);
  const noteText = ta ? ta.value.trim() : '';
  try {
    await api.call(`/tracker/power-blocks/${id}/note`, {
      method: 'POST',
      body: JSON.stringify({ note: noteText }),
    });
    // Update cached block
    const block = claimPageState.blocks.find(b => b.id === id);
    if (block) block.notes = noteText || null;
    if (_blocksCache[id]) _blocksCache[id].notes = noteText || null;
    claimPageState.noteEditing = null;
    renderClaimPage();
  } catch (e) {
    alert('Failed to save note: ' + e.message);
  }
}

async function loadClaimPage() {
  const el = document.getElementById('claim-content');
  if (!el || claimPageState.loading) return;
  claimPageState.loading = true;

  el.innerHTML = '<div class="form-section" style="padding:18px 20px;color:#94a3b8;">Loading claim workflow...</div>';
  try {
    const [blocksResponse, peopleResponse] = await Promise.all([
      api.getPowerBlocks(),
      api.getClaimPeople().catch(() => ({ data: [] }))
    ]);
    const blocks = Array.isArray(blocksResponse.data) ? blocksResponse.data : [];
    claimPageState.blocks = blocks;
    claimPageState.peopleSuggestions = Array.isArray(peopleResponse.data) ? peopleResponse.data : [];
    blocks.forEach((block) => { _blocksCache[block.id] = block; });
    claimSetSelectedBlockIds(claimPageState.selectedBlockIds);
    if (!claimPageState.selectedBlockId || !blocks.some(block => Number(block.id) === Number(claimPageState.selectedBlockId))) {
      claimPageState.selectedBlockId = blocks.length ? blocks[0].id : null;
      claimPageState.scanDraft = null;
      claimPageState.scanFileName = '';
    }
  } catch (e) {
    el.innerHTML = `<div class="form-section" style="padding:18px 20px;color:#ff8fa3;">Failed to load claim workflow: ${_escapeHtml(e.message)}</div>`;
    claimPageState.loading = false;
    return;
  }

  renderClaimPage();
  claimPageState.loading = false;
}

function renderClaimPage() {
  const el = document.getElementById('claim-content');
  if (!el) return;

  // Guard: claims disabled for this tracker
  if (currentTracker?.claims_enabled === false) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
      <div style="font-size:40px;margin-bottom:12px;">🚫</div>
      <h3 style="margin:0 0 8px;font-size:16px;color:#94a3b8;">Claims Disabled</h3>
      <p style="color:#64748b;font-size:13px;max-width:320px;">Claims are not enabled for the <strong>${_escapeHtml(currentTracker.name)}</strong> tracker.</p>
    </div>`;
    return;
  }

  const filtered = claimFilteredBlocks();
  const selectedBlock = claimSelectedBlock();
  const selectedBlocks = claimSelectedBlocks();
  const selectedBlockIds = new Set(selectedBlocks.map((block) => Number(block.id)));
  const claimedBlocks = claimPageState.blocks.filter(block => blockHasClaim(block));
  const crewCount = new Set(claimedBlocks.flatMap(block => {
    if (Array.isArray(block.claimed_people) && block.claimed_people.length > 0) return block.claimed_people;
    return block.claimed_by ? [block.claimed_by] : [];
  })).size;
  const scanDraft = claimPageState.scanDraft;
  const zoneOptions = claimZoneOptions();

  const summaryCard = (label, value, meta, toneClass = '') => `
    <article class="claim-summary-card ${toneClass}">
      <div class="claim-summary-label">${label}</div>
      <div class="claim-summary-value">${value}</div>
      <div class="claim-summary-meta">${meta}</div>
    </article>`;

  // Zone-grouped block tile rendering
  const _claimStatusTypes = currentTracker?.status_types || [];
  const _claimPrimaryStatus = currentTracker?.completion_status_type || (_claimStatusTypes.length ? _claimStatusTypes[_claimStatusTypes.length - 1] : 'term');
  const _renderBlockTile = (block) => {
    const selected = selectedBlock && Number(selectedBlock.id) === Number(block.id);
    const checked = selectedBlockIds.has(Number(block.id));
    const claimedLbdCount = claimClaimedLbdCount(block);
    const visualState = claimBlockVisualState(block);
    const fullyClaimed = claimBlockIsFullyClaimed(block);
    const progressSteps = claimTotalSteps(block);
    const completedSteps = claimCompletedSteps(block);
    const progressPctLabel = claimFormatPct(visualState.completionRatio);
    const hasClaim = blockHasClaim(block);
    const claimLabel = hasClaim
      ? `Claimed by ${_escapeHtml(block.claimed_label || (Array.isArray(block.claimed_people) ? block.claimed_people.join(', ') : '') || block.claimed_by || 'Crew')}`
      : (visualState.complete ? 'Complete in this tracker' : (visualState.inProgress ? 'Work in progress' : 'Ready to claim'));
    const claimProgressLabel = fullyClaimed
      ? `All ${block.lbd_count || 0} ${getPowerBlockCountLabel(block.lbd_count || 0)} claimed`
      : (hasClaim && claimedLbdCount > 0
        ? `${claimedLbdCount}/${block.lbd_count || 0} ${getPowerBlockCountLabel(block.lbd_count || 0)} claimed`
        : (visualState.complete || visualState.inProgress)
          ? `${completedSteps}/${progressSteps} parts complete \u2022 ${progressPctLabel}`
          : 'No live claim on this block');
    const zoneText = block.zone ? _escapeHtml(block.zone) : 'Unzoned';
    return `<button type="button" class="claim-block-tile${selected ? ' is-selected' : ''}${checked ? ' is-checked' : ''}${visualState.complete ? ' is-fully-claimed' : ''}${visualState.inProgress ? ' is-partially-claimed' : ''}" onclick="claimSelectBlock(${block.id})">
      <div class="claim-block-tile-top">
        <span class="claim-block-name">${_escapeHtml(block.name)}</span>
        <span class="claim-block-zone">${zoneText}</span>
      </div>
      <div class="claim-block-tile-controls">
        <label class="claim-block-check" onclick="event.stopPropagation()">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="claimToggleBlockSelection(${block.id}, this.checked)" />
          <span>${checked ? 'Included in batch' : 'Add to batch'}</span>
        </label>
      </div>
      <div class="claim-block-status${hasClaim ? ' is-claimed' : (visualState.complete || visualState.inProgress ? ' is-complete' : '')}">${claimLabel}</div>
      <div class="claim-block-claim-copy${visualState.complete ? ' is-fully-claimed' : ''}">${_escapeHtml(claimProgressLabel)}</div>
      <div class="claim-block-meta-row">
        <span class="claim-block-count">${block.lbd_count || 0} ${getPowerBlockCountLabel(block.lbd_count || 0)}</span>
        <span class="claim-block-progress">${progressPctLabel} complete</span>
      </div>
    </button>`;
  };
  // Group blocks by zone and build HTML with zone summary headers
  const _UNZONED = '\u2014 Unzoned';
  const _zoneGroups = {};
  filtered.forEach(b => { const z = b.zone || _UNZONED; (_zoneGroups[z] = _zoneGroups[z] || []).push(b); });
  const _zoneKeys = Object.keys(_zoneGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const blockTiles = _zoneKeys.map(zName => {
    const zBlocks = _zoneGroups[zName];
    const zTotal = zBlocks.reduce((s, b) => s + (b.lbd_count || 0), 0);
    const zDone = zBlocks.reduce((s, b) => s + ((b.lbd_summary && b.lbd_summary[_claimPrimaryStatus]) || 0), 0);
    const zPct = zTotal > 0 ? Math.round((zDone / zTotal) * 100) : 0;
    const zSummary = `${zBlocks.length} block${zBlocks.length === 1 ? '' : 's'} \u00b7 ${zDone}/${zTotal} LBDs done \u00b7 ${zPct}%`;
    const hdr = `<div class="claim-zone-header"><span class="claim-zone-header-name">${_escapeHtml(zName)}</span><span class="claim-zone-header-summary">${zSummary}</span></div>`;
    return hdr + zBlocks.map(_renderBlockTile).join('');
  }).join('');

  const selectedAssignments = selectedBlock ? _buildClaimAssignmentSummary(selectedBlock) : '';
  const selectedClaimedPeople = selectedBlock
    ? ((Array.isArray(selectedBlock.claimed_people) && selectedBlock.claimed_people.length > 0)
      ? selectedBlock.claimed_people.map(_escapeHtml).join(', ')
      : (selectedBlock.claimed_by ? _escapeHtml(selectedBlock.claimed_by) : ''))
    : '';
  const scanPreviewRows = scanDraft ? (scanDraft.preview_rows || []).map((row) => {
    const statuses = Array.isArray(row.statuses) && row.statuses.length
      ? row.statuses.map(status => _escapeHtml(STATUS_LABELS[status] || status.replace(/_/g, ' '))).join(', ')
      : 'No tasks detected';
    return `<div class="claim-scan-preview-row">
      <span class="claim-scan-preview-name">${_escapeHtml(row.lbd_label || `LBD ${row.lbd_id}`)}</span>
      <span class="claim-scan-preview-statuses">${statuses}</span>
    </div>`;
  }).join('') : '';
  const warningHtml = scanDraft && Array.isArray(scanDraft.warnings) && scanDraft.warnings.length
    ? `<div class="claim-warning-grid">${scanDraft.warnings.map((warning) => `<div class="claim-warning-card">${_escapeHtml(warning)}</div>`).join('')}</div>`
    : '<div class="claim-muted-copy">No scan warnings.</div>';
  const suggestionButtons = claimPageState.peopleSuggestions.slice(0, 10).map((name) => {
    const encodedName = encodeURIComponent(String(name));
    return `<button type="button" class="claim-crew-chip" onclick="claimAppendCrewName(decodeURIComponent('${encodedName}'))">${_escapeHtml(name)}</button>`;
  }).join('');
  const canClaimSelection = selectedBlocks.length > 1
    ? currentUserCan('claim_create')
    : (selectedBlock ? currentUserCan('claim_create') : false);
  const claimActionButton = selectedBlocks.length > 1
    ? `<button class="btn btn-primary" ${canClaimSelection ? `onclick="showBulkClaimDialog()"` : 'disabled'}>Add Claim To ${selectedBlocks.length} Blocks</button>`
    : (selectedBlock
      ? `<button class="btn btn-primary" ${canClaimSelection ? `onclick="showClaimPeopleDialogById(${selectedBlock.id})"` : 'disabled'}>Add Claim</button>`
      : '<button class="btn btn-primary" disabled>Add Claim</button>');
  const historyButton = selectedBlock && currentUserCan('admin_settings')
    ? `<button class="btn btn-secondary" onclick="rp_openBackfillDialog(${selectedBlock.id})">Historical Claim</button>`
    : '';
  const releaseButton = selectedBlock && canReleaseClaim(selectedBlock)
    ? `<button class="btn btn-danger" onclick="claimReleaseSelectedBlock()">Release Claim</button>`
    : '';
  const detailsButton = selectedBlock
    ? `<button class="btn btn-secondary" onclick="showBlockModal(${selectedBlock.id})">View Details</button>`
    : '';
  const selectedRangeCopy = selectedBlocks.length > 1
    ? `${selectedBlocks.length} blocks selected for bulk claim`
    : 'Choose a power block to manage its claim workflow.';
  const bulkSelectionCard = selectedBlocks.length > 1
    ? `<div class="claim-info-card claim-info-card-accent">
        <div class="claim-card-label claim-card-label-accent">Bulk Selection</div>
        <div class="claim-card-value">${selectedBlocks.length} power blocks ready</div>
        <div class="claim-card-copy">${selectedBlocks.map((block) => _escapeHtml(block.name)).join(', ')}</div>
      </div>`
    : '';
  const scanStatusCopy = claimPageState.scanLoading
    ? `Scanning ${_escapeHtml(claimPageState.scanFileName || 'claim image')}...`
    : (claimPageState.scanFileName ? `Loaded: ${_escapeHtml(claimPageState.scanFileName)}` : 'No scan selected yet.');

  el.innerHTML = `
    <div class="claim-shell">
      <section class="claim-hero">
        <div class="claim-hero-copy">
          <div class="claim-kicker">Claim Center</div>
          <div class="claim-hero-title">Review-first claiming for the active tracker</div>
          <div class="claim-hero-subtitle">Select a power block, build the crew and assignments, then review the claim before it is submitted. Scan claims stay in the same workspace so manual and scanned entry follow one consistent flow.</div>
        </div>
        <div class="claim-summary-grid">
          ${summaryCard('Blocks', claimPageState.blocks.length, 'Power blocks in this tracker', 'claim-tone-neutral')}
          ${summaryCard('Claimed', claimedBlocks.length, 'Blocks currently owned by a crew', 'claim-tone-cyan')}
          ${summaryCard('Crew Active', crewCount, 'Distinct crew members on live claims', 'claim-tone-emerald')}
          ${summaryCard('Selected', selectedBlocks.length, 'Ready for bulk claim from this page', 'claim-tone-neutral')}
        </div>
      </section>

      <section class="claim-filter-shell">
        <div class="claim-search-wrap">
          <input class="claim-search-input" type="text" value="${_escapeHtml(claimPageState.search)}" oninput="claimUpdateSearch(this.value)" placeholder="Search blocks, zones, or claimed crew" />
        </div>
        <div class="claim-filter-group">
          <span class="claim-filter-label">Zone</span>
          <select class="claim-filter-select" onchange="claimUpdateZoneFilter(this.value)">
            <option value="">All Zones</option>
            ${zoneOptions.map((zone) => `<option value="${_escapeHtml(zone)}"${claimPageState.zoneFilter === zone ? ' selected' : ''}>${_escapeHtml(zone)}</option>`).join('')}
          </select>
        </div>
        <div class="claim-filter-group">
          <span class="claim-filter-label">Status</span>
          <select class="claim-filter-select" onchange="claimUpdateStatusFilter(this.value)">
            <option value="all"${claimPageState.statusFilter === 'all' ? ' selected' : ''}>All Statuses</option>
            <option value="unclaimed"${claimPageState.statusFilter === 'unclaimed' ? ' selected' : ''}>Not Claimed</option>
            <option value="recently_claimed"${claimPageState.statusFilter === 'recently_claimed' ? ' selected' : ''}>Recently Claimed</option>
            <option value="in_progress"${claimPageState.statusFilter === 'in_progress' ? ' selected' : ''}>In Progress</option>
            <option value="completed"${claimPageState.statusFilter === 'completed' ? ' selected' : ''}>Completed</option>
          </select>
        </div>
        <div class="claim-filter-group">
          <span class="claim-filter-label">Order</span>
          <select class="claim-filter-select" onchange="claimUpdateSort(this.value)">
            <option value="number_asc"${claimPageState.sort === 'number_asc' ? ' selected' : ''}>Number Ascending</option>
            <option value="number_desc"${claimPageState.sort === 'number_desc' ? ' selected' : ''}>Number Descending</option>
            <option value="recent_claimed"${claimPageState.sort === 'recent_claimed' ? ' selected' : ''}>Recently Claimed</option>
          </select>
        </div>
        <div class="claim-filter-actions">
          <button class="btn btn-secondary" onclick="loadClaimPage()">Refresh</button>
        </div>
      </section>

      <div class="claim-workspace">
        <section class="claim-blocks-panel">
          <div class="claim-panel-head">
            <div>
              <div class="claim-panel-kicker">Select Power Blocks</div>
              <div class="claim-panel-subtitle">Pick one block for detail view or batch-select a range for catch-up claiming.</div>
            </div>
            <div class="claim-panel-count">${filtered.length} shown • ${selectedBlocks.length} selected</div>
          </div>
          <div class="claim-selection-toolbar">
            <div class="claim-selection-meta">Use range select for runs like PB 18-30, or select every visible block.</div>
            <div class="claim-range-controls">
              <input class="claim-range-input" type="number" inputmode="numeric" placeholder="Start PB" value="${_escapeHtml(claimPageState.rangeStart)}" oninput="claimUpdateRangeStart(this.value)" />
              <input class="claim-range-input" type="number" inputmode="numeric" placeholder="End PB" value="${_escapeHtml(claimPageState.rangeEnd)}" oninput="claimUpdateRangeEnd(this.value)" />
              <button class="btn btn-secondary" onclick="claimSelectRange()">Select Range</button>
              <button class="btn btn-secondary" onclick="claimSelectVisibleBlocks()">Select Visible</button>
              <button class="btn btn-secondary" onclick="claimClearSelectedBlocks()" ${selectedBlocks.length ? '' : 'disabled'}>Clear</button>
            </div>
          </div>
          <div class="claim-block-list">${blockTiles || '<div class="claim-empty-state"><strong>No power blocks match the current filter.</strong><span>Try a different zone, status, or search term.</span></div>'}</div>
        </section>

        <aside class="claim-detail-panel">
          <div class="claim-selected-header">
            <div class="claim-panel-kicker">Selected Block</div>
            <div class="claim-selected-name">${selectedBlock ? _escapeHtml(selectedBlock.name) : 'None selected'}</div>
            <div class="claim-selected-meta">${selectedBlock ? `${selectedBlock.lbd_count || 0} ${getPowerBlockCountLabel(selectedBlock.lbd_count || 0)} in the active tracker` : selectedRangeCopy}</div>
          </div>
          <div class="claim-action-row">${claimActionButton}${historyButton}${releaseButton}${detailsButton}</div>
          ${bulkSelectionCard}
          <div class="claim-info-card">
            <div class="claim-card-label">Claim Status</div>
            <div class="claim-card-value">${selectedBlock && blockHasClaim(selectedBlock) ? `Claimed by ${_escapeHtml(selectedBlock.claimed_label || (Array.isArray(selectedBlock.claimed_people) ? selectedBlock.claimed_people.join(', ') : '') || selectedBlock.claimed_by || 'Crew')}` : 'Ready to claim'}</div>
            <div class="claim-card-meta">${selectedClaimedPeople || 'No crew assigned yet.'}</div>
            ${selectedAssignments || ''}
          </div>
          ${selectedBlock ? (() => {
            const note = selectedBlock.notes || '';
            const editState = claimPageState.noteEditing === selectedBlock.id;
            return `<div class="claim-note-card" id="claim-note-card-${selectedBlock.id}">
              <div class="claim-note-header">
                <span class="claim-card-label">Block Note</span>
                ${!editState ? `<button class="claim-note-edit-btn" onclick="claimStartNoteEdit(${selectedBlock.id})">✏ ${note ? 'Edit' : 'Add note'}</button>` : ''}
              </div>
              ${editState
                ? `<textarea id="claim-note-textarea-${selectedBlock.id}" class="claim-note-textarea" rows="3" placeholder="Add a note about this block…">${_escapeHtml(note)}</textarea>
                   <div class="claim-note-actions">
                     <button class="btn btn-primary btn-sm" onclick="claimSaveNote(${selectedBlock.id})">Save</button>
                     <button class="btn btn-secondary btn-sm" onclick="claimCancelNoteEdit(${selectedBlock.id})">Cancel</button>
                   </div>`
                : (note ? `<div class="claim-note-text">${_escapeHtml(note)}</div>` : '<div class="claim-muted-copy" style="font-size:12px;">No note added yet.</div>')
              }
            </div>`;
          })() : ''}
          ${(() => {
            if (!selectedBlock) return '';
            const bhState = claimPageState.blockHistory[selectedBlock.id];
            const isOpen = claimPageState.historyOpen[selectedBlock.id];
            const historyItems = (!bhState || bhState.loading) ? '' : (bhState.data || []).map(h => {
              const dateStr = h.work_date || '';
              const atStr = h.claimed_at ? new Date(h.claimed_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
              return `<div class="block-history-row">
                <span class="block-history-bullet"></span>
                <div class="block-history-body">
                  <div class="block-history-crew">${_escapeHtml(h.crew_label)}</div>
                  <div class="block-history-meta">${_escapeHtml(h.task_summary || 'No tasks')} &middot; ${_escapeHtml(dateStr)}</div>
                  ${atStr ? `<div class="block-history-ts">${atStr}</div>` : ''}
                </div>
              </div>`;
            }).join('') || '<div class="claim-muted-copy" style="padding:6px 0;">No claim history for this block.</div>';
            return `<div class="claim-history-section">
              <button class="claim-history-toggle" onclick="claimToggleHistory(${selectedBlock.id})">
                Activity History ${isOpen ? '▲' : '▼'}
              </button>
              ${isOpen ? `<div class="claim-history-body">${bhState && bhState.loading ? '<div class="claim-muted-copy">Loading...</div>' : historyItems}</div>` : ''}
            </div>`;
          })()}
          <div class="claim-info-card claim-info-card-accent">
            <div class="claim-card-label claim-card-label-accent">Safeguards</div>
            <div class="claim-card-copy">Every manual claim now goes through a review step before submit. Claim scans below also require a preview plus crew confirmation before they are committed.</div>
          </div>
          <section class="claim-scan-card">
            <div>
              <div class="claim-card-label claim-card-label-accent">Claim Scan</div>
              <div class="claim-card-copy">Upload a marked claim sheet for the selected power block. The server will detect likely assignments and let you review them before submit.</div>
            </div>
            <div class="claim-scan-upload-row">
              <input type="file" class="claim-file-input" id="claim-scan-file" accept="image/*" onchange="claimDraftScanFile(this)" ${selectedBlock ? '' : 'disabled'} />
              <button class="btn btn-secondary" onclick="claimResetScanDraft()" ${scanDraft || claimPageState.scanFileName ? '' : 'disabled'}>Clear</button>
            </div>
            <div class="claim-scan-status${claimPageState.scanLoading ? ' is-loading' : ''}">${scanStatusCopy}</div>
            <div class="claim-field-group">
              <div class="claim-card-label">Claim Date</div>
              <input type="date" class="claim-modal-textarea" value="${_escapeHtml(claimPageState.scanWorkDate)}" oninput="claimSetScanWorkDate(this.value)" style="min-height:42px;resize:none;" />
              <div class="claim-muted-copy">Use a past date if this scan is being submitted after the work was done.</div>
            </div>
            <div class="claim-field-group">
              <div class="claim-card-label">Crew For This Scan</div>
              <textarea class="claim-modal-textarea claim-scan-textarea" oninput="claimSetScanCrewText(this.value)" placeholder="Add crew names separated by commas or new lines">${_escapeHtml(claimPageState.scanCrewText)}</textarea>
              <div class="claim-crew-chip-row">${suggestionButtons || '<span class="claim-muted-copy">No saved crew suggestions yet.</span>'}</div>
            </div>
            <div class="claim-scan-grid">
              <div class="claim-scan-section">
                <div class="claim-card-label">Detected Assignments</div>
                <div class="claim-scan-list">${scanDraft ? (scanPreviewRows || '<div class="claim-muted-copy">The scan did not detect any marked task cells yet.</div>') : '<div class="claim-muted-copy">Upload a claim sheet to preview detected LBD rows and tasks.</div>'}</div>
              </div>
              <div class="claim-scan-section">
                <div class="claim-card-label">Scan Warnings</div>
                <div class="claim-scan-list">${scanDraft ? warningHtml : '<div class="claim-muted-copy">Warnings and review notes will appear here after the scan finishes.</div>'}</div>
              </div>
            </div>
            <div class="claim-submit-row">
              <button class="btn btn-success" onclick="claimSubmitScanDraft()" ${(scanDraft && !claimPageState.scanSubmitting) ? '' : 'disabled'}>${claimPageState.scanSubmitting ? 'Submitting...' : 'Submit Scan Claim'}</button>
            </div>
          </section>
        </aside>
      </div>
    </div>`;
}

// ============================================================
// REPORTS PAGE
// ============================================================
let rp_viewMode = 'calendar';
let rp_reportsCache = [];
let rp_selectedDate = todayIsoDate();
let rp_calendarYear = new Date().getFullYear();
let rp_calendarMonth = new Date().getMonth();

function rp_formatDate(dateStr, options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString('en-US', options);
}

function rp_syncCalendarFromDate(dateStr) {
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return;
  rp_calendarYear = parsed.getFullYear();
  rp_calendarMonth = parsed.getMonth();
}

function rp_reportSummaryMap() {
  return new Map(rp_reportsCache.map((report) => [report.report_date, report]));
}

function rp_reportPdfUrl(dateStr, download = false) {
  const params = new URLSearchParams();
  if (currentTracker) params.set('tracker_id', currentTracker.id);
  if (download) params.set('download', '1');
  const query = params.toString();
  return `/api/reports/date/${encodeURIComponent(dateStr)}/pdf${query ? `?${query}` : ''}`;
}

function rp_openPdf(download = false) {
  if (!rp_selectedDate) return;
  const url = rp_reportPdfUrl(rp_selectedDate, download);
  if (download) {
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function rp_fetchReports(force = false) {
  if (!force && rp_reportsCache.length) return rp_reportsCache;
  const response = await api.call(api._tq('/reports'));
  const reports = Array.isArray(response.data) ? response.data : [];
  reports.sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')));
  rp_reportsCache = reports;
  return reports;
}

function rp_renderSummary(reports) {
  const summary = document.getElementById('rp-summary');
  if (!summary) return;
  if (!reports.length) {
    summary.innerHTML = '';
    return;
  }

  const totalReports = reports.length;
  const totalEntries = reports.reduce((sum, report) => sum + Number(report.total_entries || 0), 0);
  const totalScans = reports.reduce((sum, report) => sum + Number(report.claim_scan_count || 0), 0);
  const workersTouched = new Set(reports.flatMap((report) => report.workers || [])).size;
  const latestReport = reports[0];

  const cards = [
    { kicker: 'Reports Logged', value: `${totalReports}`, meta: 'Generated day snapshots on record', tone: 'cyan' },
    { kicker: 'Task Entries', value: `${totalEntries}`, meta: 'Logged work entries across this tracker view', tone: 'violet' },
    { kicker: 'Crew In Reports', value: `${workersTouched}`, meta: 'Distinct workers captured in report history', tone: 'emerald' },
    { kicker: 'Claim Scans', value: `${totalScans}`, meta: latestReport ? `Latest report: ${rp_formatDate(latestReport.report_date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No reports yet', tone: 'amber' },
  ];

  summary.innerHTML = cards.map((card) => `
    <article class="reports-summary-card reports-tone-${card.tone}">
      <div class="reports-summary-kicker">${card.kicker}</div>
      <div class="reports-summary-value">${card.value}</div>
      <div class="reports-summary-meta">${card.meta}</div>
    </article>
  `).join('');
}

function rp_renderEmpty(body, message, subcopy = '') {
  body.innerHTML = `
    <div class="reports-empty-state">
      <div class="reports-empty-title">${message}</div>
      ${subcopy ? `<div class="reports-empty-copy">${subcopy}</div>` : ''}
    </div>
  `;
}

async function loadReportsPage() {
  const el = document.getElementById('reports-content');
  if (!el) return;

  rp_syncCalendarFromDate(rp_selectedDate || todayIsoDate());
  const backfillBtn = currentUserCan('admin_settings')
    ? '<button class="btn btn-secondary" onclick="rp_openBackfillDialog()">Backfill Missing Claims</button>'
    : '';
  el.innerHTML = `
    <section class="reports-shell">
      <div class="reports-toolbar">
        <div class="reports-toolbar-tabs">
          <button id="rp-tab-calendar" class="reports-tab-btn" onclick="rp_switchView('calendar')">Calendar</button>
          <button id="rp-tab-list" class="reports-tab-btn" onclick="rp_switchView('list')">List</button>
          <button id="rp-tab-leaderboard" class="reports-tab-btn" onclick="rp_switchView('leaderboard')">Leaderboard</button>
        </div>
        <div class="reports-toolbar-actions" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <input id="rp-selected-date" type="date" value="${_escapeHtml(rp_selectedDate || todayIsoDate())}" onchange="rp_pickDate(this.value)" style="min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid rgba(15,23,42,0.12);background:#fff;color:#0f172a;" />
          <button class="reports-generate-btn" onclick="rp_generate()">Generate Selected Day</button>
          ${backfillBtn}
          <button class="btn btn-secondary" onclick="rp_openPdf(false)">View PDF</button>
          <button class="btn btn-secondary" onclick="rp_openPdf(true)">Download PDF</button>
        </div>
      </div>
      <div id="rp-summary" class="reports-summary-grid"></div>
      <div id="rp-body" class="reports-body"></div>
    </section>`;

  const reports = await rp_fetchReports(true).catch(() => []);
  rp_renderSummary(reports);
  await rp_switchView(rp_viewMode);
}

async function rp_switchView(mode) {
  rp_viewMode = mode;
  ['calendar', 'list', 'leaderboard'].forEach((value) => {
    const btn = document.getElementById(`rp-tab-${value}`);
    if (btn) btn.classList.toggle('active', value === mode);
  });
  if (mode === 'list') {
    await rp_loadList();
    return;
  }
  if (mode === 'leaderboard') {
    await rp_loadLeaderboard();
    return;
  }
  await rp_loadCalendar();
}

async function rp_generate(dateStr = null) {
  const targetDate = String(dateStr || document.getElementById('rp-selected-date')?.value || rp_selectedDate || todayIsoDate());
  try {
    const body = { date: targetDate };
    if (currentTracker) body.tracker_id = currentTracker.id;
    await api.call('/reports/generate', { method: 'POST', body: JSON.stringify(body) });
    await rp_fetchReports(true);
    rp_renderSummary(rp_reportsCache);
    await rp_showDetail(targetDate, true, false);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function rp_pickDate(value) {
  rp_selectedDate = String(value || todayIsoDate());
  rp_syncCalendarFromDate(rp_selectedDate);
  rp_showDetail(rp_selectedDate, true, true);
}

function rp_changeMonth(delta) {
  const next = new Date(rp_calendarYear, rp_calendarMonth + delta, 1);
  rp_calendarYear = next.getFullYear();
  rp_calendarMonth = next.getMonth();
  rp_loadCalendar(true);
}

async function rp_loadLeaderboard() {
  const el = document.getElementById('rp-body');
  if (!el) return;
  el.innerHTML = '<div class="reports-empty-copy">Loading leaderboard…</div>';
  try {
    const params = new URLSearchParams({ days: 30 });
    if (currentTracker) params.set('tracker_id', currentTracker.id);
    const res = await api.call(`/reports/leaderboard?${params}`);
    const people = Array.isArray(res.data) ? res.data : [];
    if (!people.length) {
      el.innerHTML = '<div class="reports-empty-copy">No claim activity logged yet. Start claiming power blocks to see crew stats here.</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = `
      <div class="rp-leaderboard-shell">
        <div class="rp-leaderboard-header">
          <div class="rp-leaderboard-title">Crew Leaderboard</div>
          <div class="rp-leaderboard-subtitle">LBDs worked — last 30 days</div>
        </div>
        <div class="rp-leaderboard-grid">
          ${people.map((p) => {
            const medal = medals[p.rank - 1] || `#${p.rank}`;
            const pct   = people[0].lbd_count > 0 ? Math.round((p.lbd_count / people[0].lbd_count) * 100) : 0;
            return `<div class="rp-lb-card${p.rank <= 3 ? ' rp-lb-top' : ''}">
              <div class="rp-lb-rank">${medal}</div>
              <div class="rp-lb-body">
                <div class="rp-lb-name">${_escapeHtml(p.name)}</div>
                <div class="rp-lb-stats">${p.lbd_count} LBDs &nbsp;·&nbsp; ${p.block_count} blocks &nbsp;·&nbsp; ${p.days_active} day${p.days_active === 1 ? '' : 's'}</div>
                <div class="rp-lb-bar-track"><div class="rp-lb-bar-fill" style="width:${pct}%"></div></div>
              </div>
              <div class="rp-lb-count">${p.lbd_count}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<p style="color:#ff4c6a;">Error loading leaderboard: ${_escapeHtml(e.message)}</p>`;
  }
}

async function rp_loadList(skipDetailLoad = false) {
  const el = document.getElementById('rp-body');
  if (!el) return;
  el.innerHTML = '<div class="reports-empty-copy">Loading reports…</div>';
  try {
    const reports = await rp_fetchReports();
    if (!reports.length) {
      rp_renderEmpty(el, 'No reports generated yet.', 'Choose any day above to generate or inspect a daily report.');
      return;
    }
    if (!rp_selectedDate) rp_selectedDate = reports[0].report_date;
    el.innerHTML = `
      <div class="reports-list-layout">
        <div class="reports-list-panel">
          ${reports.map((report) => {
            const workers = Array.isArray(report.workers) ? report.workers.length : 0;
            const entries = Number(report.total_entries || 0);
            const scans = Number(report.claim_scan_count || 0);
            const active = report.report_date === rp_selectedDate;
            return `
              <button type="button" class="reports-list-card${active ? ' active' : ''}" data-report-date="${report.report_date}" onclick="rp_showDetail('${report.report_date}', true, true)">
                <div class="reports-list-card-main">
                  <div class="reports-list-card-date">${rp_formatDate(report.report_date)}</div>
                  <div class="reports-list-card-meta">${workers} worker${workers === 1 ? '' : 's'} • ${entries} entries • ${scans} claim scan${scans === 1 ? '' : 's'}</div>
                </div>
                ${report.latest_claim_scan_image_url ? `<img class="reports-list-thumb" src="${report.latest_claim_scan_image_url}" alt="Latest claim scan">` : '<div class="reports-list-thumb reports-list-thumb-empty">No scan</div>'}
              </button>`;
          }).join('')}
        </div>
        <div id="rp-detail" class="reports-detail-shell"></div>
      </div>`;
    if (!skipDetailLoad && rp_selectedDate) {
      await rp_showDetail(rp_selectedDate, false, true);
    }
  } catch (e) {
    el.innerHTML = `<p style="color:#ff4c6a;">Error: ${_escapeHtml(e.message)}</p>`;
  }
}

async function rp_loadCalendar(skipDetailLoad = false) {
  const el = document.getElementById('rp-body');
  if (!el) return;
  el.innerHTML = '<div class="reports-empty-copy">Loading calendar…</div>';
  try {
    const reports = await rp_fetchReports();
    const reportMap = new Map(reports.map((report) => [report.report_date, report]));
    const firstDay = new Date(rp_calendarYear, rp_calendarMonth, 1).getDay();
    const daysInMonth = new Date(rp_calendarYear, rp_calendarMonth + 1, 0).getDate();
    const monthTitle = new Date(rp_calendarYear, rp_calendarMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const today = todayIsoDate();

    let html = `
      <div class="reports-calendar-shell">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
            <div class="reports-calendar-title">${monthTitle}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" onclick="rp_changeMonth(-1)">Previous Month</button>
              <button type="button" class="btn btn-secondary" onclick="rp_changeMonth(1)">Next Month</button>
            </div>
          </div>
          <div class="reports-calendar-grid">`;
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day) => {
      html += `<div class="reports-calendar-dow">${day}</div>`;
    });
    for (let index = 0; index < firstDay; index += 1) {
      html += '<div class="reports-calendar-spacer"></div>';
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = `${rp_calendarYear}-${String(rp_calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const summary = reportMap.get(dateStr) || null;
      const classes = ['reports-calendar-day'];
      if (dateStr === today) classes.push('today');
      if (dateStr === rp_selectedDate) classes.push('active');
      if (summary) classes.push('has-report');
      html += `
        <button type="button" class="${classes.join(' ')}" onclick="rp_showDetail('${dateStr}', true, true)">
          <span>${day}</span>
          ${summary ? `<span class="reports-calendar-dot"></span><small style="display:block;font-size:10px;color:#64748b;margin-top:4px;">${Number(summary.total_entries || 0)} entries</small>` : '<small style="display:block;font-size:10px;color:#94a3b8;margin-top:4px;">Open day</small>'}
        </button>`;
    }
    html += '</div></div><div id="rp-detail" class="reports-detail-shell"></div></div>';
    el.innerHTML = html;
    if (!skipDetailLoad && rp_selectedDate) {
      await rp_showDetail(rp_selectedDate, false, true);
    }
  } catch (e) {
    el.innerHTML = `<p style="color:#ff4c6a;">Error: ${_escapeHtml(e.message)}</p>`;
  }
}

async function rp_showDetail(dateStr, syncSelection = true, ensure = true) {
  if (syncSelection) {
    rp_selectedDate = String(dateStr || todayIsoDate());
    rp_syncCalendarFromDate(rp_selectedDate);
    const dateInput = document.getElementById('rp-selected-date');
    if (dateInput) dateInput.value = rp_selectedDate;
    document.querySelectorAll('.reports-list-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.reportDate === rp_selectedDate);
    });
  }

  const detailEl = document.getElementById('rp-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '<div class="reports-empty-copy">Loading report…</div>';

  try {
    const endpoint = ensure ? api._tq(`/reports/date/${dateStr}?ensure=1`) : api._tq(`/reports/date/${dateStr}`);
    const response = await api.call(endpoint);
    const report = response.data;
    if (!report) {
      detailEl.innerHTML = '<div class="reports-empty-copy">No report is available for this date yet.</div>';
      return;
    }

    await rp_fetchReports(true);
    rp_renderSummary(rp_reportsCache);

    const data = report.data || {};
    const workers = Array.isArray(data.worker_names) ? data.worker_names : [];
    const scans = Array.isArray(data.claim_scans) ? data.claim_scans : [];
    const byWorker = data.by_worker || {};
    const byTask = data.by_task || {};
    const byPowerBlock = data.by_power_block || {};
    const rawEntries = Array.isArray(data.raw_entries) ? data.raw_entries : [];
    const dateTitle = rp_formatDate(dateStr, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const uniqueTextValues = (values) => {
      const seen = new Set();
      const result = [];
      (values || []).forEach((value) => {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
      });
      return result;
    };
    const renderLineItems = (items, formatter) => Object.entries(items).map(([key, value]) => formatter(key, value)).join('');
    const summarizeList = (values, previewCount = 4) => {
      const normalized = uniqueTextValues(values);
      if (!normalized.length) return 'None recorded';
      const preview = normalized.slice(0, previewCount).join(', ');
      const remaining = normalized.length - previewCount;
      return remaining > 0 ? `${preview} +${remaining} more` : preview;
    };
    const collectTaskBlocks = (taskMap) => {
      const blocks = [];
      Object.values(taskMap || {}).forEach((entries) => {
        if (Array.isArray(entries)) {
          blocks.push(...entries);
        } else if (entries) {
          blocks.push(entries);
        }
      });
      return uniqueTextValues(blocks);
    };
    const collectTaskWorkers = (taskMap) => uniqueTextValues(Object.keys(taskMap || {}));
    const sumTaskAssignments = (taskMap) => Object.values(taskMap || {}).reduce((total, entries) => {
      if (Array.isArray(entries)) return total + entries.length;
      return entries ? total + 1 : total;
    }, 0);
    const topTaskSnapshot = Object.entries(byTask)
      .map(([task, workerMap]) => ({
        task,
        workerCount: collectTaskWorkers(workerMap).length,
        blockCount: collectTaskBlocks(workerMap).length,
        assignmentCount: sumTaskAssignments(workerMap),
      }))
      .sort((left, right) => right.assignmentCount - left.assignmentCount)[0];
    const topBlockSnapshot = Object.entries(byPowerBlock)
      .map(([powerBlock, taskMap]) => ({
        powerBlock,
        taskCount: Object.keys(taskMap || {}).length,
        assignmentCount: sumTaskAssignments(taskMap),
      }))
      .sort((left, right) => right.assignmentCount - left.assignmentCount)[0];
    const topWorkerSnapshot = Object.entries(byWorker)
      .map(([worker, taskMap]) => ({
        worker,
        taskCount: Object.keys(taskMap || {}).length,
        blockCount: collectTaskBlocks(taskMap).length,
        assignmentCount: sumTaskAssignments(taskMap),
      }))
      .sort((left, right) => right.assignmentCount - left.assignmentCount)[0];

    const crewLbdGroups = Array.isArray(data.crew_lbd_groups) ? data.crew_lbd_groups : [];
    // Group crew_lbd_groups by power block for rendering
    const crewByBlock = {};
    crewLbdGroups.forEach(g => {
      const pb = g.power_block_name || '?';
      if (!crewByBlock[pb]) crewByBlock[pb] = [];
      crewByBlock[pb].push(g);
    });
    const crewLbdGroupsHtml = Object.entries(crewByBlock).map(([pbName, groups]) => {
      const totalLbds = groups.reduce((s, g2) => s + (g2.tasks || []).reduce((ts, t) => ts + (t.lbd_count || 0), 0), 0);
      const blockNotes = (groups[0] || {}).block_notes;
      const noteLineHtml = blockNotes ? `<div class="reports-insight-note">${_escapeHtml(blockNotes)}</div>` : '';
      const rowsHtml = groups.map(g2 => {
        const crewBadge = g2.is_crew ? '<span class="reports-note-pill" style="background:rgba(99,102,241,0.15);color:#a5b4fc;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:600;margin-right:6px;">Crew</span>' : '';
        const pills = (g2.tasks || []).map(t => {
          const label = STATUS_LABELS[t.task] || t.task;
          const color = STATUS_COLORS[t.task] || '#4f8cff';
          return `<span class="reports-status-pill" style="--report-pill:${color}">${_escapeHtml(label)} · ${_escapeHtml(t.lbd_range || '')}</span>`;
        }).join('');
        return `<div class="reports-crew-lbd-row"><div class="reports-crew-lbd-name">${crewBadge}${_escapeHtml(g2.crew_label)}</div><div class="reports-pill-row" style="margin-top:4px;">${pills}</div></div>`;
      }).join('');
      return `
        <article class="reports-insight-card reports-insight-card-block">
          <div class="reports-insight-card-head">
            <div>
              <div class="reports-insight-title">${_escapeHtml(pbName)}</div>
              <div class="reports-insight-meta">${groups.length} ${groups.length === 1 ? 'entry' : 'entries'} · ${totalLbds} LBDs</div>
              ${noteLineHtml}
            </div>
            <div class="reports-insight-count">${totalLbds}</div>
          </div>
          <div class="reports-crew-lbd-stack">${rowsHtml}</div>
        </article>`;
    }).join('');

    const blockCardsHtml = Object.entries(byPowerBlock)
      .sort((left, right) => sumTaskAssignments(right[1]) - sumTaskAssignments(left[1]))
      .map(([powerBlock, taskMap]) => {
        const taskEntries = Object.entries(taskMap || {});
        const workerNames = uniqueTextValues(taskEntries.flatMap(([, workersForTask]) => Array.isArray(workersForTask) ? workersForTask : [workersForTask]));
        const pills = taskEntries.map(([task, workersForTask]) => {
          const label = STATUS_LABELS[task] || task;
          const color = STATUS_COLORS[task] || '#4f8cff';
          const count = Array.isArray(workersForTask) ? workersForTask.length : (workersForTask ? 1 : 0);
          return `<span class="reports-status-pill" style="--report-pill:${color}">${_escapeHtml(label)} · ${count}</span>`;
        }).join('');
        const lines = taskEntries.map(([task, workersForTask]) => {
          const label = STATUS_LABELS[task] || task;
          const workerList = Array.isArray(workersForTask) ? workersForTask : [workersForTask].filter(Boolean);
          return `<div class="reports-line-item"><span class="reports-line-dot" style="background:${STATUS_COLORS[task] || '#4f8cff'}"></span><span class="reports-line-label">${_escapeHtml(label)}</span><span class="reports-line-copy">${_escapeHtml(summarizeList(workerList, 5))}</span></div>`;
        }).join('');
        return `
          <article class="reports-insight-card reports-insight-card-block">
            <div class="reports-insight-card-head">
              <div>
                <div class="reports-insight-title">${_escapeHtml(powerBlock)}</div>
                <div class="reports-insight-meta">${workerNames.length} crew members involved</div>
              </div>
              <div class="reports-insight-count">${sumTaskAssignments(taskMap)}</div>
            </div>
            ${pills ? `<div class="reports-pill-row">${pills}</div>` : ''}
            <div class="reports-detail-stack reports-detail-stack-compact">${lines || '<div class="reports-line-copy">No task rows</div>'}</div>
          </article>`;
      }).join('');

    let html = `
      <div class="reports-detail-card">
        <div class="reports-detail-head">
          <div>
            <div class="reports-detail-kicker">Daily Report</div>
            <h3 class="reports-detail-title">${dateTitle}</h3>
            <div class="reports-detail-meta">Generated ${report.generated_at ? new Date(report.generated_at).toLocaleString() : 'just now'}</div>
          </div>
          <div class="reports-detail-stat-row">
            <div class="reports-detail-stat"><span>${Number(data.total_entries || 0)}</span><small>Entries</small></div>
            <div class="reports-detail-stat"><span>${Number(data.total_lbd_count || 0)}</span><small>LBDs</small></div>
            <div class="reports-detail-stat"><span>${workers.length}</span><small>Workers</small></div>
            <div class="reports-detail-stat"><span>${Object.keys(byPowerBlock).length}</span><small>Blocks</small></div>
            <div class="reports-detail-stat"><span>${scans.length}</span><small>Claim Scans</small></div>
          </div>
        </div>
        <div class="reports-detail-actions">
          <button class="btn btn-primary" onclick="rp_generate('${dateStr}')">Refresh This Day</button>
          <button class="btn btn-secondary" onclick="rp_openPdf(false)">View PDF</button>
          <button class="btn btn-secondary" onclick="rp_openPdf(true)">Download PDF</button>
          <a class="btn btn-secondary" href="/api/reports/date/${dateStr}/export?format=csv${currentTracker ? '&tracker_id=' + currentTracker.id : ''}" download>⬇ CSV</a>
          <a class="btn btn-secondary" href="/api/reports/date/${dateStr}/export?format=xlsx${currentTracker ? '&tracker_id=' + currentTracker.id : ''}" download>⬇ XLSX</a>
        </div>
        <div class="reports-snapshot-grid">
          <article class="reports-snapshot-card">
            <div class="reports-snapshot-label">Lead Contributor</div>
            <div class="reports-snapshot-value">${_escapeHtml(topWorkerSnapshot?.worker || 'No entries')}</div>
            <div class="reports-snapshot-copy">${topWorkerSnapshot ? `${topWorkerSnapshot.blockCount} blocks across ${topWorkerSnapshot.taskCount} task types` : 'No worker activity recorded.'}</div>
          </article>
          <article class="reports-snapshot-card">
            <div class="reports-snapshot-label">Top Task</div>
            <div class="reports-snapshot-value">${_escapeHtml(topTaskSnapshot ? (STATUS_LABELS[topTaskSnapshot.task] || topTaskSnapshot.task) : 'No task data')}</div>
            <div class="reports-snapshot-copy">${topTaskSnapshot ? `${topTaskSnapshot.assignmentCount} placements on ${topTaskSnapshot.blockCount} blocks` : 'No task activity recorded.'}</div>
          </article>
          <article class="reports-snapshot-card">
            <div class="reports-snapshot-label">Top Block</div>
            <div class="reports-snapshot-value">${_escapeHtml(topBlockSnapshot?.powerBlock || 'No block data')}</div>
            <div class="reports-snapshot-copy">${topBlockSnapshot ? `${topBlockSnapshot.assignmentCount} placements across ${topBlockSnapshot.taskCount} task types` : 'No block activity recorded.'}</div>
          </article>
          <article class="reports-snapshot-card">
            <div class="reports-snapshot-label">Crew Coverage</div>
            <div class="reports-snapshot-value">${workers.length ? `${workers.length} active` : 'None logged'}</div>
            <div class="reports-snapshot-copy">${_escapeHtml(summarizeList(workers, 5))}</div>
          </article>
        </div>`;

    if (crewLbdGroups.length > 0) {
      html += `<div class="reports-detail-section"><div class="reports-detail-section-head"><div class="reports-detail-section-title">Per-LBD Activity</div><div class="reports-section-meta">Exactly who did what and which LBDs they covered</div></div><div class="reports-insight-grid reports-insight-grid-wide">${crewLbdGroupsHtml}</div></div>`;
    }

    if (Object.keys(byPowerBlock).length > 0) {
      html += `<div class="reports-detail-section"><div class="reports-detail-section-head"><div class="reports-detail-section-title">Block Coverage</div><div class="reports-section-meta">Each block shows task mix and assigned crew</div></div><div class="reports-insight-grid reports-insight-grid-wide">${blockCardsHtml}</div></div>`;
    }

    if (scans.length > 0) {
      html += `<div class="reports-detail-section"><div class="reports-detail-section-title">Claim Scans</div><div class="reports-scan-grid">${scans.map((scan) => {
        const assignmentSummary = scan.assignment_summary || {};
        const summaryText = Object.entries(assignmentSummary).map(([task, count]) => `${STATUS_LABELS[task] || task}: ${count}`).join(' • ');
        return `
          <article class="reports-scan-card">
            ${scan.image_url ? `<img src="${scan.image_url}" alt="Claim scan for ${scan.power_block_name || 'report'}">` : '<div class="reports-scan-empty">No image</div>'}
            <div class="reports-scan-meta">${_escapeHtml(scan.power_block_name || 'Power Block')} • ${_escapeHtml((scan.people || []).join(', ') || 'No crew listed')}</div>
            <div class="reports-scan-copy">${_escapeHtml(summaryText || 'No assignment summary')}</div>
          </article>`;
      }).join('')}</div></div>`;
    }

    if (rawEntries.length > 0) {
      html += `<div class="reports-detail-section"><div class="reports-detail-section-head"><div class="reports-detail-section-title">Detailed Log</div><div class="reports-section-meta">Audit-ready activity list for the day</div></div><div class="reports-table-shell"><table class="lbd-tbl reports-log-table" style="min-width:760px;"><thead><tr><th class="lbd-tbl-th">Worker</th><th class="lbd-tbl-th">Task</th><th class="lbd-tbl-th">Power Block</th><th class="lbd-tbl-th">LBD Count</th><th class="lbd-tbl-th">Date</th><th class="lbd-tbl-th">Logged By</th></tr></thead><tbody>${rawEntries.map((entry) => `
        <tr class="lbd-tbl-row"><td class="lbd-tbl-name">${_escapeHtml(entry.worker_name || '')}</td><td class="lbd-tbl-td">${_escapeHtml(STATUS_LABELS[entry.task_type] || entry.task_type || '')}</td><td class="lbd-tbl-td">${_escapeHtml(entry.power_block_name || '')}</td><td class="lbd-tbl-td">${_escapeHtml(String(entry.assignment_count || 1))}</td><td class="lbd-tbl-td">${_escapeHtml(entry.work_date || '')}</td><td class="lbd-tbl-td">${_escapeHtml(entry.logged_by || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
    }

    if (!Number(data.total_entries || 0) && scans.length === 0) {
      html += '<div class="reports-empty-copy">No claims were recorded for this day.</div>';
    }

    html += '</div>';
    detailEl.innerHTML = html;
  } catch (e) {
    detailEl.innerHTML = `<p style="color:#ff4c6a;">Error: ${_escapeHtml(e.message)}</p>`;
  }
}

function rp_defaultBackfillTimestamp(dateStr) {
  const date = String(dateStr || rp_selectedDate || todayIsoDate());
  return `${date}T12:00`;
}

async function rp_openBackfillDialog(preferredBlockId = null) {
  if (!currentUserCan('admin_settings')) {
    alert('Only admin users can backfill missing claims.');
    return;
  }

  try {
    const [blocksResponse, peopleResponse] = await Promise.all([
      api.getPowerBlocks(),
      api.getClaimPeople(),
    ]);
    const blocks = Array.isArray(blocksResponse.data) ? blocksResponse.data.slice().sort((left, right) => claimCompareBlocks(left, right, 'number_asc')) : [];
    if (!blocks.length) {
      alert('No power blocks are available for this tracker yet.');
      return;
    }
    const suggestions = _dedupeClaimNames(Array.isArray(peopleResponse.data) ? peopleResponse.data : []);
    claimPageState.peopleSuggestions = suggestions;
    const backfillStatusTypes = claimStatusTypesForCurrentTracker();

    let activeBlock = blocks.find((block) => Number(block.id) === Number(preferredBlockId)) || blocks[0];
    const overlay = document.createElement('div');
    overlay.id = 'claim-people-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(3,8,20,0.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:10px;overflow-y:auto;-webkit-overflow-scrolling:touch;';

    const optionsHtml = suggestions.map(name => {
      const escaped = _escapeHtml(name);
      const checked = currentUser?.name === name ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;background:rgba(255,255,255,0.04);cursor:pointer;min-height:44px;">
        <input type="checkbox" class="claim-person-option" value="${escaped}" ${checked} style="width:20px;height:20px;min-width:20px;" />
        <span style="color:#eef2ff;font-size:14px;">${escaped}</span>
      </label>`;
    }).join('');

    overlay.innerHTML = `
      <div class="reports-backfill-dialog" style="width:min(820px,100%);max-height:90vh;overflow:auto;background:#0f172a;border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,0.45);-webkit-overflow-scrolling:touch;">
        <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;">
          <div>
            <div style="color:#eef2ff;font-size:18px;font-weight:700;">Backfill Missing Claim Activity</div>
            <div style="color:#94a3b8;font-size:12px;margin-top:4px;">This logs the claim on the correct past date and also updates the block's live claim state, tracker view, and map progress.</div>
          </div>
          <button type="button" id="report-backfill-close" style="background:transparent;border:none;color:#94a3b8;font-size:24px;cursor:pointer;padding:4px 8px;">×</button>
        </div>
        <div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
          <div>
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Power Block</label>
            <select id="report-backfill-block" class="reports-backfill-field" style="width:100%;min-height:42px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;">${blocks.map((block) => `<option value="${block.id}"${Number(block.id) === Number(activeBlock.id) ? ' selected' : ''}>${_escapeHtml(block.name)}</option>`).join('')}</select>
          </div>
          <div>
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Claim Date</label>
            <input id="report-backfill-date" class="reports-backfill-field" type="date" value="${_escapeHtml(rp_selectedDate || todayIsoDate())}" style="width:100%;min-height:42px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;" />
          </div>
          <div>
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Claim Time</label>
            <input id="report-backfill-time" class="reports-backfill-field" type="datetime-local" value="${_escapeHtml(rp_defaultBackfillTimestamp(rp_selectedDate || todayIsoDate()))}" style="width:100%;min-height:42px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;" />
          </div>
          <div>
            <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Logged By</label>
            <input id="report-backfill-actor" class="reports-backfill-field" type="text" value="${_escapeHtml(currentUser?.name || '')}" placeholder="Who is entering this backfill" style="width:100%;min-height:42px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;" />
          </div>
        </div>
        <div id="report-backfill-current-claim" style="margin-top:16px;"></div>
        <div style="margin-top:16px;">
          <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Shared crew on this claim</label>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
          ${optionsHtml || '<div style="color:#94a3b8;font-size:12px;">No saved crew suggestions yet.</div>'}
        </div>
        <div style="margin-top:12px;">
          <label style="display:block;color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:6px;">Add extra crew names</label>
          <textarea id="claim-extra-names" class="claim-modal-textarea reports-backfill-field" rows="2" placeholder="Type names separated by commas or new lines" style="width:100%;resize:vertical;font-size:14px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#eef2ff;"></textarea>
        </div>
        <div style="margin-top:16px;">
          <label style="display:block;color:#cbd5e1;font-size:12px;margin-bottom:6px;">Work types</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
            ${backfillStatusTypes.map(statusType => {
              const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
              return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;">
                <input type="checkbox" class="claim-status-type" value="${_escapeHtml(statusType)}" />
                <span style="color:#eef2ff;font-size:12px;">${label}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
        <div style="margin-top:16px;">
          <label style="display:block;color:#cbd5e1;font-size:12px;margin-bottom:6px;">LBD selection by work type</label>
          <div id="claim-assignment-sections"></div>
        </div>
        <div id="report-backfill-review" style="display:none;margin-top:16px;padding:16px;border-radius:14px;border:1px solid rgba(0,212,255,0.16);background:rgba(0,212,255,0.05);">
          <div style="font-size:12px;font-weight:700;color:#8adfff;letter-spacing:0.7px;text-transform:uppercase;">Review Backfill</div>
          <div id="report-backfill-review-content" style="margin-top:12px;"></div>
        </div>
        <div style="position:sticky;bottom:-18px;margin:18px -18px -18px;padding:14px 18px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;background:linear-gradient(180deg, rgba(15,23,42,0.82), rgba(15,23,42,0.98));border-top:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);">
          <button type="button" id="report-backfill-cancel" class="btn btn-secondary" style="min-height:44px;padding:10px 20px;font-size:14px;">Cancel</button>
          <button type="button" id="report-backfill-back" class="btn btn-secondary" style="display:none;min-height:44px;padding:10px 20px;font-size:14px;">Back</button>
          <button type="button" id="report-backfill-review-btn" class="btn btn-primary" style="min-height:44px;padding:10px 20px;font-size:14px;">Review Backfill</button>
          <button type="button" id="report-backfill-submit" class="btn btn-success" style="min-height:44px;padding:10px 20px;font-size:14px;opacity:0.55;" disabled>Save Backfill</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const renderCurrentClaimSummary = () => {
      const target = overlay.querySelector('#report-backfill-current-claim');
      if (!target || !activeBlock) return;
      const assignments = _getClaimAssignments(activeBlock, backfillStatusTypes);
      const claimedPeople = Array.isArray(activeBlock.claimed_people) ? activeBlock.claimed_people.filter(Boolean) : [];
      const claimedLabel = activeBlock.claimed_label || claimedPeople.join(', ') || activeBlock.claimed_by || '';
      const lines = Object.entries(assignments)
        .map(([statusType, ids]) => {
          const count = Array.isArray(ids) ? ids.length : 0;
          if (!count) return '';
          const label = STATUS_LABELS[statusType] || statusType.replace(/_/g, ' ');
          return `<div style="font-size:12px;color:#cbd5e1;">${_escapeHtml(label)}: ${count} already claimed live</div>`;
        })
        .filter(Boolean)
        .join('');
      if (!blockHasClaim(activeBlock)) {
        target.innerHTML = '<div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#94a3b8;font-size:12px;">This block does not have a live claim right now.</div>';
        return;
      }
      target.innerHTML = `
        <div style="padding:12px;border-radius:12px;border:1px solid rgba(250,204,21,0.22);background:rgba(250,204,21,0.08);">
          <div style="font-size:12px;font-weight:700;color:#facc15;letter-spacing:0.6px;text-transform:uppercase;">Current Live Claim</div>
          <div style="margin-top:6px;color:#eef2ff;font-size:13px;">${claimedLabel ? `Crew: ${_escapeHtml(claimedLabel)}` : 'This block already has live claim assignments.'}</div>
          ${lines ? `<div style="margin-top:8px;display:grid;gap:4px;">${lines}</div>` : ''}
        </div>`;
    };
    const renderAssignments = () => {
      renderCurrentClaimSummary();
      _renderClaimAssignmentSections(overlay, activeBlock, suggestions);
    };
    renderAssignments();

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('#report-backfill-close').addEventListener('click', close);
    overlay.querySelector('#report-backfill-cancel').addEventListener('click', close);
    overlay.querySelector('#report-backfill-block').addEventListener('change', (event) => {
      const nextId = Number(event.target.value);
      activeBlock = blocks.find((block) => Number(block.id) === nextId) || blocks[0];
      renderAssignments();
    });
    overlay.querySelector('#report-backfill-date').addEventListener('change', (event) => {
      const nextDate = String(event.target.value || todayIsoDate());
      const timeInput = overlay.querySelector('#report-backfill-time');
      if (timeInput) timeInput.value = rp_defaultBackfillTimestamp(nextDate);
    });
    overlay.querySelectorAll('.claim-status-type').forEach((input) => {
      input.addEventListener('change', renderAssignments);
    });

    const reviewPanel = overlay.querySelector('#report-backfill-review');
    const reviewContent = overlay.querySelector('#report-backfill-review-content');
    const reviewBtn = overlay.querySelector('#report-backfill-review-btn');
    const backBtn = overlay.querySelector('#report-backfill-back');
    const submitBtn = overlay.querySelector('#report-backfill-submit');
    const editorSections = Array.from(overlay.children[0].children).slice(1, -1);

    const buildDraft = () => {
      const sharedPeople = _readSharedClaimCrew(overlay);
      const people = [...sharedPeople];
      const assignments = {};
      const taskCrews = {};
      const workDate = String(overlay.querySelector('#report-backfill-date')?.value || rp_selectedDate || todayIsoDate());
      const claimedAt = String(overlay.querySelector('#report-backfill-time')?.value || rp_defaultBackfillTimestamp(workDate));
      const claimedBy = String(overlay.querySelector('#report-backfill-actor')?.value || currentUser?.name || '').trim();
      Array.from(overlay.querySelectorAll('.claim-status-type:checked')).forEach((input) => {
        const statusType = input.value;
        const lbdIds = Array.from(overlay.querySelectorAll(`.claim-lbd-option[data-status-type="${statusType}"]:checked`))
          .map((option) => Number(option.value))
          .filter(Number.isFinite);
        if (lbdIds.length > 0) {
          assignments[statusType] = lbdIds;
        }
        const taskPeople = _dedupeClaimNames(claimParseCrewNames(overlay.querySelector(`.claim-task-crew[data-status-type="${statusType}"]`)?.value || ''));
        if (taskPeople.length > 0) {
          taskCrews[statusType] = taskPeople;
          people.push(...taskPeople);
        }
      });
      return {
        powerBlockId: activeBlock.id,
        powerBlockName: activeBlock.name,
        people: _dedupeClaimNames(people),
        assignments,
        sharedPeople,
        taskCrews,
        workDate,
        claimedAt,
        claimedBy,
      };
    };

    reviewBtn.addEventListener('click', () => {
      const draft = buildDraft();
      if (!draft.people.length) {
        alert('Choose at least one crew member before reviewing the backfill.');
        return;
      }
      if (!Object.keys(draft.assignments).length) {
        alert('Select at least one task and LBD assignment before reviewing the backfill.');
        return;
      }
      const assignmentRows = Object.entries(draft.assignments).map(([statusType, lbdIds]) => {
        const label = _escapeHtml(STATUS_LABELS[statusType] || statusType.replace(/_/g, ' '));
        const lbdNames = (activeBlock.lbds || [])
          .filter((lbd) => lbdIds.includes(lbd.id))
          .map((lbd) => _escapeHtml(lbd.identifier || lbd.name || `LBD ${lbd.id}`));
        const crewNames = Array.isArray(draft.taskCrews[statusType]) && draft.taskCrews[statusType].length
          ? draft.taskCrews[statusType].map(_escapeHtml).join(', ')
          : (draft.sharedPeople.length ? draft.sharedPeople.map(_escapeHtml).join(', ') : 'No task-specific crew listed');
        return `<div style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
          <div style="font-weight:700;color:#eef2ff;">${label}</div>
          <div style="margin-top:4px;color:#8adfff;font-size:12px;">Crew: ${crewNames}</div>
          <div style="margin-top:4px;color:#94a3b8;font-size:12px;">${lbdNames.length ? lbdNames.join(', ') : 'No specific LBDs selected'}</div>
        </div>`;
      }).join('');

      reviewContent.innerHTML = `
        <div style="display:grid;gap:12px;">
          <div><div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Power Block</div><div style="margin-top:6px;color:#eef2ff;font-size:14px;">${_escapeHtml(draft.powerBlockName)}</div></div>
          <div><div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Claim Date</div><div style="margin-top:6px;color:#eef2ff;font-size:14px;">${_escapeHtml(draft.workDate)}</div></div>
          <div><div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Claim Time</div><div style="margin-top:6px;color:#eef2ff;font-size:14px;">${_escapeHtml(draft.claimedAt)}</div></div>
          <div><div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Crew</div><div style="margin-top:6px;color:#eef2ff;font-size:14px;">${draft.people.map(_escapeHtml).join(', ')}</div></div>
          <div><div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.7px;text-transform:uppercase;">Assignments</div><div style="margin-top:8px;display:grid;gap:8px;">${assignmentRows}</div></div>
        </div>`;

      editorSections.forEach((section) => { section.style.display = 'none'; });
      reviewPanel.style.display = 'block';
      reviewBtn.style.display = 'none';
      backBtn.style.display = 'inline-flex';
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn._draft = draft;
    });

    backBtn.addEventListener('click', () => {
      editorSections.forEach((section) => { section.style.display = ''; });
      reviewPanel.style.display = 'none';
      reviewBtn.style.display = 'inline-flex';
      backBtn.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.55';
    });

    submitBtn.addEventListener('click', async () => {
      const draft = submitBtn._draft || buildDraft();
      const response = await api.backfillClaimActivity({
        power_block_id: draft.powerBlockId,
        tracker_id: currentTracker ? currentTracker.id : undefined,
        people: draft.people,
        assignments: draft.assignments,
        work_date: draft.workDate,
        claimed_at: draft.claimedAt,
        claimed_by: draft.claimedBy,
      });
      const nextClaim = response && response.claim ? response.claim : null;
      if (nextClaim) {
        const selectedId = Number(draft.powerBlockId);
        const patchBlock = (block) => {
          if (!block || Number(block.id) !== selectedId) {
            return block;
          }
          return {
            ...block,
            ...nextClaim,
          };
        };
        claimPageState.blocks = claimPageState.blocks.map(patchBlock);
        mapPBs = mapPBs.map(patchBlock);
        _allBlocksData = _allBlocksData.map(patchBlock);
        if (_blocksCache[selectedId]) {
          _blocksCache[selectedId] = patchBlock(_blocksCache[selectedId]);
        }
        if (pageName === 'claim') {
          renderClaimPage();
        }
        if (activePBId === selectedId) {
          showPBPanel(patchBlock(mapPBs.find((block) => Number(block.id) === selectedId) || claimPageState.blocks.find((block) => Number(block.id) === selectedId) || _blocksCache[selectedId]));
        }
      }
      close();
      await rp_fetchReports(true);
      rp_renderSummary(rp_reportsCache);
      await rp_showDetail(draft.workDate, true, true);
    });
  } catch (e) {
    alert('Backfill error: ' + e.message);
  }
}

// ============================================================
// REVIEW PAGE
// ============================================================
const reviewPageState = {
  blocks: [],
  items: [],
  entries: [],
  reports: [],
  reportDetails: {},
  selectedBlockId: null,
  selectedLbdId: null,
  selectedReportDate: null,
  selectedDate: new Date().toISOString().slice(0, 10),
  search: '',
  zoneFilter: '',
  result: 'fail',
  notes: '',
  loading: false,
  submitting: false,
};

function reviewFormatLbdLabel(lbd) {
  if (!lbd) return 'LBD';
  return lbd.identifier || lbd.name || (lbd.id ? `LBD ${lbd.id}` : 'LBD');
}

function reviewBuildItems(blocks) {
  const items = [];
  (blocks || []).forEach((block) => {
    const lbds = Array.isArray(block.lbds) ? [...block.lbds] : [];
    lbds.sort((left, right) => reviewFormatLbdLabel(left).localeCompare(reviewFormatLbdLabel(right), undefined, { numeric: true, sensitivity: 'base' }));
    lbds.forEach((lbd) => {
      items.push({
        lbd_id: Number(lbd.id),
        power_block_id: Number(block.id),
        power_block_name: block.name || 'Power Block',
        power_block_number: block.power_block_number,
        zone: block.zone || '',
        claimed_label: block.claimed_label || '',
        claimed_by: block.claimed_by || '',
        lbd_name: lbd.name || '',
        lbd_identifier: lbd.identifier || '',
        inventory_number: lbd.inventory_number || '',
        review_target_label: reviewFormatLbdLabel(lbd),
      });
    });
  });
  return items.sort((left, right) => {
    const blockDiff = Number(left.power_block_number || 0) - Number(right.power_block_number || 0);
    if (blockDiff !== 0) return blockDiff;
    return String(left.review_target_label || '').localeCompare(String(right.review_target_label || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

function reviewLatestEntryMap(entries) {
  const latest = new Map();
  (entries || []).forEach((entry) => {
    if (!entry) return;
    const lbdId = Number(entry.lbd_id || 0);
    if (lbdId > 0 && !latest.has(lbdId)) {
      latest.set(lbdId, entry);
    }
  });
  return latest;
}

function reviewSelectedItem() {
  return reviewPageState.items.find(item => Number(item.lbd_id) === Number(reviewPageState.selectedLbdId)) || null;
}

function reviewSelectedBlock() {
  return reviewPageState.blocks.find(block => Number(block.id) === Number(reviewPageState.selectedBlockId)) || null;
}

function reviewItemsForBlock(blockId) {
  return reviewPageState.items.filter(item => Number(item.power_block_id) === Number(blockId));
}

function reviewFilteredBlocks() {
  const query = reviewPageState.search.trim().toLowerCase();
  const zoneFilter = reviewPageState.zoneFilter;
  return reviewPageState.blocks
    .filter((block) => {
      if (zoneFilter && (block.zone || '') !== zoneFilter) return false;
      if (!query) return true;
      const blockTerms = [block.name, block.zone, block.claimed_label, block.claimed_by]
        .filter(Boolean)
        .map(value => String(value).toLowerCase());
      const lbdTerms = (block.lbds || []).flatMap((lbd) => [
        reviewFormatLbdLabel(lbd),
        lbd.name,
        lbd.identifier,
        lbd.inventory_number,
      ]).filter(Boolean).map(value => String(value).toLowerCase());
      return [...blockTerms, ...lbdTerms].some(value => value.includes(query));
    })
    .sort((left, right) => Number(left.power_block_number || 0) - Number(right.power_block_number || 0));
}

function reviewBlockStatusSummary(block, latestMap) {
  const items = reviewItemsForBlock(block.id);
  let passCount = 0;
  let failCount = 0;
  let pendingCount = 0;
  items.forEach((item) => {
    const latest = latestMap.get(Number(item.lbd_id));
    if (!latest) {
      pendingCount += 1;
    } else if (latest.review_result === 'pass') {
      passCount += 1;
    } else {
      failCount += 1;
    }
  });
  return { passCount, failCount, pendingCount, total: items.length };
}

function reviewEnsureSelection(filteredBlocks) {
  if (!filteredBlocks.length) {
    reviewPageState.selectedBlockId = null;
    reviewPageState.selectedLbdId = null;
    return;
  }

  if (!reviewPageState.selectedBlockId || !filteredBlocks.some(block => Number(block.id) === Number(reviewPageState.selectedBlockId))) {
    reviewPageState.selectedBlockId = Number(filteredBlocks[0].id);
  }

  const items = reviewItemsForBlock(reviewPageState.selectedBlockId);
  if (!reviewPageState.selectedLbdId || !items.some(item => Number(item.lbd_id) === Number(reviewPageState.selectedLbdId))) {
    reviewPageState.selectedLbdId = items[0]?.lbd_id || null;
  }
}

function reviewZoneOptions() {
  return Array.from(new Set(reviewPageState.blocks.map(block => String(block.zone || '').trim()).filter(Boolean))).sort();
}

async function reviewLoadReportDetail(dateStr) {
  if (!dateStr) return null;
  if (reviewPageState.reportDetails[dateStr]) return reviewPageState.reportDetails[dateStr];
  const response = await api.getReviewReportByDate(dateStr);
  reviewPageState.reportDetails[dateStr] = response.data || null;
  return reviewPageState.reportDetails[dateStr];
}

async function loadReviewPage() {
  const el = document.getElementById('review-content');
  if (!el || reviewPageState.loading) return;
  reviewPageState.loading = true;
  el.innerHTML = '<div class="form-section" style="padding:18px 20px;color:#94a3b8;">Loading review workflow...</div>';
  try {
    const [blocksResponse, entriesResponse, reportsResponse] = await Promise.all([
      api.getPowerBlocks(),
      api.getReviews(reviewPageState.selectedDate),
      api.getReviewReports(),
    ]);
    reviewPageState.blocks = Array.isArray(blocksResponse.data) ? blocksResponse.data : [];
    reviewPageState.items = reviewBuildItems(reviewPageState.blocks);
    reviewPageState.entries = Array.isArray(entriesResponse.data) ? entriesResponse.data : [];
    reviewPageState.reports = Array.isArray(reportsResponse.data) ? reportsResponse.data : [];
    reviewPageState.reports.sort((a, b) => b.report_date.localeCompare(a.report_date));
    reviewEnsureSelection(reviewFilteredBlocks());
    if (!reviewPageState.selectedReportDate || !reviewPageState.reports.some(report => report.report_date === reviewPageState.selectedReportDate)) {
      reviewPageState.selectedReportDate = reviewPageState.reports[0]?.report_date || null;
    }
    if (reviewPageState.selectedReportDate) {
      await reviewLoadReportDetail(reviewPageState.selectedReportDate);
    }
    renderReviewPage();
  } catch (e) {
    el.innerHTML = `<div class="form-section" style="padding:18px 20px;color:#ff8fa3;">Failed to load review workflow: ${_escapeHtml(e.message)}</div>`;
  } finally {
    reviewPageState.loading = false;
  }
}

function reviewSetSearch(inputOrValue) {
  const isInput = inputOrValue && typeof inputOrValue === 'object' && 'value' in inputOrValue;
  reviewPageState.search = String(isInput ? inputOrValue.value : (inputOrValue || ''));
  renderReviewPage({
    preserveSearchFocus: isInput,
    searchCursor: isInput ? inputOrValue.selectionStart : null,
  });
}

function reviewSetZoneFilter(value) {
  reviewPageState.zoneFilter = String(value || '');
  renderReviewPage();
}

function reviewSelectBlock(blockId) {
  reviewPageState.selectedBlockId = Number(blockId);
  reviewOpenBlockDialog(blockId);
}

function reviewSelectLbd(lbdId) {
  const item = reviewPageState.items.find(candidate => Number(candidate.lbd_id) === Number(lbdId));
  if (item) {
    reviewPageState.selectedBlockId = Number(item.power_block_id);
  }
  reviewPageState.selectedLbdId = Number(lbdId);
  renderReviewPage();
}

function reviewSetResult(result) {
  reviewPageState.result = result === 'pass' ? 'pass' : 'fail';
  renderReviewPage();
}

function reviewSetNotes(value) {
  reviewPageState.notes = String(value || '');
}

async function reviewSetDate(value) {
  reviewPageState.selectedDate = value || new Date().toISOString().slice(0, 10);
  await loadReviewPage();
}

async function reviewSelectReport(dateStr) {
  reviewPageState.selectedReportDate = dateStr;
  await reviewLoadReportDetail(dateStr);
  renderReviewPage();
}

async function reviewGenerateReport() {
  try {
    const payload = { date: reviewPageState.selectedDate };
    if (currentTracker) payload.tracker_id = currentTracker.id;
    const response = await api.generateReviewReport(payload);
    const report = response?.data || null;
    if (report?.report_date) {
      reviewPageState.reportDetails[report.report_date] = report;
      const summary = {
        id: report.id,
        report_date: report.report_date,
        generated_at: report.generated_at,
        total_reviews: report.data?.total_reviews || 0,
        pass_count: report.data?.pass_count || 0,
        fail_count: report.data?.fail_count || 0,
        reviewers: Array.isArray(report.data?.reviewer_names) ? report.data.reviewer_names : [],
        failed_blocks: Array.isArray(report.data?.failed_blocks) ? report.data.failed_blocks : [],
      };
      reviewPageState.reports = [
        summary,
        ...reviewPageState.reports.filter((item) => item.report_date !== report.report_date),
      ].sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')));
      reviewPageState.selectedReportDate = report.report_date;
      renderReviewPage();
    }
    await loadReviewPage();
  } catch (e) {
    alert('Review report generation failed: ' + e.message);
  }
}

function reviewDialogStatusCounts(block) {
  const latestMap = reviewLatestEntryMap(reviewPageState.entries);
  const items = reviewItemsForBlock(block.id);
  const counts = { all: items.length, pending: 0, pass: 0, fail: 0 };
  items.forEach((item) => {
    const status = latestMap.get(Number(item.lbd_id))?.review_result || 'pending';
    if (status === 'pass') counts.pass += 1;
    else if (status === 'fail') counts.fail += 1;
    else counts.pending += 1;
  });
  return counts;
}

function reviewFilterDialogItems(block, selectedIds, activeView) {
  const latestMap = reviewLatestEntryMap(reviewPageState.entries);
  const items = reviewItemsForBlock(block.id).slice().sort((left, right) => String(left.review_target_label || left.inventory_number || left.lbd_id)
    .localeCompare(String(right.review_target_label || right.inventory_number || right.lbd_id)));

  return items.filter((item) => {
    const status = latestMap.get(Number(item.lbd_id))?.review_result || 'pending';
    if (activeView === 'selected') return selectedIds.has(item.lbd_id);
    if (activeView === 'pending') return status !== 'pass' && status !== 'fail';
    if (activeView === 'pass') return status === 'pass';
    if (activeView === 'fail') return status === 'fail';
    return true;
  });
}

function reviewRenderDialogViewFilters(overlay, block, selectedIds, activeView, statusOverrides) {
  const filtersEl = overlay.querySelector('#review-view-filters');
  if (!filtersEl) return;
  const baseCounts = reviewDialogStatusCounts(block);
  const counts = { ...baseCounts };
  if (statusOverrides instanceof Map) {
    counts.pending = 0;
    counts.pass = 0;
    counts.fail = 0;
    reviewItemsForBlock(block.id).forEach((item) => {
      const status = statusOverrides.get(Number(item.lbd_id)) || reviewLatestEntryMap(reviewPageState.entries).get(Number(item.lbd_id))?.review_result || 'pending';
      if (status === 'pass') counts.pass += 1;
      else if (status === 'fail') counts.fail += 1;
      else counts.pending += 1;
    });
  }
  const items = [
    { key: 'selected', label: `Selected (${selectedIds.size})` },
    { key: 'pending', label: `Pending (${counts.pending})` },
    { key: 'fail', label: `Fail (${counts.fail})` },
    { key: 'pass', label: `Pass (${counts.pass})` },
    { key: 'all', label: `All (${counts.all})` },
  ];
  filtersEl.innerHTML = items.map((item) => `
    <button
      type="button"
      class="btn ${activeView === item.key ? 'btn-success' : 'btn-secondary'} review-view-filter"
      data-view="${item.key}"
      style="min-width:110px;"
    >${item.label}</button>
  `).join('');
}

function reviewRenderBlockDialogList(overlay, block, selectedIds, activeView, statusOverrides) {
  const list = overlay.querySelector('#review-bulk-list');
  if (!list) return;
  const items = reviewDialogVisibleItems(block, selectedIds, activeView, statusOverrides);
  const latestMap = reviewLatestEntryMap(reviewPageState.entries);
  list.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:700;color:#eef2ff;">LBD selection for this power block</div>
      <div style="font-size:12px;color:rgba(238,242,255,0.72);">${selectedIds.size} selected</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px;align-items:stretch;">
      ${items.map((item) => {
        const latest = latestMap.get(Number(item.lbd_id));
        const current = statusOverrides instanceof Map
          ? (statusOverrides.get(Number(item.lbd_id)) || latest?.review_result || '')
          : (latest?.review_result || '');
        const statusLabel = current === 'pass' ? 'Passed' : current === 'fail' ? 'Failed' : 'Pending';
        const statusTone = current === 'pass'
          ? 'color:#7df0b3;background:rgba(52,199,89,0.18);border:1px solid rgba(52,199,89,0.34);'
          : current === 'fail'
            ? 'color:#ffd36a;background:rgba(255,154,74,0.18);border:1px solid rgba(255,154,74,0.34);'
            : 'color:#8adfff;background:rgba(0,212,255,0.14);border:1px solid rgba(0,212,255,0.24);';
        const isSelected = selectedIds.has(item.lbd_id);
        const cardTone = current === 'pass'
          ? 'box-shadow:inset 0 0 0 1px rgba(52,199,89,0.28);'
          : current === 'fail'
            ? 'box-shadow:inset 0 0 0 1px rgba(255,154,74,0.28);'
            : '';
        return `<label style="display:flex;gap:10px;align-items:flex-start;min-height:96px;padding:12px;border-radius:16px;border:1px solid ${isSelected ? 'rgba(138,223,255,0.28)' : 'rgba(255,255,255,0.08)'};background:${isSelected ? 'rgba(138,223,255,0.08)' : 'rgba(255,255,255,0.04)'};${cardTone}cursor:pointer;box-sizing:border-box;">
          <input type="checkbox" class="review-bulk-check" data-lbd-id="${item.lbd_id}" ${isSelected ? 'checked' : ''} style="margin-top:3px;accent-color:#00d4ff;flex:0 0 auto;">
          <div style="min-width:0;flex:1;display:grid;gap:8px;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
              <strong style="color:#eef2ff;font-size:14px;line-height:1.25;">${_escapeHtml(item.review_target_label || 'LBD')}</strong>
              <span style="${statusTone}font-size:10px;font-weight:800;padding:4px 8px;border-radius:999px;white-space:nowrap;">${statusLabel}</span>
            </div>
            <div style="font-size:11px;color:#8adfff;font-weight:700;">${item.inventory_number ? _escapeHtml(item.inventory_number) : `LBD ${_escapeHtml(item.lbd_id)}`}</div>
            <div style="font-size:11px;color:rgba(238,242,255,0.56);line-height:1.3;">${latest ? `${_escapeHtml(latest.reviewed_by || 'Unknown')} • ${rp_formatDate(latest.review_date, { month: 'short', day: 'numeric' })}` : 'Not reviewed for this date'}</div>
          </div>
        </label>`;
      }).join('') || `<div class="claim-muted-copy" style="grid-column:1 / -1;">No LBDs in the ${_escapeHtml(activeView)} view.</div>`}
    </div>`;
}

function reviewDialogVisibleItems(block, selectedIds, activeView, statusOverrides) {
  const latestMap = reviewLatestEntryMap(reviewPageState.entries);
  return reviewFilterDialogItems(block, selectedIds, activeView).filter((item) => {
    const status = statusOverrides instanceof Map
      ? (statusOverrides.get(Number(item.lbd_id)) || latestMap.get(Number(item.lbd_id))?.review_result || 'pending')
      : (latestMap.get(Number(item.lbd_id))?.review_result || 'pending');
    if (activeView === 'selected') return selectedIds.has(item.lbd_id);
    if (activeView === 'pending') return status !== 'pass' && status !== 'fail';
    if (activeView === 'pass') return status === 'pass';
    if (activeView === 'fail') return status === 'fail';
    return true;
  });
}

async function reviewOpenBlockDialog(blockId) {
  const block = reviewPageState.blocks.find(item => Number(item.id) === Number(blockId));
  if (!block) return;

  const existing = document.getElementById('review-bulk-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'review-bulk-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(3,8,20,0.72);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:10px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  const summary = reviewBlockStatusSummary(block, reviewLatestEntryMap(reviewPageState.entries));
  overlay.innerHTML = `
    <div style="width:min(920px,100%);margin:20px auto;background:linear-gradient(180deg,rgba(11,19,34,0.96),rgba(8,14,26,0.98));border:1px solid rgba(255,255,255,0.08);border-radius:22px;box-shadow:0 24px 80px rgba(0,0,0,0.45);overflow:hidden;">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:20px 22px 14px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div>
          <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#8adfff;">Review Power Block</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:#eef2ff;">${_escapeHtml(block.name || 'Power Block')}</div>
          <div style="margin-top:6px;font-size:13px;color:rgba(238,242,255,0.66);">PB ${_escapeHtml(block.power_block_number || '')} • ${_escapeHtml(block.zone || 'Unzoned')} • ${summary.total} ${getPowerBlockCountLabel(summary.total)}</div>
        </div>
        <button id="review-bulk-close" type="button" style="border:none;background:rgba(255,255,255,0.08);color:#eef2ff;width:40px;height:40px;border-radius:999px;font-size:18px;cursor:pointer;">&times;</button>
      </div>
      <div style="padding:18px 22px;display:grid;gap:16px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <button type="button" id="review-select-all" class="btn btn-secondary">Select All</button>
          <button type="button" id="review-clear-selection" class="btn btn-secondary">Clear</button>
          <button type="button" id="review-apply-pass" class="btn btn-success">Pass Selected</button>
          <button type="button" id="review-apply-fail" class="btn btn-danger">Fail Selected</button>
          <div id="review-selection-status" style="margin-left:auto;font-size:12px;color:rgba(238,242,255,0.66);"></div>
        </div>
        <div id="review-view-filters" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
        <textarea id="review-bulk-notes" class="claim-modal-textarea" rows="3" placeholder="Optional notes for the drafted review changes" style="width:100%;resize:vertical;">${_escapeHtml(reviewPageState.notes || '')}</textarea>
        <div id="review-bulk-list" style="max-height:min(62vh,560px);overflow:auto;padding-right:4px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center;padding-top:4px;">
          <button type="button" id="review-bulk-cancel" class="btn btn-secondary">Cancel</button>
          <button type="button" id="review-bulk-done" class="btn btn-success">Done</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const selectedIds = new Set();
  const notesEl = overlay.querySelector('#review-bulk-notes');
  const selectionStatus = overlay.querySelector('#review-selection-status');
  const localResults = new Map();
  let activeView = 'pending';
  let applying = false;

  const setButtonState = () => {
    const passBtn = overlay.querySelector('#review-apply-pass');
    const failBtn = overlay.querySelector('#review-apply-fail');
    const doneBtn = overlay.querySelector('#review-bulk-done');
    if (passBtn) {
      passBtn.disabled = applying || !selectedIds.size;
      passBtn.textContent = 'Pass Selected';
    }
    if (failBtn) {
      failBtn.disabled = applying || !selectedIds.size;
      failBtn.textContent = 'Fail Selected';
    }
    if (doneBtn) {
      doneBtn.disabled = applying;
      doneBtn.textContent = applying ? 'Saving...' : 'Done';
    }
  };

  const refresh = () => {
    reviewRenderDialogViewFilters(overlay, block, selectedIds, activeView, localResults);
    reviewRenderBlockDialogList(overlay, block, selectedIds, activeView, localResults);
    if (selectionStatus) {
      selectionStatus.textContent = `${selectedIds.size} selected • ${activeView} view`;
    }
    setButtonState();
    overlay.querySelectorAll('.review-view-filter').forEach((button) => {
      button.addEventListener('click', () => {
        activeView = button.getAttribute('data-view') || 'all';
        refresh();
      });
    });
    overlay.querySelectorAll('.review-bulk-check').forEach((input) => {
      input.addEventListener('change', () => {
        const lbdId = Number(input.getAttribute('data-lbd-id') || 0);
        if (input.checked) selectedIds.add(lbdId);
        else selectedIds.delete(lbdId);
        refresh();
      });
    });
  };

  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('#review-bulk-close')?.addEventListener('click', close);
  overlay.querySelector('#review-bulk-cancel')?.addEventListener('click', close);
  overlay.querySelector('#review-select-all')?.addEventListener('click', () => {
    selectedIds.clear();
    reviewDialogVisibleItems(block, selectedIds, activeView, localResults).forEach((item) => selectedIds.add(item.lbd_id));
    refresh();
  });
  overlay.querySelector('#review-clear-selection')?.addEventListener('click', () => {
    selectedIds.clear();
    refresh();
  });

  const applySelected = async (reviewResult) => {
    const targetIds = Array.from(selectedIds);
    if (!targetIds.length) {
      alert('Select at least one LBD first.');
      return;
    }
    targetIds.forEach((lbdId) => localResults.set(Number(lbdId), reviewResult));
    targetIds.forEach((lbdId) => selectedIds.delete(lbdId));
    refresh();
  };
  overlay.querySelector('#review-apply-pass')?.addEventListener('click', () => applySelected('pass'));
  overlay.querySelector('#review-apply-fail')?.addEventListener('click', () => applySelected('fail'));
  overlay.querySelector('#review-bulk-done')?.addEventListener('click', async () => {
    if (!localResults.size) {
      close();
      return;
    }
    applying = true;
    refresh();
    try {
      const response = await api.submitBulkReviews({
        reviews: Array.from(localResults.entries()).map(([lbdId, reviewResult]) => ({
          lbd_id: Number(lbdId),
          review_result: reviewResult,
        })),
        review_date: reviewPageState.selectedDate,
        tracker_id: currentTracker ? currentTracker.id : null,
        notes: notesEl ? notesEl.value : '',
      });
      const savedEntries = Array.isArray(response?.data) ? response.data : [];
      if (savedEntries.length) {
        const savedIds = new Set(savedEntries.map((entry) => Number(entry.lbd_id)));
        reviewPageState.entries = [
          ...savedEntries,
          ...reviewPageState.entries.filter((entry) => !savedIds.has(Number(entry.lbd_id))),
        ];
        renderReviewPage();
      }
      localResults.clear();
      await loadReviewPage();
      close();
    } catch (error) {
      alert('Review save failed: ' + error.message);
      applying = false;
      refresh();
    }
  });
  refresh();
}

function renderReviewPage(options = {}) {
  const el = document.getElementById('review-content');
  if (!el) return;

  const filteredBlocks = reviewFilteredBlocks();
  const latestMap = reviewLatestEntryMap(reviewPageState.entries);
  const latestEntries = Array.from(latestMap.values());
  const failingItems = latestEntries.filter(entry => entry.review_result === 'fail');
  const reviewReports = reviewPageState.reports;
  const selectedReport = reviewPageState.selectedReportDate ? reviewPageState.reportDetails[reviewPageState.selectedReportDate] : null;
  const zoneOptions = reviewZoneOptions();

  const summaryCard = (label, value, meta, toneClass = '') => `
    <article class="claim-summary-card ${toneClass}">
      <div class="claim-summary-label">${label}</div>
      <div class="claim-summary-value">${value}</div>
      <div class="claim-summary-meta">${meta}</div>
    </article>`;

  const blockTiles = filteredBlocks.map((block) => {
    const summary = reviewBlockStatusSummary(block, latestMap);
    let statusTone = 'review-status-pending';
    let statusLabel = `${summary.pendingCount} pending`;
    if (summary.failCount > 0) {
      statusTone = 'review-status-fail';
      statusLabel = `${summary.failCount} failed • ${summary.passCount} passed`;
    } else if (summary.total > 0 && summary.passCount === summary.total) {
      statusTone = 'review-status-pass';
      statusLabel = `${summary.passCount} passed`;
    } else if (summary.passCount > 0) {
      statusTone = 'review-status-pass';
      statusLabel = `${summary.passCount} passed • ${summary.pendingCount} pending`;
    }
    return `<button type="button" class="claim-block-tile" onclick="reviewSelectBlock(${block.id})">
      <div class="claim-block-tile-top">
        <span class="claim-block-name">${_escapeHtml(block.name || 'Power Block')}</span>
        <span class="claim-block-zone">PB ${_escapeHtml(block.power_block_number || '')}</span>
      </div>
      <div class="claim-block-status ${statusTone}">${statusLabel}</div>
      <div class="claim-block-meta-row">
        <span class="claim-block-count">${summary.total} ${getPowerBlockCountLabel(summary.total)}</span>
        <span class="claim-block-progress">${_escapeHtml(block.zone || 'Unzoned')}</span>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:flex-end;">
        <span style="font-size:11px;font-weight:700;color:#8adfff;">Open Review</span>
      </div>
    </button>`;
  }).join('');
  const entryRows = reviewPageState.entries.slice(0, 14).map((entry) => `
    <div class="review-entry-row">
      <div>
        <strong>${_escapeHtml(entry.review_target_label || entry.lbd_identifier || entry.lbd_name || 'LBD')}</strong>
        <div class="review-entry-meta">${_escapeHtml(entry.power_block_name || 'Power Block')}</div>
      </div>
      <div>
        <div class="review-entry-meta">${_escapeHtml(entry.reviewed_by || 'Unknown')} • ${_escapeHtml(entry.review_result || 'pending')}</div>
        <div class="review-entry-notes">${_escapeHtml(entry.notes || 'No notes')}</div>
      </div>
    </div>`).join('');

  const reportList = reviewReports.map((report) => {
    const isActive = report.report_date === reviewPageState.selectedReportDate;
    return `<button type="button" class="reports-list-card${isActive ? ' active' : ''}" onclick="reviewSelectReport('${report.report_date}')">
      <div class="reports-list-card-main">
        <div class="reports-list-card-date">${rp_formatDate(report.report_date)}</div>
        <div class="reports-list-card-meta">${report.total_reviews || 0} reviews • ${report.fail_count || 0} LBDs need fixes • ${Array.isArray(report.reviewers) ? report.reviewers.length : 0} reviewers</div>
      </div>
    </button>`;
  }).join('');

  const selectedReportData = selectedReport?.data || {};
  const failedCards = (selectedReportData.failed_lbds || selectedReportData.failed_blocks || []).map((entry) => `
    <article class="review-fail-card">
      <div class="review-fail-title">${_escapeHtml(entry.review_target_label || entry.lbd_identifier || entry.lbd_name || 'LBD')}</div>
      <div class="review-fail-meta">${_escapeHtml(entry.power_block_name || 'Power Block')}</div>
      <div class="review-fail-meta">Last review: ${_escapeHtml(entry.reviewed_by || 'Unknown')} • ${_escapeHtml(entry.review_result || 'fail')}</div>
      <div class="review-fail-notes">${_escapeHtml(entry.notes || 'No notes captured')}</div>
    </article>`).join('');
  const reviewerGroups = Object.entries(selectedReportData.by_reviewer || {}).map(([reviewer, groups]) => {
    const passed = Array.isArray(groups.pass) ? groups.pass.join(', ') : '';
    const failed = Array.isArray(groups.fail) ? groups.fail.join(', ') : '';
    return `<div class="reports-line-card">
      <div class="reports-line-card-title">${_escapeHtml(reviewer)}</div>
      <div class="reports-line-item"><span class="reports-line-label">Pass:</span><span class="reports-line-copy">${_escapeHtml(passed || 'None')}</span></div>
      <div class="reports-line-item"><span class="reports-line-label">Fail:</span><span class="reports-line-copy">${_escapeHtml(failed || 'None')}</span></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="claim-shell">
      <section class="claim-hero">
        <div class="claim-hero-copy">
          <div class="claim-kicker">Quality Review</div>
          <div class="claim-hero-title">Admin-only pass/fail checks for the active tracker</div>
          <div class="claim-hero-subtitle">Run quality walks separately from claiming. Pass keeps the block clear. Fail keeps it on the review report until it is checked again and passed.</div>
        </div>
        <div class="claim-summary-grid">
          ${summaryCard('Blocks', reviewPageState.blocks.length, 'Power blocks available for review', 'claim-tone-neutral')}
          ${summaryCard('Review LBDs', reviewPageState.items.length, 'Individual LBDs available for review', 'claim-tone-cyan')}
          ${summaryCard('Need Fixes', failingItems.length, 'LBDs currently failing on the selected date', 'claim-tone-amber')}
          ${summaryCard('Review Reports', reviewReports.length, 'Generated review snapshots on record', 'claim-tone-emerald')}
        </div>
      </section>

      <section class="claim-filter-shell">
        <div class="claim-search-wrap">
          <input id="review-search-input" class="claim-search-input" type="text" value="${_escapeHtml(reviewPageState.search)}" oninput="reviewSetSearch(this)" placeholder="Search blocks, zones, or claimed crew" />
        </div>
        <div class="claim-filter-group">
          <span class="claim-filter-label">Zone</span>
          <select class="claim-filter-select" onchange="reviewSetZoneFilter(this.value)">
            <option value="">All Zones</option>
            ${zoneOptions.map((zone) => `<option value="${_escapeHtml(zone)}"${reviewPageState.zoneFilter === zone ? ' selected' : ''}>${_escapeHtml(zone)}</option>`).join('')}
          </select>
        </div>
        <div class="claim-filter-group">
          <span class="claim-filter-label">Review Date</span>
          <input class="claim-filter-select" type="date" value="${_escapeHtml(reviewPageState.selectedDate)}" onchange="reviewSetDate(this.value)" />
        </div>
        <div class="claim-filter-actions">
          <button class="btn btn-secondary" onclick="loadReviewPage()">Refresh</button>
          <button class="reports-generate-btn" onclick="reviewGenerateReport()">Generate Review Report</button>
        </div>
      </section>

      <div class="claim-workspace">
        <section class="claim-blocks-panel">
          <div class="claim-panel-head">
            <div>
              <div class="claim-panel-kicker">Review Power Blocks</div>
              <div class="claim-panel-subtitle">Open a popup for a power block, select multiple LBDs, then bulk apply pass or fail.</div>
            </div>
            <div class="claim-panel-count">${filteredBlocks.length} shown</div>
          </div>
          <div class="claim-block-list">${blockTiles || '<div class="claim-empty-state"><strong>No power blocks match the current filter.</strong><span>Try a different zone or search term.</span></div>'}</div>
        </section>

        <aside class="claim-detail-panel">
          <div class="claim-info-card">
            <div class="claim-card-label">Bulk Review</div>
            <div class="claim-card-value">Popup workflow</div>
            <div class="claim-card-meta">Open a power block to review its full LBD list in one modal instead of scrolling the page.</div>
          </div>
          <div class="claim-info-card">
            <div class="claim-card-label">Fast Actions</div>
            <div class="claim-card-meta">Inside the popup you can:</div>
            <div class="claim-card-copy" style="margin-top:8px;">1. Select all LBDs</div>
            <div class="claim-card-copy">2. Apply pass to the full selection</div>
            <div class="claim-card-copy">3. Uncheck or reselect one LBD</div>
            <div class="claim-card-copy">4. Apply fail to just that item</div>
            <div class="claim-card-copy">5. Save all drafted review changes together</div>
          </div>
          <div class="claim-info-card">
            <div class="claim-card-label">Recent Activity</div>
            <div class="review-entry-list">${entryRows || '<div class="claim-muted-copy">No reviews logged for the selected date yet.</div>'}</div>
          </div>
        </aside>
      </div>

      <section class="reports-shell review-report-shell">
        <div class="reports-toolbar">
          <div class="reports-toolbar-tabs">
            <button class="reports-tab-btn active" type="button">Review Reports</button>
          </div>
        </div>
        <div class="reports-list-layout">
          <div class="reports-list-panel">${reportList || '<div class="reports-empty-copy">Generate a review report to snapshot the day.</div>'}</div>
          <div class="reports-detail-shell">
            ${selectedReport ? `
              <div class="reports-detail-card">
                <div class="reports-detail-head">
                  <div>
                    <div class="reports-detail-kicker">Review Report</div>
                    <h3 class="reports-detail-title">${rp_formatDate(selectedReport.report_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3>
                  </div>
                  <div class="reports-detail-stat-row">
                    <div class="reports-detail-stat"><span>${selectedReportData.total_reviews || 0}</span><small>Reviews</small></div>
                    <div class="reports-detail-stat"><span>${selectedReportData.pass_count || 0}</span><small>Pass</small></div>
                    <div class="reports-detail-stat"><span>${selectedReportData.fail_count || 0}</span><small>Fail</small></div>
                    <div class="reports-detail-stat"><span>${(selectedReportData.reviewer_names || []).length}</span><small>Reviewers</small></div>
                  </div>
                </div>
                <div class="reports-detail-section">
                  <div class="reports-detail-section-title">LBDs That Need Fixes</div>
                  <div class="review-fail-grid">${failedCards || '<div class="reports-empty-copy">No failed LBDs in this report.</div>'}</div>
                </div>
                <div class="reports-detail-section">
                  <div class="reports-detail-section-title">By Reviewer</div>
                  <div class="reports-detail-stack">${reviewerGroups || '<div class="reports-empty-copy">No reviewer activity captured.</div>'}</div>
                </div>
              </div>` : '<div class="reports-empty-copy">Select a review report to inspect failed blocks.</div>'}
          </div>
        </div>
      </section>
    </div>`;
  
  if (options.preserveSearchFocus) {
    const searchInput = document.getElementById('review-search-input');
    if (searchInput) {
      const cursor = typeof options.searchCursor === 'number' ? options.searchCursor : searchInput.value.length;
      requestAnimationFrame(() => {
        searchInput.focus();
        searchInput.setSelectionRange(cursor, cursor);
      });
    }
  }
}


// Keyboard shortcuts
document.addEventListener('DOMContentLoaded', () => {
  // Initialize tab state for login modal
  const submitBtn = document.getElementById('login-submit-btn');
  if (submitBtn) submitBtn._mode = 'signin';
  assignSessionCrown();
  primeLoginLogoAnimation();
  resetLoginLogoAnimation();
  setAppShellVisible(false);

  checkAuth().then(() => {
    // If nobody logged in, show the login overlay automatically
    if (!currentUser) {
      showLoginModal();
      return;
    }
    hideLoginModal();
    setAppShellVisible(true);
    loadAdminSettings().then(() => loadDashboard());
  });
});

// ============================================================
// ADMIN PAGE
// ============================================================
async function loadAdminPage() {
  syncAdminTabVisibility();
  switchAdminTab(adminDefaultTabKey());
  try {
    const r = await api.getAdminSettings();
    const d = r.data;
    adminSettings = d;
    const adminCols = (d.all_columns && d.all_columns.length) ? d.all_columns : LBD_STATUS_TYPES;
    renderAdminColorRows(d.colors || {}, adminCols, d.names || {});
    renderAdminNameRows(d.names || {}, adminCols);
    renderAdminColumnsList(d.custom_columns || []);
    const fs = d.pb_label_font_size || 14;
    const slider = document.getElementById('admin-font-size');
    const display = document.getElementById('admin-font-size-display');
    if (slider) { slider.value = fs; }
    if (display) { display.textContent = fs + 'px'; }
    updateFontSizePreview(fs);
  } catch(e) { showAdminAlert('Failed to load admin settings: ' + e.message, 'error'); }
}

function switchAdminTab(tabKey) {
  if (!adminTabVisible(tabKey)) return;
  document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
  const content = document.getElementById('admin-tab-' + tabKey);
  if (content) content.style.display = 'block';
  const btn = document.getElementById('atab-' + tabKey);
  if (btn) btn.classList.add('active');
  if (tabKey === 'updates') loadUpdateTab();
  if (tabKey === 'users') loadUsersTab();
  if (tabKey === 'trackers') loadTrackersTab();
  if (tabKey === 'maplabels') loadMapLabelsTab();
  if (tabKey === 'zones') loadZonesTab();
  if (tabKey === 'claimcrew') loadClaimCrewTab();
  if (tabKey === 'claimhistory') loadClaimHistoryTab();
  if (tabKey === 'lbddata') adminLoadLbdStats();
  if (tabKey === 'appearance') loadAppearanceTab();
  if (tabKey === 'uilabels') loadUILabelsTab();
  if (tabKey === 'audit') loadAuditLogsTab();
}

function loadClaimCrewTab() {
  const claimPeople = Array.isArray(adminSettings?.claim_people) ? adminSettings.claim_people : [];
  adminSetClaimCrew(claimPeople);
}

function loadClaimHistoryTab() {
  const trackerCopy = document.getElementById('admin-claimhistory-tracker-copy');
  if (!trackerCopy) return;
  if (currentTracker) {
    trackerCopy.textContent = `Active tracker: ${getTrackerDisplayName(currentTracker)}. Historical claims will be added against this tracker.`;
    return;
  }
  trackerCopy.textContent = 'Choose a tracker in the header first, then open the historical claim backfill dialog.';
}

function formatAdminAuditTimestamp(value) {
  if (!value) return 'Unknown time';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function summarizeAdminAuditItem(item) {
  const details = item.details || {};
  const targetId = item.target_id ? ` #${item.target_id}` : '';

  if (item.action === 'user.pin.reset') {
    const resetBy = details.reset_by || item.actor_name || 'Admin';
    return {
      title: 'PIN reset',
      meta: `${resetBy} reset the sign-in PIN for user${targetId}`,
      detail: 'The user can sign in with the new 4-digit PIN on the next attempt.',
    };
  }

  if (item.action === 'user.create') {
    return {
      title: 'User created',
      meta: `${item.actor_name} created user${targetId}`,
      detail: details.job_site_name ? `Site access: ${details.job_site_name}` : '',
    };
  }

  if (item.action === 'user.role.update') {
    const roleLabel = formatRoleLabel(details.role);
    const perms = Array.isArray(details.permissions) && details.permissions.length
      ? `Permissions: ${details.permissions.join(', ')}`
      : '';
    return {
      title: 'Role updated',
      meta: `${item.actor_name} changed user${targetId} to ${roleLabel}`,
      detail: perms,
    };
  }

  return {
    title: item.action,
    meta: `${item.actor_name}${item.target_type ? ` • ${item.target_type}` : ''}${targetId}`,
    detail: item.details && Object.keys(item.details).length ? JSON.stringify(item.details) : '',
  };
}

function buildRecentPinResetMap(items) {
  const recentResets = new Map();
  (items || []).forEach(item => {
    if (item.action !== 'user.pin.reset') return;
    const key = String(item.target_id || '');
    if (!key || recentResets.has(key)) return;
    recentResets.set(key, item);
  });
  return recentResets;
}

async function loadAuditLogsTab() {
  const container = document.getElementById('admin-audit-log-list');
  if (!container) return;
  container.innerHTML = '<div style="color:rgba(238,242,255,0.45);padding:18px 0;">Loading activity…</div>';
  try {
    const r = await api.getAuditLogs(120);
    const items = r.data || [];
    if (!items.length) {
      container.innerHTML = '<div style="color:rgba(238,242,255,0.45);padding:18px 0;">No activity logged yet.</div>';
      return;
    }
    container.innerHTML = items.map(item => {
      const when = formatAdminAuditTimestamp(item.created_at);
      const summary = summarizeAdminAuditItem(item);
      return `
        <div style="padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(8,12,28,0.72);margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div>
              <div style="font-weight:700;color:#eef2ff;">${_escapeHtml(summary.title)}</div>
              <div style="font-size:12px;color:#9aa6c7;">${_escapeHtml(summary.meta)}</div>
            </div>
            <div style="font-size:12px;color:#7f8cb2;white-space:nowrap;">${when}</div>
          </div>
          ${summary.detail ? `<div style="margin-top:8px;font-size:12px;color:#aeb8d6;word-break:break-word;">${_escapeHtml(summary.detail)}</div>` : ''}
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:#ff8aa0;padding:18px 0;">Failed to load activity: ${e.message}</div>`;
  }
}

/* ── Appearance Admin Tab ── */
function loadAppearanceTab() {
  const a = (adminSettings && adminSettings.appearance) ? adminSettings.appearance : {};
  const setVal = (id, val, fallback) => { const e = document.getElementById(id); if (e) e.value = (val !== undefined && val !== '') ? val : fallback; };
  setVal('ap-brand-word1', a.brand_word1, 'PRINCESS');
  setVal('ap-brand-sep',   a.brand_sep,   '◈');
  setVal('ap-brand-word2', a.brand_word2, 'TRACKERS');
  setVal('ap-login-title',    a.login_title,    'Princess Trackers');
  setVal('ap-login-subtitle', a.login_subtitle, 'Sign in to check off your work');
  setVal('ap-login-btn',      a.login_btn,      'Sign In');
  setVal('ap-color-cyan',   a.color_cyan,   '#00d4ff');
  setVal('ap-color-purple', a.color_purple, '#7c6cfc');
  setVal('ap-color-green',  a.color_green,  '#00e87a');
  setVal('ap-color-red',    a.color_red,    '#ff4c6a');
  setVal('ap-color-bg',     a.color_bg,     '#03040a');
  setVal('ap-pb-number-color', a.pb_number_color, '#ffffff');
  setVal('ap-pb-number-active-color', a.pb_number_active_color, '#ffffff');
  setVal('ap-pb-number-outline-color', a.pb_number_outline_color, '#000000');
  const appearanceSwatches = [
    ['ap-color-cyan', 'ap-color-cyan-hex'],
    ['ap-color-purple', 'ap-color-purple-hex'],
    ['ap-color-green', 'ap-color-green-hex'],
    ['ap-color-red', 'ap-color-red-hex'],
    ['ap-color-bg', 'ap-color-bg-hex'],
    ['ap-pb-number-color', 'ap-pb-number-color-hex'],
    ['ap-pb-number-active-color', 'ap-pb-number-active-color-hex'],
    ['ap-pb-number-outline-color', 'ap-pb-number-outline-color-hex'],
  ];
  appearanceSwatches.forEach(([inputId, hexId]) => {
    const input = document.getElementById(inputId);
    const hex = document.getElementById(hexId);
    if (input && hex) hex.textContent = input.value;
  });
  document.getElementById('appearance-save-status').textContent = '';
}

async function saveAdminAppearance() {
  const g = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const appearance = {
    brand_word1:     g('ap-brand-word1'),
    brand_sep:       g('ap-brand-sep'),
    brand_word2:     g('ap-brand-word2'),
    login_title:     g('ap-login-title'),
    login_subtitle:  g('ap-login-subtitle'),
    login_btn:       g('ap-login-btn'),
    color_cyan:      g('ap-color-cyan'),
    color_purple:    g('ap-color-purple'),
    color_green:     g('ap-color-green'),
    color_red:       g('ap-color-red'),
    color_bg:        g('ap-color-bg'),
    pb_number_color: g('ap-pb-number-color'),
    pb_number_active_color: g('ap-pb-number-active-color'),
    pb_number_outline_color: g('ap-pb-number-outline-color'),
  };
  try {
    await api.saveAppearance(appearance);
    if (adminSettings) adminSettings.appearance = appearance;
    applyAppearance(appearance);
    const st = document.getElementById('appearance-save-status');
    if (st) { st.textContent = '✓ Saved'; setTimeout(() => { st.textContent = ''; }, 2500); }
  } catch(e) { showAdminAlert('Failed to save appearance: ' + e.message, 'error'); }
}

function resetAdminAppearance() {
  const defaults = { brand_word1:'PRINCESS', brand_sep:'◈', brand_word2:'TRACKERS',
    login_title:'Princess Trackers', login_subtitle:'Sign in to check off your work', login_btn:'Sign In',
    color_cyan:'#00d4ff', color_purple:'#7c6cfc', color_green:'#00e87a', color_red:'#ff4c6a', color_bg:'#03040a',
    pb_number_color:'#ffffff', pb_number_active_color:'#ffffff', pb_number_outline_color:'#000000' };
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };
  set('ap-brand-word1', defaults.brand_word1);
  set('ap-brand-sep',   defaults.brand_sep);
  set('ap-brand-word2', defaults.brand_word2);
  set('ap-login-title',    defaults.login_title);
  set('ap-login-subtitle', defaults.login_subtitle);
  set('ap-login-btn',      defaults.login_btn);
  set('ap-color-cyan',   defaults.color_cyan);
  set('ap-color-purple', defaults.color_purple);
  set('ap-color-green',  defaults.color_green);
  set('ap-color-red',    defaults.color_red);
  set('ap-color-bg',     defaults.color_bg);
  set('ap-pb-number-color', defaults.pb_number_color);
  set('ap-pb-number-active-color', defaults.pb_number_active_color);
  set('ap-pb-number-outline-color', defaults.pb_number_outline_color);
  [
    ['ap-color-cyan', 'ap-color-cyan-hex'],
    ['ap-color-purple', 'ap-color-purple-hex'],
    ['ap-color-green', 'ap-color-green-hex'],
    ['ap-color-red', 'ap-color-red-hex'],
    ['ap-color-bg', 'ap-color-bg-hex'],
    ['ap-pb-number-color', 'ap-pb-number-color-hex'],
    ['ap-pb-number-active-color', 'ap-pb-number-active-color-hex'],
    ['ap-pb-number-outline-color', 'ap-pb-number-outline-color-hex'],
  ].forEach(([inputId, hexId]) => {
    const input = document.getElementById(inputId);
    const hex = document.getElementById(hexId);
    if (input && hex) hex.textContent = input.value;
  });
  applyAppearance(defaults);
}

/* ── UI Text Admin Tab ── */
function loadUILabelsTab() {
  const t = (adminSettings && adminSettings.ui_text) ? adminSettings.ui_text : {};
  const claimPeople = (adminSettings && Array.isArray(adminSettings.claim_people)) ? adminSettings.claim_people : [];
  const setVal = (id, val, ph) => { const e = document.getElementById(id); if (e) { e.value = (val !== undefined && val !== '') ? val : ''; e.placeholder = ph; } };
  setVal('ul-nav-dashboard', t.nav_dashboard, 'Dashboard');
  setVal('ul-nav-upload',    t.nav_upload,    'Upload PDF');
  setVal('ul-nav-blocks',    t.nav_blocks,    'Power Blocks');
  setVal('ul-nav-sitemap',   t.nav_sitemap,   'Site Map');
  setVal('ul-nav-worklog',   t.nav_worklog === 'Work Log' ? 'Claim' : t.nav_worklog,   'Claim');
  setVal('ul-nav-reports',   t.nav_reports,   'Reports');
  setVal('ul-nav-admin',     t.nav_admin,     'Admin');
  setVal('ul-title-dashboard', t.title_dashboard, 'All Trackers');
  setVal('ul-sub-dashboard',   t.sub_dashboard,   'Select a tracker to view and manage its progress');
  setVal('ul-dashboard-loading', t.dashboard_loading, 'LOADING TRACKERS...');
  setVal('ul-dashboard-empty',   t.dashboard_empty,   'No trackers yet. Create one in Admin.');
  setVal('ul-dashboard-complete', t.dashboard_complete, 'Complete');
  setVal('ul-dashboard-blocks',   t.dashboard_power_blocks, 'Power Blocks');
  setVal('ul-dashboard-open',     t.dashboard_open_tracker, 'Open Tracker');
  setVal('ul-title-blocks',    t.title_blocks,    'Power Blocks & LBDs');
  setVal('ul-title-upload',    t.title_upload,    'Upload & Extract PDF');
  setVal('ul-title-worklog',   t.title_worklog === 'Work Log' ? 'Claim' : t.title_worklog,   'Claim');
  setVal('ul-title-reports',   t.title_reports,   'Daily Reports');
  setVal('ul-title-admin',     t.title_admin,     'Admin Controls');
  adminSetClaimCrew(claimPeople);
  document.getElementById('uilabels-save-status').textContent = '';
}

async function saveAdminUIText() {
  const g = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const ui_text = {
    nav_dashboard: g('ul-nav-dashboard'), nav_upload: g('ul-nav-upload'),
    nav_blocks:    g('ul-nav-blocks'),    nav_sitemap: g('ul-nav-sitemap'),
    nav_worklog:   g('ul-nav-worklog'),   nav_reports: g('ul-nav-reports'),
    nav_admin:     g('ul-nav-admin'),
    title_dashboard: g('ul-title-dashboard'), sub_dashboard: g('ul-sub-dashboard'),
    dashboard_loading: g('ul-dashboard-loading'), dashboard_empty: g('ul-dashboard-empty'),
    dashboard_complete: g('ul-dashboard-complete'), dashboard_power_blocks: g('ul-dashboard-blocks'),
    dashboard_open_tracker: g('ul-dashboard-open'),
    title_blocks:    g('ul-title-blocks'),    title_upload:  g('ul-title-upload'),
    title_worklog:   g('ul-title-worklog'),   title_reports: g('ul-title-reports'),
    title_admin:     g('ul-title-admin'),
  };
  // strip empty strings so defaults still render
  for (const k of Object.keys(ui_text)) { if (!ui_text[k]) delete ui_text[k]; }
  try {
    await api.saveUIText(ui_text);
    if (adminSettings) adminSettings.ui_text = ui_text;
    applyUIText(ui_text);
    await loadDashboard();
    const st = document.getElementById('uilabels-save-status');
    if (st) { st.textContent = '✓ Saved'; setTimeout(() => { st.textContent = ''; }, 2500); }
  } catch(e) { showAdminAlert('Failed to save UI text: ' + e.message, 'error'); }
}

function resetAdminUIText() {
  ['ul-nav-dashboard','ul-nav-upload','ul-nav-blocks','ul-nav-sitemap','ul-nav-worklog','ul-nav-reports','ul-nav-admin',
   'ul-title-dashboard','ul-sub-dashboard','ul-dashboard-loading','ul-dashboard-empty','ul-dashboard-complete',
   'ul-dashboard-blocks','ul-dashboard-open','ul-title-blocks','ul-title-upload','ul-title-worklog','ul-title-reports','ul-title-admin']
    .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
}

function adminNormalizeClaimPeople(values) {
  const seen = new Set();
  return (values || [])
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function adminParseClaimCrewField() {
  const field = document.getElementById('admin-claim-people');
  if (!field) return [];
  return adminNormalizeClaimPeople(field.value.split(/[\n,]/));
}

function renderAdminClaimCrewList(people) {
  const container = document.getElementById('admin-claim-crew-list');
  if (!container) return;
  const normalized = adminNormalizeClaimPeople(people);
  if (!normalized.length) {
    container.innerHTML = '<span style="color:#64748b;font-size:12px;">No crew saved yet.</span>';
    return;
  }
  container.innerHTML = normalized.map((name) => {
    const encoded = encodeURIComponent(name);
    return `<span style="display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.18);color:#d7f7ff;font-size:12px;">
      <span>${_escapeHtml(name)}</span>
      <button type="button" onclick="adminRemoveClaimCrewMember(decodeURIComponent('${encoded}'))" style="background:transparent;border:none;color:#ff8fa3;cursor:pointer;font-size:13px;line-height:1;padding:0;">×</button>
    </span>`;
  }).join('');
}

function adminSetClaimCrew(people) {
  const normalized = adminNormalizeClaimPeople(people);
  const field = document.getElementById('admin-claim-people');
  if (field) field.value = normalized.join('\n');
  renderAdminClaimCrewList(normalized);
}

function adminRefreshClaimCrewFromField() {
  renderAdminClaimCrewList(adminParseClaimCrewField());
}

function adminAddClaimCrewMember() {
  const input = document.getElementById('admin-claim-crew-input');
  if (!input) return;
  const nextPeople = adminNormalizeClaimPeople([...adminParseClaimCrewField(), input.value]);
  adminSetClaimCrew(nextPeople);
  input.value = '';
  input.focus();
}

function adminRemoveClaimCrewMember(name) {
  const nextPeople = adminParseClaimCrewField().filter((person) => person.toLowerCase() !== String(name || '').trim().toLowerCase());
  adminSetClaimCrew(nextPeople);
}

async function saveAdminClaimPeople() {
  const people = adminParseClaimCrewField();
  try {
    const response = await api.saveClaimPeople(people);
    if (adminSettings) adminSettings.claim_people = response.data || people;
    const fieldValue = Array.isArray(response.data) ? response.data : people;
    adminSetClaimCrew(fieldValue);
    const st = document.getElementById('claim-people-save-status');
    if (st) { st.textContent = '✓ Saved'; setTimeout(() => { st.textContent = ''; }, 2500); }
  } catch(e) {
    showAdminAlert('Failed to save claim people: ' + e.message, 'error');
  }
}

/* ── Trackers Admin Tab ── */
async function loadTrackersTab() {
  try {
    const r = await api.getTrackers();
    const trackers = r.data || [];
    renderTrackersList(trackers);
  } catch(e) { showAdminAlert('Failed to load trackers: ' + e.message, 'error'); }
}

function renderTrackersList(trackers) {
  const container = document.getElementById('admin-trackers-list');
  if (!container) return;
  if (trackers.length === 0) {
    container.innerHTML = '<p style="color:#8892b0;">No trackers yet. Add one below.</p>';
    return;
  }
  container.innerHTML = trackers.map(t => {
    const types = t.status_types || [];
    const colors = t.status_colors || {};
    const names = t.status_names || {};
    const columnPills = types.map(k => {
      const c = colors[k] || '#888';
      const n = names[k] || k.replace(/_/g, ' ');
      return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;color:#fff;background:${c};margin:2px;">${n}</span>`;
    }).join('');
    const modeBadge = t.tracking_mode === 'block_only'
      ? `<span style="padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700;background:rgba(124,108,252,0.2);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);">Block-Only</span>`
      : `<span style="padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700;background:rgba(0,212,255,0.12);color:#00d4ff;border:1px solid rgba(0,212,255,0.25);">Per-Item</span>`;
    const colorDot = t.map_color
      ? `<span title="Map color: ${t.map_color}" style="display:inline-block;width:13px;height:13px;border-radius:50%;background:${t.map_color};border:1px solid rgba(255,255,255,0.2);vertical-align:middle;margin-right:2px;"></span>`
      : '';
    const _flag = (on, label) => `<span style="font-size:10px;padding:2px 6px;border-radius:6px;background:${on ? 'rgba(0,232,122,0.1)' : 'rgba(255,76,106,0.08)'};color:${on ? '#00e87a' : '#ff4c6a'};border:1px solid ${on ? 'rgba(0,232,122,0.25)' : 'rgba(255,76,106,0.2)'};">${on ? '✓' : '✗'} ${label}</span>`;
    const flagsRow = [
      _flag(t.show_on_dashboard !== false, 'Dashboard'),
      _flag(t.is_active !== false, 'Active'),
      _flag(t.claims_enabled !== false, 'Claims'),
      _flag(t.notes_enabled !== false, 'Notes'),
      _flag(t.report_enabled !== false, 'Reports'),
    ].join(' ');
    return `<div id="tracker-card-${t.id}" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:15px;font-weight:700;color:#eef2ff;">${t.icon || '📋'} ${getTrackerDisplayName(t)} <span style="font-size:11px;color:#8892b0;font-weight:400;">(${t.slug})</span></div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" onclick="editTrackerInline(${t.id})" style="font-size:12px;padding:4px 10px;">✏️ Edit</button>
          <button class="btn btn-sm" onclick="deleteTrackerBtn(${t.id}, '${getTrackerDisplayName(t).replace(/'/g, "\\'")}')" style="font-size:12px;padding:4px 10px;color:#ff4c6a;">🗑️</button>
        </div>
      </div>
      <div style="font-size:12px;color:#a0aec0;margin-bottom:6px;">
        Item: <strong>${t.item_name_singular || 'Item'}</strong> / <strong>${t.item_name_plural || 'Items'}</strong> &nbsp;|&nbsp; Block: <strong>${t.block_label_singular || 'Power Block'}</strong> / <strong>${t.block_label_plural || 'Power Blocks'}</strong>
      </div>
      <div style="font-size:12px;color:#a0aec0;margin-bottom:6px;">
        Dashboard card: <strong>${t.dashboard_progress_label || 'Complete'}</strong> &nbsp;|&nbsp; <strong>${t.dashboard_blocks_label || 'Power Blocks'}</strong> &nbsp;|&nbsp; <strong>${t.dashboard_open_label || 'Open Tracker'}</strong>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        ${modeBadge}
        ${colorDot ? `<span style="font-size:11px;color:#8892b0;">${colorDot} Map color</span>` : ''}
        ${flagsRow}
      </div>
      <div style="font-size:11px;color:#8892b0;margin-bottom:4px;">Status columns:</div>
      <div>${columnPills || '<span style="color:#8892b0;font-size:11px;">None</span>'}</div>
    </div>`;
  }).join('');
}

function editTrackerInline(trackerId) {
  const t = allTrackers.find(x => x.id === trackerId);
  if (!t) return;
  const card = document.getElementById('tracker-card-' + trackerId);
  if (!card) return;

  const types = t.status_types || [];
  const colors = t.status_colors || {};
  const names = t.status_names || {};
  let columnsHtml = types.map(k => {
    const c = colors[k] || '#888888';
    const n = names[k] || k.replace(/_/g, ' ');
    return `<div class="tedit-col-row" data-key="${k}" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <input type="color" class="tedit-col-color" value="${c}" style="width:32px;height:26px;border:none;border-radius:4px;cursor:pointer;">
      <input type="text" class="tedit-col-name" value="${n}" style="width:120px;padding:3px 6px;font-size:12px;border:1px solid #555;border-radius:4px;background:#1e1e2e;color:#eef2ff;">
      <span style="color:#8892b0;font-size:11px;">${k}</span>
      <button onclick="this.closest('.tedit-col-row').remove()" style="background:none;border:none;color:#ff4c6a;cursor:pointer;font-size:14px;">✕</button>
    </div>`;
  }).join('');

  const _s = (x) => x ? 'style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;"' : '';
  const _chk = (id, val, lbl) => `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#eef2ff;cursor:pointer;"><input type="checkbox" id="${id}" ${val ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer;"> ${lbl}</label>`;
  const _sec = (title) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;padding:8px 0 4px;border-top:1px solid rgba(255,255,255,0.07);margin-top:8px;">${title}</div>`;
  const _inp = (id, val, placeholder='') => `<input type="text" id="${id}" value="${_escapeHtml(String(val||''))}" placeholder="${placeholder}" style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;">`;
  const _sel = (id, options, curVal) => `<select id="${id}" style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;">${options.map(([v,l])=>`<option value="${v}" ${curVal===v?'selected':''}>${l}</option>`).join('')}</select>`;

  card.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;">
    <div style="font-size:14px;font-weight:700;color:#eef2ff;margin-bottom:2px;">✏️ Editing: ${_escapeHtml(t.name)}</div>

    ${_sec('🏷️ Identity')}
    <div class="form-row">
      <div class="form-group"><label style="font-size:12px;">Name</label>${_inp(`tedit-name-${trackerId}`, t.name)}</div>
      <div class="form-group"><label style="font-size:12px;">Slug</label><input type="text" id="tedit-slug-${trackerId}" value="${t.slug}" oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9-]/g,'')" style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;"></div>
      <div class="form-group"><label style="font-size:12px;">Icon</label><input type="text" id="tedit-icon-${trackerId}" value="${_escapeHtml(t.icon||'')}" style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:56px;"></div>
      <div class="form-group"><label style="font-size:12px;">Sort Order</label><input type="number" id="tedit-sort-${trackerId}" value="${t.sort_order||0}" style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:70px;"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label style="font-size:12px;">Item Singular</label>${_inp(`tedit-singular-${trackerId}`, t.item_name_singular, 'e.g. LBD')}</div>
      <div class="form-group"><label style="font-size:12px;">Item Plural</label>${_inp(`tedit-plural-${trackerId}`, t.item_name_plural, 'e.g. LBDs')}</div>
      <div class="form-group"><label style="font-size:12px;">Stat Label</label>${_inp(`tedit-stat-${trackerId}`, t.stat_label, 'e.g. Total LBDs')}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label style="font-size:12px;">Block Label (singular)</label>${_inp(`tedit-blk-sing-${trackerId}`, t.block_label_singular||'Power Block', 'e.g. Row')}</div>
      <div class="form-group"><label style="font-size:12px;">Block Label (plural)</label>${_inp(`tedit-blk-plur-${trackerId}`, t.block_label_plural||'Power Blocks', 'e.g. Rows')}</div>
    </div>

    ${_sec('📊 Dashboard & Visibility')}
    <div class="form-row">
      <div class="form-group"><label style="font-size:12px;">Dashboard Progress Label</label>${_inp(`tedit-progress-${trackerId}`, t.dashboard_progress_label, 'Complete')}</div>
      <div class="form-group"><label style="font-size:12px;">Dashboard Blocks Label</label>${_inp(`tedit-blocks-${trackerId}`, t.dashboard_blocks_label, 'Power Blocks')}</div>
      <div class="form-group"><label style="font-size:12px;">Dashboard Button Text</label>${_inp(`tedit-open-${trackerId}`, t.dashboard_open_label, 'Open Tracker')}</div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label style="font-size:12px;">Map Marker Color (in-progress tint)</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="color" id="tedit-map-color-${trackerId}" value="${t.map_color || '#ffc107'}" style="width:36px;height:28px;border:none;border-radius:4px;cursor:pointer;">
          <input type="text" id="tedit-map-color-hex-${trackerId}" value="${t.map_color || ''}" placeholder="leave empty for default yellow" oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('tedit-map-color-${trackerId}').value=this.value" style="background:#1e1e2e;color:#eef2ff;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:180px;">
          <button type="button" onclick="document.getElementById('tedit-map-color-hex-${trackerId}').value=''" style="background:none;border:none;color:#8892b0;cursor:pointer;font-size:11px;">✕ clear</button>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:4px;">
      ${_chk(`tedit-show-dashboard-${trackerId}`, t.show_on_dashboard !== false, 'Show on main dashboard overview')}
      ${_chk(`tedit-is-active-${trackerId}`, t.is_active !== false, 'Tracker is active (visible to crew)')}
    </div>

    ${_sec('⚙️ Tracking Mode')}
    <div class="form-row">
      <div class="form-group">
        <label style="font-size:12px;">How this tracker is tracked</label>
        ${_sel(`tedit-tracking-mode-${trackerId}`, [
          ['per_item', 'Per item — LBD row-by-row tracking (e.g. LBD Tracker)'],
          ['block_only', 'Block only — mark whole power blocks complete/incomplete (e.g. Inverter DC Landing)'],
        ], t.tracking_mode || 'per_item')}
      </div>
      <div class="form-group">
        <label style="font-size:12px;">Completion Column (for progress %)</label>
        ${_sel(`tedit-completion-status-${trackerId}`,
          [['', '— Use last column —'], ...types.map(k => [k, names[k] || k.replace(/_/g,' ')])],
          t.completion_status_type || '')}
      </div>
      <div class="form-group">
        <label style="font-size:12px;">Dashboard % counts by</label>
        ${_sel(`tedit-progress-unit-${trackerId}`,
          [['lbd','Individual item (LBD)'], ['block','Power block completion']],
          t.progress_unit || 'lbd')}
      </div>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:4px;">
      ${_chk(`tedit-show-per-lbd-${trackerId}`, t.show_per_lbd_ui !== false, 'Show per-item grid in map & claim panels')}
    </div>

    ${_sec('👷 Crew & Workflow')}
    <div style="display:flex;gap:20px;flex-wrap:wrap;">
      ${_chk(`tedit-claims-enabled-${trackerId}`, t.claims_enabled !== false, 'Enable crew claiming for this tracker')}
      ${_chk(`tedit-notes-enabled-${trackerId}`, t.notes_enabled !== false, 'Enable per-block notes')}
      ${_chk(`tedit-report-enabled-${trackerId}`, t.report_enabled !== false, 'Include in daily crew reports')}
    </div>

    ${_sec('📋 Status Columns')}
    <div id="tedit-cols-${trackerId}">${columnsHtml}</div>
    <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
      <input type="text" id="tedit-newcol-key-${trackerId}" placeholder="key" style="width:90px;padding:3px 6px;font-size:12px;border:1px solid #555;border-radius:4px;background:#1e1e2e;color:#eef2ff;" oninput="this.value=this.value.toLowerCase().replace(/ /g,'_').replace(/[^a-z0-9_]/g,'')">
      <input type="text" id="tedit-newcol-name-${trackerId}" placeholder="Label" style="width:100px;padding:3px 6px;font-size:12px;border:1px solid #555;border-radius:4px;background:#1e1e2e;color:#eef2ff;">
      <input type="color" id="tedit-newcol-color-${trackerId}" value="#888888" style="width:32px;height:26px;border:none;border-radius:4px;cursor:pointer;">
      <button class="btn btn-sm" onclick="addTrackerEditCol(${trackerId})" style="font-size:11px;padding:3px 8px;">+ Add</button>
    </div>

    <div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);">
      <button class="btn btn-primary" onclick="saveTrackerEdit(${trackerId})" style="font-size:13px;">Save Changes</button>
      <button class="btn" onclick="loadTrackersTab()" style="font-size:13px;">Cancel</button>
    </div>
  </div>`;
}

function addTrackerEditCol(trackerId) {
  const keyEl = document.getElementById('tedit-newcol-key-' + trackerId);
  const nameEl = document.getElementById('tedit-newcol-name-' + trackerId);
  const colorEl = document.getElementById('tedit-newcol-color-' + trackerId);
  const key = (keyEl.value || '').trim();
  const name = (nameEl.value || '').trim();
  const color = colorEl.value || '#888888';
  if (!key || !name) { showAdminAlert('Column key and label are required.', 'error'); return; }
  const container = document.getElementById('tedit-cols-' + trackerId);
  container.insertAdjacentHTML('beforeend', `<div class="tedit-col-row" data-key="${key}" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
    <input type="color" class="tedit-col-color" value="${color}" style="width:32px;height:26px;border:none;border-radius:4px;cursor:pointer;">
    <input type="text" class="tedit-col-name" value="${name}" style="width:120px;padding:3px 6px;font-size:12px;border:1px solid #555;border-radius:4px;background:#1e1e2e;color:#eef2ff;">
    <span style="color:#8892b0;font-size:11px;">${key}</span>
    <button onclick="this.closest('.tedit-col-row').remove()" style="background:none;border:none;color:#ff4c6a;cursor:pointer;font-size:14px;">✕</button>
  </div>`);
  keyEl.value = '';
  nameEl.value = '';
}

async function saveTrackerEdit(trackerId) {
  const name = document.getElementById('tedit-name-' + trackerId).value.trim();
  const slug = document.getElementById('tedit-slug-' + trackerId).value.trim();
  const icon = document.getElementById('tedit-icon-' + trackerId).value.trim();
  const singular = document.getElementById('tedit-singular-' + trackerId).value.trim();
  const plural = document.getElementById('tedit-plural-' + trackerId).value.trim();
  const statLabel = document.getElementById('tedit-stat-' + trackerId).value.trim();
  const progressLabel = document.getElementById('tedit-progress-' + trackerId).value.trim();
  const blocksLabel = document.getElementById('tedit-blocks-' + trackerId).value.trim();
  const openLabel = document.getElementById('tedit-open-' + trackerId).value.trim();
  const completionStatusType = (document.getElementById('tedit-completion-status-' + trackerId)?.value || '').trim();
  const progressUnit = document.getElementById('tedit-progress-unit-' + trackerId)?.value || 'lbd';
  const showPerLbdUi = document.getElementById('tedit-show-per-lbd-' + trackerId)?.checked !== false;
  const trackingMode = document.getElementById('tedit-tracking-mode-' + trackerId)?.value || 'per_item';
  const blockLabelSingular = (document.getElementById('tedit-blk-sing-' + trackerId)?.value || '').trim() || 'Power Block';
  const blockLabelPlural = (document.getElementById('tedit-blk-plur-' + trackerId)?.value || '').trim() || 'Power Blocks';
  const showOnDashboard = document.getElementById('tedit-show-dashboard-' + trackerId)?.checked !== false;
  const isActive = document.getElementById('tedit-is-active-' + trackerId)?.checked !== false;
  const claimsEnabled = document.getElementById('tedit-claims-enabled-' + trackerId)?.checked !== false;
  const notesEnabled = document.getElementById('tedit-notes-enabled-' + trackerId)?.checked !== false;
  const reportEnabled = document.getElementById('tedit-report-enabled-' + trackerId)?.checked !== false;
  const mapColorHex = (document.getElementById('tedit-map-color-hex-' + trackerId)?.value || '').trim();
  const sortOrder = parseInt(document.getElementById('tedit-sort-' + trackerId)?.value || '0', 10);
  if (!name || !slug) { showAdminAlert('Name and slug are required.', 'error'); return; }

  // Collect columns from the edit rows
  const rows = document.querySelectorAll('#tedit-cols-' + trackerId + ' .tedit-col-row');
  const status_types = [];
  const status_colors = {};
  const status_names = {};
  rows.forEach(row => {
    const key = row.dataset.key;
    const color = row.querySelector('.tedit-col-color').value;
    const label = row.querySelector('.tedit-col-name').value.trim();
    status_types.push(key);
    status_colors[key] = color;
    status_names[key] = label || key.replace(/_/g, ' ');
  });

  try {
    await api.updateTracker(trackerId, {
      name, slug, icon, sort_order: sortOrder,
      item_name_singular: singular, item_name_plural: plural, stat_label: statLabel,
      dashboard_progress_label: progressLabel, dashboard_blocks_label: blocksLabel, dashboard_open_label: openLabel,
      block_label_singular: blockLabelSingular, block_label_plural: blockLabelPlural,
      status_types, status_colors, status_names, column_order: status_types,
      completion_status_type: completionStatusType || null,
      progress_unit: progressUnit,
      tracking_mode: trackingMode,
      show_per_lbd_ui: showPerLbdUi,
      show_on_dashboard: showOnDashboard,
      is_active: isActive,
      claims_enabled: claimsEnabled,
      notes_enabled: notesEnabled,
      report_enabled: reportEnabled,
      map_color: mapColorHex || null,
    });
    showAdminAlert('Tracker updated!', 'success');
    await loadTrackers();
    // If this is the current tracker, refresh settings
    if (currentTracker && currentTracker.id === trackerId) {
      currentTracker = allTrackers.find(x => x.id === trackerId);
      await loadAdminSettings();
    }
    loadTrackersTab();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

async function deleteTrackerBtn(trackerId, name) {
  if (!confirm('Delete tracker "' + name + '"? This will remove all associated data and cannot be undone.')) return;
  try {
    await api.deleteTracker(trackerId);
    showAdminAlert('Tracker deleted.', 'success');
    await loadTrackers();
    loadTrackersTab();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

// ── LBD Data Manager ──────────────────────────────────────────────────────────

async function adminDedupLbds() {
  const btn = document.getElementById('lbd-dedup-btn');
  const result = document.getElementById('lbd-dedup-result');
  if (!result) return;
  if (!confirm('Run deduplication? This will permanently delete duplicate LBD rows and cannot be undone.')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  result.innerHTML = '<span style="color:#94a3b8;">Working…</span>';
  try {
    const r = await api.call('/tracker/admin/dedup-lbds', { method: 'POST' });
    const d = r.data || r;
    const msg = d.message || (d.deleted === 0 ? 'No duplicates found.' : `Removed ${d.deleted} duplicates.`);
    const tone = d.deleted > 0 ? '#00e87a' : '#a5b4fc';
    result.innerHTML = `<span style="color:${tone};font-weight:700;">${_escapeHtml(msg)}</span>`
      + (d.before != null ? ` <span style="color:#64748b;font-size:12px;">(${d.before.toLocaleString()} → ${d.after.toLocaleString()} LBDs)</span>` : '');
    await adminLoadLbdStats();
  } catch(e) {
    result.innerHTML = `<span style="color:#ff4c6a;">Error: ${_escapeHtml(e.message)}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧹 Deduplicate Now'; }
  }
}

async function adminLoadLbdStats() {
  const wrap = document.getElementById('admin-lbd-stats-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:#94a3b8;font-size:13px;">Loading…</p>';
  try {
    const r = await api.call('/tracker/admin/lbd-stats');
    const trackers = r.data || [];
    const dupCount = r.duplicate_lbd_count || 0;

    let dupBanner = '';
    if (dupCount > 0) {
      dupBanner = `<div style="margin-bottom:16px;padding:10px 14px;border-radius:10px;background:rgba(255,76,106,0.1);border:1px solid rgba(255,76,106,0.3);color:#ff8fab;font-size:13px;">
        ⚠️ <strong>${dupCount.toLocaleString()} duplicate LBDs detected.</strong> Click "Deduplicate Now" above to remove them.
      </div>`;
    }

    if (!trackers.length) {
      wrap.innerHTML = dupBanner + '<p style="color:#94a3b8;font-size:13px;">No tracker data found.</p>';
      return;
    }

    const sections = trackers.map(t => {
      // Flag blocks that have an abnormally high count (likely doubled)
      const counts = t.blocks.map(b => b.lbd_count);
      const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
      const threshold = median * 1.5;

      const rows = t.blocks.slice(0, 200).map(b => {
        const suspicious = median > 0 && b.lbd_count >= threshold && b.lbd_count > median;
        return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
          <span style="flex:1;color:${suspicious ? '#fbbf24' : '#eef2ff'};">${_escapeHtml(b.name)}${suspicious ? ' ⚠️' : ''}</span>
          <span style="color:#94a3b8;min-width:60px;text-align:right;">${b.lbd_count.toLocaleString()} LBDs</span>
          <button class="btn" style="font-size:10px;padding:2px 8px;color:#ff8fab;border-color:rgba(255,76,106,0.3);"
            onclick="adminDeleteBlockLbds(${b.id}, ${t.tracker_id}, '${_escapeHtml(b.name).replace(/'/g,"\\'")}', '${_escapeHtml(t.tracker_name).replace(/'/g,"\\'")}')">
            Delete all LBDs
          </button>
        </div>`;
      }).join('');

      return `<div style="margin-bottom:24px;">
        <div style="font-size:13px;font-weight:700;color:#eef2ff;margin-bottom:6px;">
          ${_escapeHtml(t.tracker_name)}
          <span style="font-size:11px;font-weight:400;color:#64748b;margin-left:8px;">${t.total_lbds.toLocaleString()} total LBDs across ${t.block_count} blocks</span>
        </div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;">
          ${rows || '<span style="color:#64748b;font-size:12px;">No blocks found.</span>'}
        </div>
      </div>`;
    }).join('');

    wrap.innerHTML = dupBanner + sections;
  } catch(e) {
    wrap.innerHTML = `<p style="color:#ff4c6a;font-size:13px;">Error: ${_escapeHtml(e.message)}</p>`;
  }
}

async function adminDeleteBlockLbds(blockId, trackerId, blockName, trackerName) {
  if (!confirm(`Delete ALL ${blockName} LBDs under tracker "${trackerName}"? This cannot be undone.`)) return;
  try {
    await api.call(`/tracker/admin/blocks/${blockId}/lbds?tracker_id=${trackerId}`, { method: 'DELETE' });
    showAdminAlert(`Deleted LBDs for ${blockName}.`, 'success');
    await adminLoadLbdStats();
  } catch(e) {
    showAdminAlert('Error: ' + e.message, 'error');
  }
}

// pending columns for the new tracker create form
let _newTrackerCols = [];

function addNewTrackerCol() {
  const key = (document.getElementById('new-col-key') || {}).value.trim();
  const label = (document.getElementById('new-col-label') || {}).value.trim();
  const color = (document.getElementById('new-col-color') || {}).value.trim() || '#4caf50';
  if (!key) { showAdminAlert('Column key is required.', 'error'); return; }
  if (_newTrackerCols.find(c => c.key === key)) { showAdminAlert('Column key already added.', 'error'); return; }
  _newTrackerCols.push({ key, label: label || key, color });
  document.getElementById('new-col-key').value = '';
  document.getElementById('new-col-label').value = '';
  document.getElementById('new-col-color').value = '#4caf50';
  const container = document.getElementById('new-tracker-cols');
  if (container) {
    container.innerHTML = _newTrackerCols.map((c, i) =>
      `<div style="display:flex;align-items:center;gap:8px;font-size:13px;background:#fff;padding:5px 8px;border-radius:5px;border:1px solid #ddd;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${c.color};flex-shrink:0;"></span>
        <span style="font-weight:600;">${c.key}</span> — <span style="color:#555;">${c.label}</span>
        <button type="button" onclick="_newTrackerCols.splice(${i},1);addNewTrackerCol.call(null,true)" style="margin-left:auto;background:none;border:none;color:#e74c3c;cursor:pointer;font-size:16px;line-height:1;">×</button>
      </div>`
    ).join('');
  }
}

async function addNewTracker() {
  const _v = id => (document.getElementById(id) || {}).value || '';
  const _chkv = id => !!(document.getElementById(id) || {}).checked;
  const name = _v('new-tracker-name').trim();
  const slug = _v('new-tracker-slug').trim();
  if (!name || !slug) { showAdminAlert('Tracker name and slug are required.', 'error'); return; }
  const mapColorRaw = _v('new-tracker-map-color-hex').trim();
  const mapColor = /^#[0-9a-fA-F]{6}$/.test(mapColorRaw) ? mapColorRaw : (_v('new-tracker-map-color').trim() || null);
  const payload = {
    name, slug,
    icon: _v('new-tracker-icon').trim(),
    sort_order: parseInt(_v('new-tracker-sort')) || 0,
    item_name_singular: _v('new-tracker-singular').trim(),
    item_name_plural: _v('new-tracker-plural').trim(),
    block_label_singular: _v('new-tracker-block-sing').trim() || 'Power Block',
    block_label_plural: _v('new-tracker-block-plur').trim() || 'Power Blocks',
    stat_label: _v('new-tracker-stat').trim(),
    dashboard_progress_label: _v('new-tracker-progress').trim(),
    dashboard_blocks_label: _v('new-tracker-blocks').trim(),
    dashboard_open_label: _v('new-tracker-open').trim(),
    tracking_mode: _v('new-tracker-mode') || 'per_item',
    show_per_lbd_ui: _chkv('new-tracker-per-lbd'),
    show_on_dashboard: _chkv('new-tracker-show-dash'),
    is_active: _chkv('new-tracker-active'),
    claims_enabled: _chkv('new-tracker-claims'),
    notes_enabled: _chkv('new-tracker-notes'),
    report_enabled: _chkv('new-tracker-report'),
    map_color: mapColor,
  };
  try {
    const created = await api.createTracker(payload);
    // add any pending status columns
    if (_newTrackerCols.length > 0 && created && created.id) {
      for (const col of _newTrackerCols) {
        try { await api.addTrackerColumn(created.id, col.key, col.label, col.color); } catch(_) {}
      }
    }
    showAdminAlert('Tracker created!', 'success');
    _newTrackerCols = [];
    ['new-tracker-name','new-tracker-slug','new-tracker-icon','new-tracker-sort',
     'new-tracker-singular','new-tracker-plural','new-tracker-block-sing','new-tracker-block-plur',
     'new-tracker-stat','new-tracker-progress','new-tracker-blocks','new-tracker-open',
     'new-tracker-map-color-hex'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const colsEl = document.getElementById('new-tracker-cols'); if (colsEl) colsEl.innerHTML = '';
    await loadTrackers();
    loadTrackersTab();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

function renderAdminColorRows(colors, columns, names) {
  const container = document.getElementById('admin-color-rows');
  if (!container) return;
  container.innerHTML = columns.map(k => {
    const col = colors[k] || '#888888';
    const label = (names && names[k]) ? names[k] : k.replace(/_/g,' ');
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <label style="width:120px;font-size:13px;">${label}</label>
      <input type="color" value="${col}" id="color-pick-${k}" oninput="document.getElementById('color-hex-${k}').value=this.value" style="width:40px;height:30px;border:none;border-radius:4px;cursor:pointer;">
      <input type="text" id="color-hex-${k}" value="${col}" maxlength="7"
        oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('color-pick-${k}').value=this.value"
        style="width:80px;font-family:monospace;padding:4px;border:1px solid #ddd;border-radius:4px;">
    </div>`;
  }).join('');
}

async function saveAdminColors() {
  const columns = adminSettings.all_columns || LBD_STATUS_TYPES;
  const colors = {};
  columns.forEach(k => {
    const el = document.getElementById('color-pick-' + k);
    if (el) colors[k] = el.value;
  });
  try {
    await api.saveAdminColors(colors);
    showAdminAlert('Colors saved!', 'success');
    await loadAdminSettings();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

function renderAdminNameRows(names, columns) {
  const container = document.getElementById('admin-name-rows');
  if (!container) return;
  container.innerHTML = columns.map(k => {
    const label = (names && names[k]) ? names[k] : k.replace(/_/g,' ');
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <label style="width:140px;font-size:11px;color:#666;">${k}</label>
      <input type="text" id="name-input-${k}" value="${label}"
        style="flex:1;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:13px;">
    </div>`;
  }).join('');
}

async function saveAdminNames() {
  const columns = adminSettings.all_columns || LBD_STATUS_TYPES;
  const names = {};
  columns.forEach(k => {
    const el = document.getElementById('name-input-' + k);
    if (el) names[k] = el.value.trim() || k;
  });
  try {
    await api.saveAdminNames(names);
    showAdminAlert('Names saved!', 'success');
    await loadAdminSettings();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

function renderAdminColumnsList(custom) {
  const container = document.getElementById('admin-columns-list');
  if (!container) return;
  const all = adminSettings.all_columns || LBD_STATUS_TYPES;
  let html = '';
  all.forEach((k, idx) => {
    const label = (adminSettings.names && adminSettings.names[k]) ? adminSettings.names[k] : k.replace(/_/g,' ');
    const col = (adminSettings.colors && adminSettings.colors[k]) || '#888';
    const isFirst = idx === 0;
    const isLast = idx === all.length - 1;
    html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.07);" data-col-key="${k}">
      <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">
        <button onclick="moveAdminColumn(${idx},-1)" ${isFirst ? 'disabled' : ''} style="background:${isFirst ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)'};color:${isFirst ? '#333' : '#ccd6f6'};border:none;border-radius:3px;padding:2px 7px;cursor:${isFirst ? 'default' : 'pointer'};font-size:12px;line-height:1;" title="Move up">▲</button>
        <button onclick="moveAdminColumn(${idx},1)" ${isLast ? 'disabled' : ''} style="background:${isLast ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)'};color:${isLast ? '#333' : '#ccd6f6'};border:none;border-radius:3px;padding:2px 7px;cursor:${isLast ? 'default' : 'pointer'};font-size:12px;line-height:1;" title="Move down">▼</button>
      </div>
      <span style="display:inline-block;width:14px;height:14px;background:${col};border-radius:3px;flex-shrink:0;"></span>
      <span style="flex:1;font-size:13px;color:#eef2ff;">${label}</span>
      <span style="font-size:10px;color:#4a5568;">${k}</span>
      <button onclick="deleteAdminColumn('${k}')" style="background:rgba(255,76,106,0.15);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:600;">Delete</button>
    </div>`;
  });
  html += `<div style="margin-top:14px;"><button class="btn btn-primary" onclick="saveColumnOrder()">Save Column Order</button></div>`;
  container.innerHTML = html;
}

async function moveAdminColumn(index, direction) {
  const all = adminSettings.all_columns || LBD_STATUS_TYPES;
  const newIdx = index + direction;
  if (newIdx < 0 || newIdx >= all.length) return;
  const arr = [...all];
  [arr[index], arr[newIdx]] = [arr[newIdx], arr[index]];
  adminSettings.all_columns = arr;
  LBD_STATUS_TYPES = arr;
  renderAdminColumnsList(adminSettings.custom_columns || []);
}

async function saveColumnOrder() {
  const order = adminSettings.all_columns || LBD_STATUS_TYPES;
  try {
    const r = await api.saveColumnOrder(order);
    adminSettings.all_columns = r.all_columns || order;
    LBD_STATUS_TYPES = adminSettings.all_columns;
    showAdminAlert('Column order saved!', 'success');
  } catch(e) { showAdminAlert('Error saving order: ' + e.message, 'error'); }
}

async function addAdminColumn() {
  const key   = (document.getElementById('new-col-key')   || {}).value || '';
  const label = (document.getElementById('new-col-label') || {}).value || '';
  const color = (document.getElementById('new-col-color') || {}).value || '#888888';
  const clean = key.trim().replace(/[^a-z0-9_]/gi,'_').toLowerCase();
  if (!clean || !label.trim()) { showAdminAlert('Key and label are required.', 'error'); return; }
  try {
    await api.addAdminColumn(clean, label.trim(), color);
    showAdminAlert('Column added!', 'success');
    document.getElementById('new-col-key').value = '';
    document.getElementById('new-col-label').value = '';
    const r = await api.getAdminSettings();
    adminSettings = r.data;
    LBD_STATUS_TYPES = adminSettings.all_columns || LBD_STATUS_TYPES;
    STATUS_COLORS = Object.assign({}, STATUS_COLORS, adminSettings.colors || {});
    STATUS_LABELS = {};
    LBD_STATUS_TYPES.forEach(k => { STATUS_LABELS[k] = (adminSettings.names && adminSettings.names[k]) ? adminSettings.names[k] : k.replace(/_/g,' '); });
    renderAdminColumnsList(adminSettings.custom_columns || []);
    renderLegend();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

async function deleteAdminColumn(key) {
  if (!confirm('Delete column "' + key + '"? This cannot be undone.')) return;
  try {
    await api.deleteAdminColumn(key);
    showAdminAlert('Column deleted.', 'success');
    const r = await api.getAdminSettings();
    adminSettings = r.data;
    LBD_STATUS_TYPES = adminSettings.all_columns || LBD_STATUS_TYPES;
    STATUS_COLORS = Object.assign({}, STATUS_COLORS, adminSettings.colors || {});
    STATUS_LABELS = {};
    LBD_STATUS_TYPES.forEach(k => { STATUS_LABELS[k] = (adminSettings.names && adminSettings.names[k]) ? adminSettings.names[k] : k.replace(/_/g,' '); });
    renderAdminColumnsList(adminSettings.custom_columns || []);
    renderLegend();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

function updateFontSizePreview(size) {
  const preview = document.getElementById('admin-font-preview');
  const display = document.getElementById('admin-font-size-display');
  if (display) display.textContent = size + 'px';
  if (preview) {
    preview.textContent = 'PB-01';
    preview.style.fontSize = size + 'px';
  }
}

async function saveAdminFontSize() {
  const slider = document.getElementById('admin-font-size');
  if (!slider) return;
  const size = parseInt(slider.value);
  try {
    await api.saveAdminFontSize(size);
    adminSettings.pb_label_font_size = size;
    showAdminAlert('Font size saved!', 'success');
    renderPBMarkers();
  } catch(e) { showAdminAlert('Error: ' + e.message, 'error'); }
}

// ── Map Labels Admin Tab ──────────────────────────────────
async function loadMapLabelsTab() {
  const listEl = document.getElementById('admin-maplabels-list');
  if (!listEl) return;
  listEl.innerHTML = '<p style="color:#999;font-size:13px;">Loading…</p>';
  try {
    const maps = await api.getAllSiteMaps();
    const areas = (maps.data && maps.data[0] && maps.data[0].areas) ? maps.data[0].areas : [];
    loadedMapAreas = areas;
    if (areas.length === 0) {
      listEl.innerHTML = '<p style="color:#999;font-size:13px;">No labels placed on the map yet.</p>';
      return;
    }
    listEl.innerHTML = '';
    areas.forEach(area => {
      const row = document.createElement('div');
      row.id = `maplabel-row-${area.id}`;
      row.style.cssText = 'display:flex;align-items:center;gap:10px;background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin-bottom:8px;';
      const color = area.label_color || '#ffffff';
      row.innerHTML = `
        <span style="flex:1;font-weight:600;font-size:14px;">${area.name}</span>
        <label style="font-size:12px;color:#555;margin-bottom:0;">Label Color</label>
        <input type="color" value="${color}" title="Change label text color"
          style="width:36px;height:30px;border:none;border-radius:5px;cursor:pointer;padding:0;"
          onchange="saveLabelColor(${area.id}, this.value, ${area.power_block_id})" />
        <button onclick="deleteLabelArea(${area.id}, ${area.power_block_id})"
          style="background:#dc3545;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:13px;">
          🗑 Delete
        </button>`;
      listEl.appendChild(row);
    });
  } catch(e) {
    listEl.innerHTML = `<p style="color:red;font-size:13px;">Error: ${e.message}</p>`;
  }
}

async function saveLabelColor(areaId, color, pbId) {
  try {
    await api.updateSiteArea(areaId, { label_color: color });
    if (pbId) {
      pbLabelColors[String(pbId)] = color;
      localStorage.setItem('pb_label_colors', JSON.stringify(pbLabelColors));
      renderPBMarkers();
    }
    showAdminAlert('Label color saved!', 'success');
  } catch(e) { showAdminAlert('Error saving color: ' + e.message, 'error'); }
}

async function deleteLabelArea(areaId, pbId) {
  if (!confirm('Delete this label from the map? The block data is not affected.')) return;
  try {
    await api.deleteSiteArea(areaId);
    // Remove from local state
    if (pbId) {
      const key = String(pbId);
      const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
      delete bboxes[key];
      delete pbPolygons[key];
      delete pbLabelColors[key];
      localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
      localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));
      localStorage.setItem('pb_label_colors', JSON.stringify(pbLabelColors));
    }
    const row = document.getElementById(`maplabel-row-${areaId}`);
    if (row) row.remove();
    renderPBMarkers();
    showAdminAlert('Label deleted.', 'success');
  } catch(e) { showAdminAlert('Error deleting label: ' + e.message, 'error'); }
}

function showAdminAlert(msg, type) {
  const el = document.getElementById('admin-alert');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = type === 'error' ? '#ffe5e5' : '#e5ffe5';
  el.style.color       = type === 'error' ? '#c00' : '#070';
  el.style.border      = `1px solid ${type === 'error' ? '#ffaaaa' : '#aaffaa'}`;
  el.style.padding     = '8px 12px';
  el.style.borderRadius = '4px';
  el.style.marginBottom = '10px';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ============================================================
// MAP SCAN & OVERLAYS
// ============================================================
let detectedScanRegions = [];
let scanAssignments = {};    // regionIndex -> pb name

// ============================================================
// AUTO-PLACE: One-click scan + assign + save + render
// ============================================================
async function autoPlacePBs() {
  const btn = document.getElementById('autoplace-btn');
  const clearBtn = document.getElementById('clear-scan-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning map...'; }

  try {
    // 1. Ensure map is registered
    let maps = await api.getAllSiteMaps().catch(() => ({data:[]}));
    let list = maps.data || [];
    if (list.length === 0) {
      try {
        await api.registerExistingMap();
        maps = await api.getAllSiteMaps();
        list = maps.data || [];
      } catch(e) { console.warn('register attempt failed:', e); }
    }
    if (list.length === 0) {
      alert('No site maps found. Upload a map first.');
      return;
    }
    const mapId = list[0].id;

    if (btn) btn.textContent = '⏳ Detecting regions...';

    // 2. Clear any old areas
    await api.deleteAllAreas(mapId).catch(() => {});

    // 3. Run OpenCV scan (improved dimension-based detection)
    const pbCount = mapPBs.length || 119;
    const r = await api.scanMap(mapId, pbCount);
    const regions = r.data || [];

    if (regions.length === 0) {
      alert('No PB regions detected. Try a different map image.');
      if (btn) { btn.disabled = false; btn.textContent = '📌 Auto-place PBs'; }
      return;
    }

    if (btn) btn.textContent = `⏳ Placing ${regions.length} PBs...`;

    // 4. Check if regions have OCR-mapped pb_number
    const hasOCRNumbers = regions.some(r => r.pb_number != null);

    // 5. Build bboxes and save areas
    const bboxes = {};
    const savePromises = [];

    if (hasOCRNumbers) {
      // OCR-based matching: each region has a pb_number, match directly
      const regionByNum = {};
      regions.forEach(r => { if (r.pb_number != null) regionByNum[r.pb_number] = r; });

      for (const pb of mapPBs) {
        const pbNum = parseInt(pb.power_block_number || pb.name.replace(/\D/g, '')) || 0;
        const reg = regionByNum[pbNum];
        if (!reg) continue;

        bboxes[String(pb.id)] = {
          x: reg.x_pct,
          y: reg.y_pct,
          w: reg.w_pct,
          h: reg.h_pct
        };
        savePromises.push(
          api.createSiteArea({
            site_map_id: mapId,
            power_block_id: pb.id,
            name: pb.name,
            bbox_x: reg.x_pct, bbox_y: reg.y_pct,
            bbox_w: reg.w_pct, bbox_h: reg.h_pct,
            label_font_size: adminSettings.pb_label_font_size || 14
          }).catch(e => console.warn('area save:', e))
        );
      }
    } else {
      // Fallback: Sort regions spatially (row-major: top→bottom, left→right)
      const heights = regions.map(r => r.h_pct).sort((a,b)=>a-b);
      const medH = heights[Math.floor(heights.length / 2)] || 5;
      const ROW_THRESH = medH * 0.6;

      const tagged = regions.map((r, i) => ({...r, idx: i}));
      tagged.sort((a, b) => a.y_pct - b.y_pct);
      const rows = [];
      let curRow = [tagged[0]];
      for (let i = 1; i < tagged.length; i++) {
        if (Math.abs(tagged[i].y_pct - curRow[0].y_pct) < ROW_THRESH) {
          curRow.push(tagged[i]);
        } else {
          rows.push(curRow);
          curRow = [tagged[i]];
        }
      }
      rows.push(curRow);
      rows.forEach(row => row.sort((a, b) => a.x_pct - b.x_pct));
      const orderedRegions = rows.flat();

      const sortedPBs = [...mapPBs].sort((a, b) => {
        const na = parseInt(a.power_block_number || a.name.replace(/\D/g, '')) || 0;
        const nb = parseInt(b.power_block_number || b.name.replace(/\D/g, '')) || 0;
        return na - nb;
      });

      const limit = Math.min(orderedRegions.length, sortedPBs.length);
      for (let i = 0; i < limit; i++) {
        const reg = orderedRegions[i];
        const pb = sortedPBs[i];
        bboxes[String(pb.id)] = {
          x: reg.x_pct,
          y: reg.y_pct,
          w: reg.w_pct,
          h: reg.h_pct
        };
        savePromises.push(
          api.createSiteArea({
            site_map_id: mapId,
            power_block_id: pb.id,
            name: pb.name,
            bbox_x: reg.x_pct, bbox_y: reg.y_pct,
            bbox_w: reg.w_pct, bbox_h: reg.h_pct,
            label_font_size: adminSettings.pb_label_font_size || 14
          }).catch(e => console.warn('area save:', e))
        );
      }
    }
    await Promise.all(savePromises);
    const limit = Object.keys(bboxes).length;

    // 7. Store bboxes, clear old positions
    localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
    localStorage.removeItem('pb_positions');

    // 8. Sync overlay size, clear scan overlays, re-render
    syncOverlaySize();
    detectedScanRegions = [];
    scanAssignments = {};
    renderScanOverlays();
    renderPBMarkers();

    // Show clear button
    if (clearBtn) clearBtn.style.display = '';

    if (btn) btn.textContent = `✅ ${limit} PBs placed!`;
    setTimeout(() => {
      if (btn) { btn.textContent = '📌 Auto-place PBs'; btn.disabled = false; }
    }, 3000);

  } catch(e) {
    console.error('Auto-place error:', e);
    alert('Auto-place failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '📌 Auto-place PBs'; }
  }
}

async function scanMapRegions() {
  // First ensure the map is registered as a SiteMap record
  let maps = await api.getAllSiteMaps().catch(() => ({data:[]}));
  let list = maps.data || [];

  if (list.length === 0) {
    // Try to register the existing uploaded map
    try {
      await api.registerExistingMap();
      maps = await api.getAllSiteMaps();
      list = maps.data || [];
    } catch(e) {
      console.warn('register attempt failed:', e);
    }
  }

  if (list.length === 0) {
    alert('No site maps found. Upload a map first.');
    return;
  }
  const mapId = list[0].id;

  const btn = document.getElementById('scan-map-btn');
  if (btn) { btn.disabled = true; btn.textContent = '🔄 Scanning...'; }

  try {
    const r = await api.scanMap(mapId, mapPBs.length || 119);
    detectedScanRegions = r.data || [];
    scanAssignments = {};

    // Auto-assign detected regions to power blocks
    if (mapPBs.length > 0 && detectedScanRegions.length > 0) {
      autoAssignRegionsToPBs();
    }

    renderScanOverlays();
    if (btn) {
      btn.disabled = false;
      btn.textContent = `✅ ${detectedScanRegions.length} regions found`;
    }

    // If we auto-assigned, show save prompt
    const assigned = Object.keys(scanAssignments).length;
    if (assigned > 0) {
      const saveBtn = document.getElementById('save-scan-btn');
      if (saveBtn) saveBtn.style.display = '';
      const clearBtn = document.getElementById('clear-scan-btn');
      if (clearBtn) clearBtn.style.display = '';
    }
  } catch(e) {
    alert('Scan failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Auto-detect PB Regions'; }
  }
}

function autoAssignRegionsToPBs() {
  // Sort regions left-to-right, top-to-bottom (row-major)
  const sorted = detectedScanRegions.map((r, i) => ({...r, idx: i}));
  // Group into rows (regions with similar y_pct)
  sorted.sort((a, b) => a.y_pct - b.y_pct);
  const ROW_THRESHOLD = 2.0; // % tolerance for same row
  const rows = [];
  let currentRow = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y_pct - currentRow[0].y_pct) < ROW_THRESHOLD) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
    }
  }
  rows.push(currentRow);

  // Sort each row left-to-right
  rows.forEach(row => row.sort((a, b) => a.x_pct - b.x_pct));

  // Flatten back into order
  const orderedRegions = rows.flat();

  // Sort PBs by block number
  const sortedPBs = [...mapPBs].sort((a, b) => {
    const na = parseInt(a.power_block_number || a.name.replace(/\D/g, '')) || 0;
    const nb = parseInt(b.power_block_number || b.name.replace(/\D/g, '')) || 0;
    return na - nb;
  });

  // Assign by position order up to min(regions, PBs)
  const limit = Math.min(orderedRegions.length, sortedPBs.length);
  for (let i = 0; i < limit; i++) {
    scanAssignments[orderedRegions[i].idx] = sortedPBs[i].name;
  }
}

function renderScanOverlays() {
  const container = document.getElementById('scan-region-overlays');
  const mapImg    = document.getElementById('sitemap-image');
  if (!container || !mapImg) return;

  container.innerHTML = '';
  const saveBtn  = document.getElementById('save-scan-btn');
  const clearBtn = document.getElementById('clear-scan-btn');
  if (saveBtn)  saveBtn.style.display  = detectedScanRegions.length > 0 ? '' : 'none';
  if (clearBtn) clearBtn.style.display = detectedScanRegions.length > 0 ? '' : 'none';
  detectedScanRegions.forEach((reg, i) => {
    const div = document.createElement('div');
    const assigned = scanAssignments[i];
    const borderCol = assigned ? '#28a745' : '#007bff';
    const bgCol = assigned ? 'rgba(40,167,69,0.12)' : 'rgba(0,123,255,0.08)';
    div.style.cssText = `
      position:absolute;
      left:${reg.x_pct}%;top:${reg.y_pct}%;
      width:${reg.w_pct}%;height:${reg.h_pct}%;
      border:2px dashed ${borderCol};
      background:${bgCol};
      border-radius:3px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      pointer-events:auto;
    `;
    div.title = assigned ? `Assigned to ${assigned}. Click to change.` : 'Click to assign this region to a PB';
    const labelCol = assigned ? '#28a745' : '#007bff';
    div.innerHTML = `<span style="background:rgba(255,255,255,0.9);font-size:9px;padding:1px 4px;border-radius:2px;color:${labelCol};font-weight:${assigned?'700':'400'};">${assigned || '?'}</span>`;
    div.onclick = () => assignScanRegion(i);
    container.appendChild(div);
  });
}

function assignScanRegion(regionIndex) {
  if (!mapPBs || mapPBs.length === 0) { alert('Load the map first.'); return; }
  const options = mapPBs.map((pb,i) => `${i+1}. ${pb.name}`).join('\n');
  const input   = prompt(`Assign region #${regionIndex+1} to which PB?\n${options}\n\nType the PB name:`);
  if (!input) return;
  const found = mapPBs.find(pb => pb.name.toLowerCase() === input.trim().toLowerCase());
  if (!found) { alert('PB not found: ' + input); return; }
  scanAssignments[regionIndex] = found.name;
  renderScanOverlays();
}

async function saveScanRegions() {
  let maps = await api.getAllSiteMaps().catch(() => ({data:[]}));
  let list = maps.data || [];
  if (list.length === 0) {
    try {
      await api.registerExistingMap();
      maps = await api.getAllSiteMaps();
      list = maps.data || [];
    } catch(e) {}
  }
  if (list.length === 0) { alert('No site maps.'); return; }
  const mapId = list[0].id;

  // Save bboxes to localStorage for marker rendering
  const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');

  let saved = 0, skipped = 0;
  for (let i = 0; i < detectedScanRegions.length; i++) {
    const pbName = scanAssignments[i];
    if (!pbName) { skipped++; continue; }
    const pb = mapPBs.find(p => p.name.toLowerCase() === pbName.toLowerCase());
    if (!pb) { skipped++; continue; }
    const reg = detectedScanRegions[i];

    // Store bbox so renderPBMarkers can size markers to fit
    bboxes[String(pb.id)] = {
      x: reg.x_pct,
      y: reg.y_pct,
      w: reg.w_pct,
      h: reg.h_pct
    };

    await api.createSiteArea({
      site_map_id:    mapId,
      power_block_id: pb.id,
      name:           pbName,
      bbox_x:         reg.x_pct, bbox_y: reg.y_pct,
      bbox_w:         reg.w_pct, bbox_h: reg.h_pct,
      label_font_size: adminSettings.pb_label_font_size || 14
    }).catch(() => {});
    saved++;
  }

  localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));

  detectedScanRegions = [];
  scanAssignments = {};
  renderScanOverlays();
  renderPBMarkers();   // re-render with new bboxes
  alert(`Saved ${saved} regions. Skipped ${skipped} unassigned.`);
}

async function clearScanOverlays() {
  detectedScanRegions = [];
  scanAssignments = {};
  renderScanOverlays();

  // Clear saved bboxes so markers go back to default circles
  localStorage.removeItem('pb_bboxes');
  localStorage.removeItem('pb_positions');
  localStorage.removeItem('pb_label_offsets');
  pbLabelOffsets = {};
  // Also clear polygon shapes
  pbPolygons = {};
  localStorage.removeItem('pb_polygons');

  // Delete saved areas from the DB
  try {
    const maps = await api.getAllSiteMaps().catch(() => ({data:[]}));
    const list = maps.data || [];
    for (const m of list) {
      await api.deleteAllAreas(m.id).catch(() => {});
    }
  } catch(e) { console.warn('Could not clear DB areas:', e); }

  // Re-render markers as default circles
  renderPBMarkers();

  // Hide clear button, reset autoplace button
  const clearBtn = document.getElementById('clear-scan-btn');
  if (clearBtn) clearBtn.style.display = 'none';
  const autoBtn = document.getElementById('autoplace-btn');
  if (autoBtn) { autoBtn.disabled = false; autoBtn.textContent = '📌 Auto-place PBs'; }
}

// ── OTA Update tab ──────────────────────────────────────────────
async function loadUpdateTab() {
  const el = document.getElementById('update-current-version');
  if (!el) return;
  el.textContent = 'Loading...';
  try {
    const r = await fetch('/api/version', { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    el.innerHTML = `<strong>Current published version:</strong> <span style="font-family:monospace;color:#1565c0;">${d.version}</span>`
      + (d.download_url ? ` &nbsp;·&nbsp; <a href="${d.download_url}" target="_blank" style="font-size:12px;">Download link</a>` : '');
  } catch(e) {
    el.textContent = 'Could not load version info: ' + e.message;
  }
}

async function uploadNewEXE() {
  const versionEl = document.getElementById('update-new-version');
  const fileEl    = document.getElementById('update-exe-file');
  const statusEl  = document.getElementById('update-upload-status');
  const version = versionEl ? versionEl.value.trim() : '';
  if (!version) { if (statusEl) statusEl.textContent = '⚠ Please enter a version number.'; return; }
  if (!fileEl || !fileEl.files[0]) { if (statusEl) statusEl.textContent = '⚠ Please select an .exe file.'; return; }
  if (statusEl) statusEl.textContent = 'Uploading…';
  const fd = new FormData();
  fd.append('version', version);
  fd.append('exe', fileEl.files[0]);
  try {
    const r = await fetch('/api/update/upload', { method: 'POST', credentials: 'include', body: fd });
    const d = await r.json();
    if (r.ok) {
      if (statusEl) statusEl.innerHTML = `✅ Published v${d.version} successfully.`;
      if (versionEl) versionEl.value = '';
      if (fileEl) fileEl.value = '';
      loadUpdateTab();
    } else {
      if (statusEl) statusEl.textContent = '❌ ' + (d.error || 'Upload failed');
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = '❌ Network error: ' + e.message;
  }
}

// ── User Role Management (Admin Only) ─────────────────────────
const PRIVILEGE_LABELS = {
  claim_create: '✅ Create Claims',
  claim_edit: '✏️ Edit Claims',
  claim_delete: '🗑️ Delete Claims',
  upload_pdf: '📤 Upload PDF',
  edit_map: '🗺️ Edit Map',
  manage_trackers: '📋 Manage Trackers',
  manage_tracker_names: '🏷️ Manage Names',
  manage_columns: '📊 Manage Columns',
  manage_tasks: '🧩 Manage Tasks',
  manage_blocks: '📦 Manage Blocks',
  manage_workers: '👷 Manage Workers',
  view_reports: '📊 View Reports',
  manage_ui: '🎨 Manage UI / Colors',
  admin_settings: '🔒 Review Admin',
};

let roleDefinitionsByKey = {};

function formatRoleLabel(roleKey) {
  const key = String(roleKey || '').trim();
  return roleDefinitionsByKey[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()) || 'Worker';
}

async function loadUsersTab() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  container.innerHTML = '<p style="color:#777;">Loading users…</p>';
  try {
    const [res, auditResponse] = await Promise.all([
      fetch('/api/auth/users', {credentials:'include'}),
      api.getAuditLogs(250).catch(() => ({ data: [] })),
    ]);
    if (!res.ok) { container.innerHTML = '<p style="color:#ff4c6a;">Failed to load users.</p>'; return; }
    const data = await res.json();
    const users = data.users || [];
    const allPrivs = data.all_privileges || Object.keys(PRIVILEGE_LABELS);
    const roles = Array.isArray(data.roles) ? data.roles : [];
    roleDefinitionsByKey = roles.reduce((accumulator, role) => {
      accumulator[role.key] = role;
      return accumulator;
    }, {});
    const recentPinResets = buildRecentPinResetMap(auditResponse.data || []);

    if (!users.length) { container.innerHTML = '<p style="color:#777;">No users found.</p>'; return; }

    container.innerHTML = users.map(u => {
      const isMainAdmin = u.username === 'admin';
      const role = u.role || (u.is_admin ? 'admin' : 'user');
      const perms = u.permissions || [];
      const lastPinReset = recentPinResets.get(String(u.id));
      const lastPinResetLabel = lastPinReset
        ? `Last PIN reset ${formatAdminAuditTimestamp(lastPinReset.created_at)} by ${lastPinReset.actor_name || 'Admin'}`
        : 'No PIN reset recorded yet';

      let roleBadge = '';
      if (isMainAdmin) {
        roleBadge = '<span style="font-size:10px;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:4px;padding:2px 8px;font-weight:700;">ADMIN</span>';
      } else {
        roleBadge = `<span style="font-size:10px;background:rgba(124,108,252,0.15);color:#7c6cfc;border:1px solid rgba(124,108,252,0.3);border-radius:4px;padding:2px 8px;font-weight:700;">${_escapeHtml(u.role_label || formatRoleLabel(role)).toUpperCase()}</span>`;
      }

      let controls = '';
      if (!isMainAdmin) {
        controls = `
          <div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
            <label style="font-size:12px;color:#aaa;">Role:</label>
            <select id="role-select-${u.id}" onchange="onRoleChange(${u.id})" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(7,9,26,0.8);color:#eef2ff;">
              ${roles.map((roleOption) => `<option value="${_escapeHtml(roleOption.key)}" ${role===roleOption.key?'selected':''}>${_escapeHtml(roleOption.label)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-top:8px;font-size:11px;color:#94a3b8;">${roleDefinitionsByKey[role]?.claim_eligible ? 'Shows up in claim crew pickers.' : 'Does not show up in claim crew pickers.'}</div>
          <div id="perms-${u.id}" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
            ${allPrivs.map(p => {
              const checked = perms.includes(p) ? 'checked' : '';
              const label = PRIVILEGE_LABELS[p] || p;
              return `<label style="font-size:11px;display:flex;align-items:center;gap:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:4px 10px;cursor:pointer;">
                <input type="checkbox" data-user="${u.id}" data-perm="${p}" ${checked} onchange="saveUserRole(${u.id})" style="accent-color:#7c6cfc;"> ${label}
              </label>`;
            }).join('')}
          </div>`;
      }

      return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 18px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <strong style="font-size:14px;color:#eef2ff;">${u.name}</strong>
          ${roleBadge}
          <span style="font-size:11px;color:#555;margin-left:auto;">@${u.username}</span>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#8892b0;">Forgot PIN? Reset it here, then tell the user to sign in with the new PIN.</div>
        <div style="margin-top:4px;font-size:11px;color:${lastPinReset ? '#aeb8d6' : '#6f7d9b'};">${_escapeHtml(lastPinResetLabel)}</div>
        ${controls}
        ${!isMainAdmin ? `
          <div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
            <label style="font-size:12px;color:#aaa;">Reset PIN:</label>
            <input id="pin-reset-${u.id}" type="password" maxlength="4" inputmode="numeric" placeholder="0000" style="width:88px;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(7,9,26,0.8);color:#eef2ff;">
            <button class="btn btn-secondary" onclick="resetUserPin(${u.id}, '${_escapeHtml(u.name)}')" style="padding:6px 10px;font-size:11px;">Save New PIN</button>
          </div>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = '<p style="color:#ff4c6a;">Error: ' + e.message + '</p>';
  }
}

function onRoleChange(userId) {
  const sel = document.getElementById('role-select-' + userId);
  if (sel) {
    const defaults = roleDefinitionsByKey[sel.value]?.default_permissions || [];
    const defaultSet = new Set(defaults);
    document.querySelectorAll(`#perms-${userId} input[type="checkbox"]`).forEach(cb => {
      cb.checked = defaultSet.has(cb.dataset.perm);
    });
  }
  saveUserRole(userId);
}

async function saveUserRole(userId) {
  const sel = document.getElementById('role-select-' + userId);
  if (!sel) return;
  const role = sel.value;
  const perms = [];
  document.querySelectorAll(`#perms-${userId} input[type="checkbox"]`).forEach(cb => {
    if (cb.checked) perms.push(cb.dataset.perm);
  });

  try {
    const res = await fetch(`/api/auth/users/${userId}/role`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ role, permissions: perms })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update role');
    }
  } catch(e) {
    alert('Network error: ' + e.message);
  }
}

async function resetUserPin(userId, userName) {
  const input = document.getElementById(`pin-reset-${userId}`);
  const pin = (input?.value || '').trim();
  if (!/^\d{4}$/.test(pin)) {
    alert('PIN must be exactly 4 digits.');
    return;
  }

  try {
    const res = await fetch(`/api/auth/users/${userId}/pin`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to reset PIN');
      return;
    }
    if (input) input.value = '';
    loadUsersTab();
    alert(data.message || `PIN updated for ${userName}`);
  } catch (e) {
    alert('Network error: ' + e.message);
  }
}

function showCreateUserForm() {
  document.getElementById('create-user-form').classList.remove('hidden');
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-pin').value = '';
  document.getElementById('new-user-job-token').value = '';
  document.getElementById('create-user-error').classList.add('hidden');
}

function hideCreateUserForm() {
  document.getElementById('create-user-form').classList.add('hidden');
}

async function createUser() {
  const name = document.getElementById('new-user-name').value.trim();
  const pin = document.getElementById('new-user-pin').value.trim();
  const jobToken = document.getElementById('new-user-job-token').value.trim();
  const errEl = document.getElementById('create-user-error');

  if (!name) { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); return; }
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { errEl.textContent = 'PIN must be 4 digits'; errEl.classList.remove('hidden'); return; }
  if (!jobToken) { errEl.textContent = 'Job token is required'; errEl.classList.remove('hidden'); return; }

  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ name, pin, job_token: jobToken })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to create user';
      errEl.classList.remove('hidden');
      return;
    }
    hideCreateUserForm();
    loadUsersTab();
    alert(data.message || 'User created. Contact Princess if the PIN ever needs to be reset.');
  } catch(e) {
    errEl.textContent = 'Network error: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

// ============================================================
// LOGIN CANVAS ANIMATION — Lightning bolts, sparks, charge rings
// ============================================================
let _loginAnimId = null;
let _loginBolts = [];
let _loginSparks = [];
let _loginChargePhase = 0;
let _loginStartTime = 0;

function startLoginAnimation() {
  const canvas = document.getElementById('login-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }
  resize();
  window._loginResize = resize;
  window.addEventListener('resize', resize);

  _loginStartTime = performance.now();
  _loginBolts = [];
  _loginSparks = [];

  const W = () => canvas.offsetWidth;
  const H = () => canvas.offsetHeight;
  const cx = () => W() / 2;
  const cy = () => H() / 2;

  // --- Helper: create a multi-segment bolt from point to point with jitter ---
  function makeBoltPath(x0, y0, x1, y1, steps, jitter) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jx = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * jitter * (1 - Math.abs(t - 0.5) * 0.5);
      const jy = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * jitter * (1 - Math.abs(t - 0.5) * 0.5);
      pts.push({ x: x0 + (x1 - x0) * t + jx, y: y0 + (y1 - y0) * t + jy });
    }
    return pts;
  }

  function spawnBolt() {
    // Bolts come from the edges/corners and strike the center area
    const edge = Math.floor(Math.random() * 4);
    const w = W(), h = H();
    let sx, sy;
    switch(edge) {
      case 0: sx = Math.random() * w; sy = 0; break;
      case 1: sx = w; sy = Math.random() * h; break;
      case 2: sx = Math.random() * w; sy = h; break;
      default: sx = 0; sy = Math.random() * h; break;
    }
    // Strike target: near center with some spread
    const tx = cx() + (Math.random() - 0.5) * w * 0.35;
    const ty = cy() + (Math.random() - 0.5) * h * 0.35;
    const steps = 10 + Math.floor(Math.random() * 8);
    const jitter = 55 + Math.random() * 55;
    const segments = makeBoltPath(sx, sy, tx, ty, steps, jitter);

    // Optional branch off midpoint
    const branches = [];
    if (Math.random() > 0.35) {
      const bi = Math.floor(steps * 0.3 + Math.random() * steps * 0.4);
      const bp = segments[bi];
      const bAngle = Math.atan2(ty - sy, tx - sx) + (Math.random() - 0.5) * 1.4;
      const bLen = 50 + Math.random() * 90;
      branches.push(makeBoltPath(bp.x, bp.y, bp.x + Math.cos(bAngle) * bLen, bp.y + Math.sin(bAngle) * bLen, 5, 20));
    }

    const isCyan = Math.random() > 0.4;
    return {
      segments, branches,
      life: 1.0,
      decay: 0.008 + Math.random() * 0.008,
      width: 2.5 + Math.random() * 2.5,
      color: isCyan ? '#00d4ff' : '#b0aaff',
      glow: isCyan ? 'rgba(0,212,255,0.8)' : 'rgba(124,108,252,0.8)'
    };
  }

  function spawnSpark(x, y, color) {
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3.5;
      _loginSparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.012 + Math.random() * 0.018,
        size: 1.5 + Math.random() * 2.5,
        color: color || (Math.random() > 0.5 ? '#00d4ff' : '#b0aaff')
      });
    }
  }

  let nextBoltTime = 0;
  let sparkAccum = 0;

  function frame(now) {
    const w = W(), h = H();
    ctx.clearRect(0, 0, w, h);
    const elapsed = (now - _loginStartTime) / 1000;

    // Draw ambient glow beams from edges toward center
    for (let i = 0; i < 3; i++) {
      const angle = (elapsed * 0.3 + i * Math.PI * 2 / 3) % (Math.PI * 2);
      const dist = Math.max(w, h) * 0.7;
      const ex = cx() + Math.cos(angle) * dist;
      const ey = cy() + Math.sin(angle) * dist;
      const grd = ctx.createLinearGradient(ex, ey, cx(), cy());
      grd.addColorStop(0, 'transparent');
      grd.addColorStop(0.6, `rgba(0,212,255,${0.04 + Math.sin(elapsed + i) * 0.02})`);
      grd.addColorStop(1, `rgba(0,212,255,0.06)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }

    // Spawn bolts
    if (now > nextBoltTime) {
      const n = 1 + (Math.random() > 0.6 ? 1 : 0); // occasionally 2 at once
      for (let i = 0; i < n; i++) _loginBolts.push(spawnBolt());
      nextBoltTime = now + 400 + Math.random() * 500;
    }

    // More sparks from center area
    sparkAccum += 0.6;
    while (sparkAccum >= 1) {
      sparkAccum--;
      const sa = Math.random() * Math.PI * 2;
      const sr = 20 + Math.random() * 70;
      spawnSpark(cx() + Math.cos(sa) * sr, cy() + Math.sin(sa) * sr);
    }

    // Charge rings (multiple, pulsing)
    for (let ri = 0; ri < 3; ri++) {
      const phase = ((now / (1800 - ri * 300)) + ri * 0.33) % 1;
      const rr = 55 + ri * 28 + Math.sin(phase * Math.PI * 2) * 12;
      const ra = 0.12 + Math.sin(phase * Math.PI * 2) * 0.08;
      ctx.save();
      ctx.strokeStyle = ri === 1 ? `rgba(124,108,252,${ra})` : `rgba(0,212,255,${ra})`;
      ctx.lineWidth = 1.5 - ri * 0.3;
      ctx.shadowColor = ri === 1 ? '#7c6cfc' : '#00d4ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(cx(), cy(), rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Draw bolts
    for (let i = _loginBolts.length - 1; i >= 0; i--) {
      const bolt = _loginBolts[i];
      bolt.life -= bolt.decay;
      if (bolt.life <= 0) {
        // Spawn sparks at tip when bolt dies
        const tip = bolt.segments[bolt.segments.length - 1];
        spawnSpark(tip.x, tip.y, bolt.color);
        _loginBolts.splice(i, 1);
        continue;
      }

      const alpha = bolt.life;
      ctx.save();
      // Outer glow pass
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = bolt.glow;
      ctx.lineWidth = bolt.width * 3.5 * bolt.life;
      ctx.shadowColor = bolt.color;
      ctx.shadowBlur = 30;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      bolt.segments.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // Core bright pass
      ctx.globalAlpha = alpha * 0.95;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = bolt.width * 0.7 * Math.min(1, bolt.life * 2);
      ctx.shadowBlur = 6;
      ctx.beginPath();
      bolt.segments.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // colored mid pass
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = bolt.width * bolt.life;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      bolt.segments.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // Branches
      bolt.branches.forEach(branch => {
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = bolt.color;
        ctx.lineWidth = bolt.width * 0.5 * bolt.life;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        branch.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      });
      ctx.restore();
    }

    // Draw sparks
    for (let i = _loginSparks.length - 1; i >= 0; i--) {
      const s = _loginSparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.96;
      s.vy *= 0.96;
      s.life -= s.decay;
      if (s.life <= 0) { _loginSparks.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = s.life * 0.85;
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Central radial glow
    const pulse = 0.05 + Math.sin(elapsed * 2.5) * 0.02;
    const grd2 = ctx.createRadialGradient(cx(), cy(), 0, cx(), cy(), 160);
    grd2.addColorStop(0, `rgba(0,212,255,${pulse})`);
    grd2.addColorStop(0.5, `rgba(124,108,252,${pulse * 0.4})`);
    grd2.addColorStop(1, 'transparent');
    ctx.fillStyle = grd2;
    ctx.fillRect(0, 0, w, h);

    _loginAnimId = requestAnimationFrame(frame);
  }

  _loginAnimId = requestAnimationFrame(frame);
}

function stopLoginAnimation() {
  if (_loginAnimId) { cancelAnimationFrame(_loginAnimId); _loginAnimId = null; }
  if (window._loginResize) { window.removeEventListener('resize', window._loginResize); window._loginResize = null; }
}

function playLoginExplosion(callback) {
  const canvas = document.getElementById('login-canvas');
  if (!canvas) { if (callback) callback(); return; }
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  const ccx = w / 2, ccy = h / 2;

  // Stop normal anim
  if (_loginAnimId) { cancelAnimationFrame(_loginAnimId); _loginAnimId = null; }

  // Explosion particles
  const particles = [];
  for (let i = 0; i < 120; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    particles.push({
      x: ccx, y: ccy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      decay: 0.008 + Math.random() * 0.012,
      size: 2 + Math.random() * 4,
      color: ['#00d4ff', '#7c6cfc', '#00e87a', '#fff'][Math.floor(Math.random() * 4)]
    });
  }

  // Shockwave rings
  const rings = [
    { r: 0, maxR: Math.max(w, h), speed: 12, width: 3, opacity: 0.6, color: '#00d4ff' },
    { r: 0, maxR: Math.max(w, h), speed: 8, width: 2, opacity: 0.4, color: '#7c6cfc' }
  ];

  // Logo flash
  const logo = document.getElementById('login-logo');
  if (logo) { logo.style.filter = 'brightness(3) drop-shadow(0 0 40px #00d4ff)'; logo.style.transform = 'scale(1.3)'; }

  let frame = 0;
  function explodeFrame() {
    frame++;
    ctx.clearRect(0, 0, w, h);

    // Flash overlay
    if (frame < 8) {
      ctx.fillStyle = `rgba(0,212,255,${0.3 * (1 - frame / 8)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Rings
    rings.forEach(ring => {
      ring.r += ring.speed;
      if (ring.r < ring.maxR) {
        const a = ring.opacity * (1 - ring.r / ring.maxR);
        ctx.save();
        ctx.strokeStyle = ring.color;
        ctx.globalAlpha = a;
        ctx.lineWidth = ring.width;
        ctx.beginPath();
        ctx.arc(ccx, ccy, ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    // Particles
    let alive = 0;
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= p.decay;
      if (p.life <= 0) return;
      alive++;
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    if (alive > 0 || frame < 60) {
      requestAnimationFrame(explodeFrame);
    } else {
      if (logo) { logo.style.filter = ''; logo.style.transform = ''; }
      if (callback) callback();
    }
  }

  requestAnimationFrame(explodeFrame);
}


// ============================================================
// MAP DELETE MODE — click to instantly delete, with undo
// ============================================================
let mapDeleteMode = false;
let _lastDeletedArea = null;

function toggleDeleteMode() {
  mapDeleteMode = !mapDeleteMode;
  const btn = document.getElementById('delete-mode-btn');
  const indicator = document.getElementById('delete-mode-indicator');
  if (mapDeleteMode) {
    btn.textContent = '✅ Done Deleting';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    indicator.style.display = '';
    closePBPanel();
  } else {
    btn.textContent = '🗑️ Delete Mode';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-danger');
    indicator.style.display = 'none';
  }
  renderPBMarkers();
  renderTextLabels();
}

async function instantDeleteArea(pb) {
  const pbKey = String(pb.id);
  // Find the area record for this PB
  const area = loadedMapAreas.find(a => a.power_block_id === pb.id);
  if (!area) { console.warn('No area found for PB', pb.id); return; }

  // Save for undo
  _lastDeletedArea = {
    areaId: area.id,
    pb: pb,
    pbKey: pbKey,
    bbox: JSON.parse(localStorage.getItem('pb_bboxes') || '{}')[pbKey],
    polygon: pbPolygons[pbKey],
    labelColor: pbLabelColors[pbKey],
    areaData: area
  };

  // Remove from local state
  const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  delete bboxes[pbKey];
  localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
  delete pbPolygons[pbKey];
  localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));
  delete pbLabelColors[pbKey];
  localStorage.setItem('pb_label_colors', JSON.stringify(pbLabelColors));
  loadedMapAreas = loadedMapAreas.filter(a => a.id !== area.id);

  // Remove from DOM immediately
  const marker = document.getElementById(`pb-marker-${pb.id}`);
  if (marker) marker.remove();

  // Delete on server
  try {
    await api.deleteSiteArea(area.id);
  } catch(e) { console.error('Server delete failed:', e); }

  // Show undo toast
  showUndoToast(`Deleted ${pb.name}`, async () => {
    const saved = _lastDeletedArea;
    if (!saved) return;
    // Re-create on server
    try {
      const newArea = await api.createSiteArea({
        site_map_id: saved.areaData.site_map_id,
        power_block_id: saved.pb.id,
        name: saved.areaData.name,
        bbox_x: saved.bbox ? saved.bbox.x : 0,
        bbox_y: saved.bbox ? saved.bbox.y : 0,
        bbox_w: saved.bbox ? saved.bbox.w : 1.4,
        bbox_h: saved.bbox ? saved.bbox.h : 5.0,
        polygon_points: saved.polygon ? JSON.stringify(saved.polygon) : null,
        label_color: saved.labelColor || null,
        zone: saved.areaData.zone || null
      });
      // Restore local state
      if (saved.bbox) {
        const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
        bboxes[saved.pbKey] = saved.bbox;
        localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
      }
      if (saved.polygon) {
        pbPolygons[saved.pbKey] = saved.polygon;
        localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));
      }
      if (saved.labelColor) {
        pbLabelColors[saved.pbKey] = saved.labelColor;
        localStorage.setItem('pb_label_colors', JSON.stringify(pbLabelColors));
      }
      clearPBHiddenState(saved.pb.id);
      if (newArea.data) loadedMapAreas.push(newArea.data);
      renderPBMarkers();
    } catch(e) { console.error('Undo failed:', e); }
    _lastDeletedArea = null;
  });
}

let _undoToastTimer = null;
function showUndoToast(message, undoCallback) {
  // Remove old toast
  const old = document.querySelector('.undo-toast');
  if (old) old.remove();
  clearTimeout(_undoToastTimer);

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `<span>${message}</span><button class="undo-btn" id="undo-toast-btn">UNDO</button>`;
  document.body.appendChild(toast);

  document.getElementById('undo-toast-btn').addEventListener('click', () => {
    toast.remove();
    clearTimeout(_undoToastTimer);
    if (undoCallback) undoCallback();
  });

  _undoToastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
    _lastDeletedArea = null;
  }, 6000);
}


// ============================================================
// ZONE FILTER — filter markers by zone
// ============================================================
let activeZoneFilter = null; // null = show all

function buildZoneFilter() {
  const bar = document.getElementById('zone-filter-bar');
  if (!bar) return;

  const zones = new Set();
  loadedMapAreas.forEach(a => { if (a.zone) zones.add(a.zone); });

  if (zones.size === 0) { bar.style.display = 'none'; return; }

  bar.style.display = 'flex';
  const sortedZones = [...zones].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, '')) || 0;
    const nb = parseInt(b.replace(/\D/g, '')) || 0;
    return na - nb || a.localeCompare(b);
  });

  let html = `<span class="zone-chip ${activeZoneFilter === null ? 'active' : ''}" onclick="setZoneFilter(null)">All</span>`;
  sortedZones.forEach(z => {
    html += `<span class="zone-chip ${activeZoneFilter === z ? 'active' : ''}" onclick="setZoneFilter('${z.replace(/'/g, "\\'")}')">${z}</span>`;
  });
  bar.innerHTML = html;
}

function setZoneFilter(zone) {
  activeZoneFilter = zone;
  buildZoneFilter();
  applyZoneFilter();
  zoomToZone(zone);
}

function applyZoneFilter() {
  if (!activeZoneFilter) {
    // Show all markers
    document.querySelectorAll('#pb-markers > div').forEach(m => { m.style.display = ''; });
    return;
  }
  // Find PB IDs that belong to the selected zone
  const zonePbIds = new Set();
  loadedMapAreas.forEach(a => {
    if (a.zone === activeZoneFilter && a.power_block_id) {
      zonePbIds.add(a.power_block_id);
    }
  });
  document.querySelectorAll('#pb-markers > div').forEach(m => {
    const pbId = parseInt(m.dataset.pbId);
    m.style.display = zonePbIds.has(pbId) ? '' : 'none';
  });
}


// ============================================================
// FLOATING PARTICLES (subtle ambient effect on pages)
// ============================================================
(function initFloatingParticles() {
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.createElement('div');
    container.className = 'floating-particles';
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.setProperty('--dur', (6 + Math.random() * 10) + 's');
      p.style.setProperty('--delay', (Math.random() * 8) + 's');
      p.style.setProperty('--max-opacity', (0.15 + Math.random() * 0.25).toFixed(2));
      p.style.background = Math.random() > 0.6 ? '#7c6cfc' : '#00d4ff';
      p.style.width = (1 + Math.random() * 2) + 'px';
      p.style.height = p.style.width;
      container.appendChild(p);
    }
    document.body.appendChild(container);
  });
})();


// ── Auto-start login animation on DOMContentLoaded ──
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('login-overlay');
  if (overlay && overlay.style.display === 'flex') {
    startLoginAnimation();
  }
});


// ============================================================
// ZONE MAP ZOOM — zoom map into zone bounding box
// ============================================================
function zoomToZone(zone) {
  const mapOuter = document.getElementById('map-outer');
  const mapContainer = document.getElementById('map-container');
  const img = document.getElementById('sitemap-image');
  if (!mapOuter || !mapContainer || !img) return;

  if (!zone) {
    // Reset: remove transform, restore scroll
    mapContainer.style.transition = 'transform 0.45s cubic-bezier(0.4,0,0.2,1)';
    mapContainer.style.transformOrigin = '0 0';
    mapContainer.style.transform = 'translate(0px, 0px) scale(1)';
    mapOuter.style.overflow = 'auto';
    setTimeout(() => { mapOuter.scrollTo({ left: 0, top: 0, behavior: 'smooth' }); }, 50);
    return;
  }

  // Collect PB ids in this zone
  const zonePbIds = new Set();
  loadedMapAreas.forEach(a => { if (a.zone === zone) zonePbIds.add(a.power_block_id); });
  if (!zonePbIds.size) return;

  const storedBboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  zonePbIds.forEach(pbId => {
    const b = storedBboxes[String(pbId)];
    if (!b) return;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  });
  if (!isFinite(minX)) return;

  // Tight 3% padding for precise focus
  const pad = 3;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(100, maxX + pad);
  maxY = Math.min(100, maxY + pad);

  const zoneW = maxX - minX;
  const zoneH = maxY - minY;
  if (zoneW <= 0 || zoneH <= 0) return;

  const outerW = mapOuter.clientWidth;
  const outerH = mapOuter.clientHeight;
  const imgW = img.offsetWidth;
  const imgH = img.offsetHeight;

  // Zone rectangle in image pixels
  const absX = (minX / 100) * imgW;
  const absY = (minY / 100) * imgH;
  const absW = (zoneW / 100) * imgW;
  const absH = (zoneH / 100) * imgH;

  // Center of zone in image pixels
  const cx = absX + absW / 2;
  const cy = absY + absH / 2;

  // Scale to fill ~90% of the outer container — allow up to 7× zoom
  const scaleX = (outerW * 0.90) / absW;
  const scaleY = (outerH * 0.90) / absH;
  const scale = Math.min(scaleX, scaleY, 7);

  // With transform-origin 0 0:
  //   a point at (px, py) appears at (px*s + tx, py*s + ty) in outer coords
  //   we want zone center (cx, cy) → outer center (outerW/2, outerH/2)
  const tx = outerW / 2 - cx * scale;
  const ty = outerH / 2 - cy * scale;

  // Freeze scroll and drive entirely with CSS transform
  mapOuter.scrollTo(0, 0);
  mapOuter.style.overflow = 'hidden';
  mapContainer.style.transformOrigin = '0 0';
  mapContainer.style.transition = 'transform 0.52s cubic-bezier(0.4,0,0.2,1)';
  mapContainer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}


// ============================================================
// ZONE ADMIN TAB — manage zones and assign areas
// ============================================================
let _adminZoneNames = [];   // list of defined zone name strings

async function loadZonesTab() {
  // Zone names already loaded via loadAdminSettings() — just render them.
  renderZoneNamesList();
  // Also show existing zone assignments as a summary
  try {
    const r = await api.getAllSiteMaps();
    const maps = r.data || [];
    const areas = [];
    maps.forEach(m => { if (m.areas) m.areas.forEach(a => areas.push(a)); });
    renderZoneAssignments(areas);
  } catch(e) {
    const c = document.getElementById('admin-zone-assignments');
    if (c) c.innerHTML = `<p style="color:#ff4c6a;">Failed to load: ${e.message}</p>`;
  }
}

function renderZoneNamesList() {
  const container = document.getElementById('zone-names-list');
  if (!container) return;
  if (_adminZoneNames.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">No zones defined yet. Add one above.</span>';
    return;
  }
  container.innerHTML = _adminZoneNames.map(z =>
    `<span class="zone-name-chip">${z}<button onclick="removeZoneName('${z.replace(/'/g,"\\'")}')">✕</button></span>`
  ).join('');
}

function _saveZoneNames() {
  api.saveZoneNames(_adminZoneNames).catch(e => console.warn('Failed to save zone names:', e));
}

function addZoneName() {
  const inp = document.getElementById('new-zone-name');
  const val = inp.value.trim();
  if (!val) return;
  if (_adminZoneNames.includes(val)) { inp.value = ''; return; }
  _adminZoneNames.push(val);
  _adminZoneNames.sort((a, b) => {
    const na = parseInt(a.replace(/\D/g,'')) || 0, nb = parseInt(b.replace(/\D/g,'')) || 0;
    return na - nb || a.localeCompare(b);
  });
  inp.value = '';
  renderZoneNamesList();
  _saveZoneNames();
}

function removeZoneName(name) {
  _adminZoneNames = _adminZoneNames.filter(z => z !== name);
  renderZoneNamesList();
  _saveZoneNames();
}

function refreshZoneSelect(sel) {
  const currentVal = sel.value;
  const areaId = sel.dataset.areaId;
  sel.innerHTML = `<option value="">— No Zone —</option>` +
    _adminZoneNames.map(z => `<option value="${z}" ${z === currentVal ? 'selected' : ''}>${z}</option>`).join('');
}

function renderZoneAssignments(areas) {
  const container = document.getElementById('admin-zone-assignments');
  if (!container) return;
  if (!areas || areas.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No areas placed on the map yet. Place areas via the Site Map editor first.</p>';
    return;
  }
  container.innerHTML = areas.map(area => {
    const opts = `<option value="">— No Zone —</option>` +
      _adminZoneNames.map(z => `<option value="${z}" ${area.zone === z ? 'selected' : ''}>${z}</option>`).join('');
    return `
      <div class="zone-assign-row">
        <span class="zone-assign-label">${area.name || area.power_block_id}</span>
        <select class="zone-area-select" data-area-id="${area.id}" onchange="saveAreaZone(this)">
          ${opts}
        </select>
      </div>`;
  }).join('');
}

async function saveAreaZone(sel) {
  const areaId = sel.dataset.areaId;
  const zone = sel.value || null;
  try {
    await api.updateSiteArea(areaId, { zone });
    // Update loadedMapAreas cache
    const idx = loadedMapAreas.findIndex(a => a.id == areaId);
    if (idx >= 0) loadedMapAreas[idx].zone = zone;
    // Rebuild zone filter if map is shown
    buildZoneFilter();
  } catch(e) {
    showAdminAlert('Failed to save zone: ' + e.message, 'error');
  }
}

// ============================================================
// ZONE ASSIGN MODE — toolbar button, click-on-map, range input
// ============================================================
let zoneAssignMode = false;

function toggleZoneAssignMode() {
  zoneAssignMode = !zoneAssignMode;
  const panel = document.getElementById('zone-assign-panel');
  const btn = document.getElementById('zone-assign-btn');
  if (zoneAssignMode) {
    panel.style.display = 'flex';
    if (btn) { btn.classList.add('btn-primary'); btn.classList.remove('btn-secondary'); }
    const sel = document.getElementById('zone-assign-select');
    if (sel) {
      sel.innerHTML = '<option value="">— Pick a Zone —</option>';
      if (_adminZoneNames.length === 0) {
        sel.innerHTML = '<option value="">⚠ Define zones in Admin → Zones first</option>';
      } else {
        sel.innerHTML += _adminZoneNames.map(z => `<option value="${z}">${z}</option>`).join('');
      }
    }
    closePBPanel();
  } else {
    panel.style.display = 'none';
    if (btn) { btn.classList.remove('btn-primary'); btn.classList.add('btn-secondary'); }
  }
  renderPBMarkers();
}

async function assignZoneToMarker(pb) {
  const zone = document.getElementById('zone-assign-select')?.value;
  if (!zone) {
    const sel = document.getElementById('zone-assign-select');
    if (sel) { sel.style.boxShadow = '0 0 0 2px #ff4c6a'; setTimeout(() => sel.style.boxShadow = '', 800); }
    return;
  }
  const area = loadedMapAreas.find(a => a.power_block_id === pb.id);
  if (!area) { showUndoToast(`No placed area for PB ${pb.name}`, null); return; }
  try {
    await api.updateSiteArea(area.id, { zone });
    const idx = loadedMapAreas.findIndex(a => a.id === area.id);
    if (idx >= 0) loadedMapAreas[idx].zone = zone;
    const marker = document.getElementById(`pb-marker-${pb.id}`);
    if (marker) {
      marker.style.outline = '3px solid #00e87a';
      marker.style.outlineOffset = '2px';
      setTimeout(() => { marker.style.outline = ''; marker.style.outlineOffset = ''; }, 700);
    }
    showZoneAssignFeedback(`✓ PB ${pb.name} → ${zone}`);
    buildZoneFilter();
  } catch(e) { console.error('Zone assign failed:', e); }
}

function showZoneAssignFeedback(msg) {
  const el = document.getElementById('zone-assign-feedback');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'inline';
  clearTimeout(el._feedbackTimer);
  el._feedbackTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

function parseBlockRange(str) {
  const nums = new Set();
  str.split(/[,;\s]+/).forEach(part => {
    const range = part.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
    if (range) {
      const lo = parseInt(range[1]), hi = parseInt(range[2]);
      for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) nums.add(n);
    } else {
      const n = parseInt(part);
      if (!isNaN(n)) nums.add(n);
    }
  });
  return [...nums];
}

async function assignByRange() {
  const zone = document.getElementById('zone-assign-select')?.value;
  const rangeStr = document.getElementById('zone-assign-range')?.value?.trim();
  if (!zone) { showZoneAssignFeedback('⚠ Pick a zone first'); return; }
  if (!rangeStr) { showZoneAssignFeedback('⚠ Enter a range like 1-5, 8-10'); return; }

  const wantedNums = new Set(parseBlockRange(rangeStr));
  if (!wantedNums.size) { showZoneAssignFeedback('⚠ No valid numbers found'); return; }

  const matched = mapPBs.filter(pb => {
    const num = parseInt((pb.power_block_number || pb.name.replace('INV-', '')).replace(/\D/g,''));
    return wantedNums.has(num);
  });
  if (!matched.length) { showZoneAssignFeedback('⚠ No matching PBs on current map'); return; }

  let count = 0;
  await Promise.all(matched.map(async pb => {
    const area = loadedMapAreas.find(a => a.power_block_id === pb.id);
    if (!area) return;
    try {
      await api.updateSiteArea(area.id, { zone });
      const idx = loadedMapAreas.findIndex(a => a.id === area.id);
      if (idx >= 0) loadedMapAreas[idx].zone = zone;
      count++;
      // Flash marker
      const marker = document.getElementById(`pb-marker-${pb.id}`);
      if (marker) {
        marker.style.outline = '3px solid #00e87a';
        marker.style.outlineOffset = '2px';
        setTimeout(() => { marker.style.outline = ''; marker.style.outlineOffset = ''; }, 1200);
      }
    } catch(e) { console.warn(`Zone assign PB ${pb.name}:`, e); }
  }));

  document.getElementById('zone-assign-range').value = '';
  showZoneAssignFeedback(`✓ ${count} block${count !== 1 ? 's' : ''} → ${zone}`);
  buildZoneFilter();
}

// Updated loadZonesTab → clean summary instead of 100-row dropdown list
async function loadZonesTab() {
  renderZoneNamesList();
  try {
    const r = await api.getAllSiteMaps();
    const maps = r.data || [];
    const areas = [];
    maps.forEach(m => { if (m.areas) m.areas.forEach(a => areas.push(a)); });
    renderZoneSummary(areas);
  } catch(e) {
    const c = document.getElementById('admin-zone-summary');
    if (c) c.innerHTML = `<p style="color:#ff4c6a;">Failed to load: ${e.message}</p>`;
  }
}

function renderZoneSummary(areas) {
  const container = document.getElementById('admin-zone-summary');
  if (!container) return;
  if (!areas.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No areas placed on map yet.</p>';
    return;
  }
  const zoneMap = {};
  areas.forEach(a => {
    const z = a.zone || null;
    if (!zoneMap[z]) zoneMap[z] = [];
    zoneMap[z].push(a);
  });
  let html = '';
  _adminZoneNames.forEach(z => {
    const list = zoneMap[z] || [];
    const names = list.map(a => a.name || `PB#${a.power_block_id}`).sort((a,b) => {
      const na = parseInt(a.replace(/\D/g,'')) || 0, nb = parseInt(b.replace(/\D/g,'')) || 0;
      return na - nb;
    }).join(', ');
    html += `<div class="zone-assign-row"><span class="zone-assign-label" style="color:var(--cyan);min-width:100px;">${z}</span><span style="font-size:12px;color:var(--text-muted);flex:2;">${list.length} block${list.length !== 1 ? 's' : ''}${names ? ': ' + names : ''}</span></div>`;
  });
  const unassigned = zoneMap[null] || [];
  if (unassigned.length) {
    const uNames = unassigned.map(a => a.name || `PB#${a.power_block_id}`).join(', ');
    html += `<div class="zone-assign-row" style="border-color:rgba(255,76,106,0.2);"><span class="zone-assign-label" style="color:rgba(255,76,106,0.7);min-width:100px;">Unassigned</span><span style="font-size:12px;color:var(--text-muted);flex:2;">${unassigned.length} blocks: ${uNames}</span></div>`;
  }
  container.innerHTML = html || '<p style="color:var(--text-muted);">No zones assigned yet.</p>';
}
