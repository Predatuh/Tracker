// API helper functions
const api = {
  async call(endpoint, options = {}) {
    const url = `/api${endpoint}`;
    const defaultOptions = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options
    };
    
    console.log(`API Call: ${endpoint}`, defaultOptions.body);
    
    const response = await fetch(url, defaultOptions);
    const data = await response.json();
    
    console.log(`API Response (${endpoint}):`, data);
    
    if (!response.ok) {
      const errorMsg = data.error || `HTTP ${response.status}`;
      console.error(`API Error: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return data;
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
    return this.call('/tracker/power-blocks');
  },

  getPowerBlock(id) {
    return this.call(`/tracker/power-blocks/${id}`);
  },

  createLBD(data) {
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

  // ---- Admin API ----
  getAdminSettings() { return this.call('/admin/settings'); },
  saveAdminColors(colors) {
    return this.call('/admin/settings/colors', { method:'PUT', body: JSON.stringify({colors}) });
  },
  saveAdminNames(names) {
    return this.call('/admin/settings/names', { method:'PUT', body: JSON.stringify({names}) });
  },
  addAdminColumn(key, label, color) {
    return this.call('/admin/settings/columns', { method:'POST', body: JSON.stringify({key,label,color}) });
  },
  deleteAdminColumn(key) {
    return this.call(`/admin/settings/columns/${key}`, { method:'DELETE' });
  },
  saveAdminFontSize(size) {
    return this.call('/admin/settings/font-size', { method:'PUT', body: JSON.stringify({size}) });
  },
  saveColumnOrder(order) {
    return this.call('/admin/settings/column-order', { method:'PUT', body: JSON.stringify({order}) });
  },
  bulkComplete(powerBlockId, statusTypes, isCompleted) {
    return this.call('/admin/bulk-complete', { method:'POST',
      body: JSON.stringify({ power_block_id: powerBlockId, status_types: statusTypes, is_completed: isCompleted })
    });
  },
  claimBlock(blockId, action) {
    return this.call(`/tracker/power-blocks/${blockId}/claim`, { method:'POST', body: JSON.stringify({ action }) });
  },

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
  }
};

// Page navigation
function showPage(pageName) {
  // Enforce permission checks for restricted pages
  const isAdmin = !!(currentUser && currentUser.is_admin);
  const role = currentUser ? (currentUser.role || 'user') : 'user';
  const perms = currentUser ? (currentUser.permissions || []) : [];
  const isAssistant = role === 'assistant_admin';

  if (pageName === 'upload' && !isAdmin && !(isAssistant && perms.includes('upload_pdf'))) {
    return;  // block access
  }
  if (pageName === 'admin' && !isAdmin && !(isAssistant && perms.includes('admin_settings'))) {
    return;
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show selected page
  document.getElementById(`page-${pageName}`).classList.add('active');
  
  // Load data for the page
  if (pageName === 'dashboard') loadDashboard();
  if (pageName === 'blocks') loadBlocks();
  if (pageName === 'sitemap') loadSiteMap();
  if (pageName === 'admin') loadAdminPage();
  if (pageName === 'worklog') loadWorkLogPage();
  if (pageName === 'reports') loadReportsPage();
}

// Modal functions
function closeModal() {
  document.getElementById('block-modal').classList.add('hidden');
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

async function claimBlock(blockId, action) {
  try {
    await api.claimBlock(blockId, action);
    loadBlockLBDs(blockId);
  } catch(e) { alert('Error: ' + e.message); }
}

function _fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch(e) { return iso; }
}

function _buildClaimedBanner(block) {
  const claimed   = block.claimed_by;
  const claimedAt = block.claimed_at ? _fmtDate(block.claimed_at) : '';
  const lastBy    = block.last_updated_by;
  const lastAt    = block.last_updated_at ? _fmtDate(block.last_updated_at) : '';

  let claimPart = '';
  if (claimed) {
    claimPart = '<span style="color:#1565c0;font-weight:600;">&#128204; Claimed by ' + claimed + '</span>'
      + '<span style="color:#666;font-size:11px;"> &mdash; ' + claimedAt + '</span>';
    if (currentUser && currentUser.name === claimed) {
      claimPart += ' <button onclick="claimBlock(' + block.id + ',\'unclaim\')" '
        + 'style="margin-left:8px;background:#dc3545;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">&#x2715; Release</button>';
    }
  } else {
    claimPart = '<span style="color:#999;font-size:12px;">Unclaimed</span>';
    if (currentUser) {
      claimPart += ' <button onclick="claimBlock(' + block.id + ',\'claim\')" '
        + 'style="margin-left:8px;background:#1976d2;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">&#128204; Claim</button>';
    }
  }

  let lastPart = '';
  if (lastBy) {
    lastPart = '<div style="margin-top:5px;color:#555;font-size:11px;">&#9998; Last updated by <strong>' + lastBy + '</strong> &mdash; ' + lastAt + '</div>';
  }

  return '<div id="pb-claimed-banner" style="margin-bottom:12px;padding:9px 14px;background:#e8f5e9;border-radius:6px;border:1px solid #c8e6c9;">'
    + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">' + claimPart + '</div>' + lastPart + '</div>';
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

// Dashboard
async function loadDashboard() {
  try {
    const response = await api.getPowerBlocks();
    const blocks = response.data;
    
    let totalLBDs = 0;
    let completedBlocks = 0;
    
    blocks.forEach(block => {
      totalLBDs += block.lbd_count;
      if (block.is_completed) completedBlocks++;
    });
    
    document.getElementById('stat-blocks').textContent = blocks.length;
    document.getElementById('stat-blocks-complete').textContent = `${completedBlocks} completed`;
    document.getElementById('stat-lbds').textContent = totalLBDs;
    document.getElementById('stat-lbds-progress').textContent = `${totalLBDs} tracked`;
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

// Blocks list
async function loadBlocks() {
  try {
    const response = await api.getPowerBlocks();
    const blocks = Array.isArray(response.data) ? response.data : response;

    let html = '';
    if (!blocks || blocks.length === 0) {
      html = '<p style="color: #999; text-align: center; padding: 40px;">No power blocks. Upload a PDF and scan it first!</p>';
    } else {
      const cols = LBD_STATUS_TYPES;

      blocks.forEach(block => {
        const total = block.lbd_count || 0;
        const summary = block.lbd_summary || {};
        const lbds = block.lbds || [];
        const allDone = total > 0 && cols.every(c => (summary[c] || 0) >= total);
        const claimed = block.claimed_by ? `<span class="pb-claimed-pill">👤 ${block.claimed_by}</span>` : '';

        // Overall completion
        const totalSteps = cols.length * total;
        const doneSteps = cols.reduce((s, c) => s + (summary[c] || 0), 0);
        const overallPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

        // Per-status summary rows
        let statusRows = '';
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

        // Individual LBD table
        let lbdTable = '';
        if (lbds.length > 0) {
          // Short column header labels
          const hdrSize = parseInt(localStorage.getItem('pbHeaderSize') || '11');
          const headerCells = cols.map(col => {
            const color = STATUS_COLORS[col] || '#555';
            const label = STATUS_LABELS[col] || col;
            return `<th class="lbd-tbl-th" style="color:${color};font-size:${hdrSize}px;white-space:nowrap;" title="${label}">${label}</th>`;
          }).join('');

          const dataRows = lbds.map(lbd => {
            // Build a quick lookup of status_type -> is_completed
            const statusMap = {};
            (lbd.statuses || []).forEach(s => { statusMap[s.status_type] = s.is_completed; });

            const lbdAllDone = cols.every(c => statusMap[c]);
            const cells = cols.map(col => {
              const done = statusMap[col];
              const color = STATUS_COLORS[col] || '#555';
              return done
                ? `<td class="lbd-tbl-td"><span class="lbd-dot lbd-dot--on" style="background:${color}" title="Done"></span></td>`
                : `<td class="lbd-tbl-td"><span class="lbd-dot lbd-dot--off" title="Not done"></span></td>`;
            }).join('');

            const name = lbd.identifier || lbd.name || `LBD ${lbd.id}`;
            return `<tr class="lbd-tbl-row${lbdAllDone ? ' lbd-tbl-row--done' : ''}">
              <td class="lbd-tbl-name" title="${lbd.inventory_number || name}">${name}</td>${cells}
            </tr>`;
          }).join('');

          lbdTable = `
            <div class="lbd-tbl-wrap">
              <table class="lbd-tbl">
                <thead><tr><th class="lbd-tbl-name-th"></th>${headerCells}</tr></thead>
                <tbody>${dataRows}</tbody>
              </table>
            </div>`;
        }

        html += `
          <div class="block-card${allDone ? ' block-card--complete' : ''}">
            <div class="pb-card-header">
              <span class="pb-card-name">${block.name}</span>
              <span class="pb-card-meta">${total} LBD${total !== 1 ? 's' : ''}${claimed}</span>
            </div>
            <div class="pb-overall-bar-wrap" title="Overall: ${overallPct}% complete">
              <div class="pb-overall-bar-fill" style="width:${overallPct}%"></div>
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
  } catch (err) {
    console.error('Error loading blocks:', err);
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
  document.getElementById('sitemap-upload-section').classList.add('hidden');
  const display = document.getElementById('sitemap-display');
  display.classList.remove('hidden');
  display.style.display = 'flex';
  document.getElementById('sitemap-image').src = mapUrl;
  // markers are rendered by onMapImageLoaded()
}

async function loadSiteMap() {
  // Always fetch the canonical map URL from the server to avoid stale cache
  try {
    const response = await fetch('/api/pdf/get-map');
    const data = await response.json();
    if (data.success && data.map_url) {
      localStorage.setItem('siteMapUrl', data.map_url);
      currentMapPath = data.map_url;
      displaySiteMap(data.map_url);
    } else {
      // Fall back to localStorage if server has no map
      const savedUrl = localStorage.getItem('siteMapUrl');
      if (savedUrl) displaySiteMap(savedUrl);
    }
  } catch (err) {
    console.log('No map from server, using cache:', err);
    const savedUrl = localStorage.getItem('siteMapUrl');
    if (savedUrl) displaySiteMap(savedUrl);
  }
  // Always (re)load power blocks for the map
  try {
    const resp = await api.getPowerBlocks();
    mapPBs = Array.isArray(resp.data) ? resp.data : [];

    // Load saved site area bboxes from the DB if not in localStorage
    const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
    if (Object.keys(bboxes).length === 0) {
      try {
        const maps = await api.getAllSiteMaps();
        const list = maps.data || [];
        if (list.length > 0 && list[0].areas) {
          for (const area of list[0].areas) {
            if (area.power_block_id && area.bbox_x != null) {
              bboxes[String(area.power_block_id)] = {
                x: area.bbox_x,
                y: area.bbox_y,
                w: area.bbox_w,
                h: area.bbox_h
              };
              // Also load polygon data if available
              if (area.polygon && area.polygon.length >= 3) {
                pbPolygons[String(area.power_block_id)] = area.polygon;
              }
            }
          }
          if (Object.keys(bboxes).length > 0) {
            localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));
          }
          if (Object.keys(pbPolygons).length > 0) {
            localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));
          }
        }
      } catch(e) { console.log('No site areas to load:', e); }
    }

    renderPBMarkers();
  } catch (e) {
    console.error('Failed loading PBs for map:', e);
  }
}

// ============================================================
// INTERACTIVE MAP
// ============================================================
let LBD_STATUS_TYPES = ['ground_brackets', 'stuff', 'term', 'quality_check', 'quality_docs'];

// An LBD counts as complete when term is checked
function isLBDComplete(lbd) {
  const statuses = lbd.statuses || [];
  return statuses.some(s => s.status_type === 'term' && s.is_completed);
}
let STATUS_COLORS = {
  ground_brackets: '#95E1D3',
  stuff:           '#FF6B6B',
  term:            '#4ECDC4',
  quality_check:   '#A8E6CF',
  quality_docs:    '#56AB91'
};
let STATUS_LABELS = {
  ground_brackets: 'Bracket/Ground',
  stuff:           'Stuffed',
  term:            'Termed',
  quality_check:   'Quality Check',
  quality_docs:    'Quality Docs'
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
  _applyRoleUI();
  _initSocket();
}

function _applyRoleUI() {
  const isAdmin = !!(currentUser && currentUser.is_admin);
  const role = currentUser ? (currentUser.role || 'user') : 'user';
  const perms = currentUser ? (currentUser.permissions || []) : [];
  const isAssistant = role === 'assistant_admin';

  // Full admins see everything with .admin-only
  document.querySelectorAll('.admin-only').forEach(el => {
    const requiredPerm = el.dataset.perm; // e.g. data-perm="upload_pdf"
    if (isAdmin) {
      el.style.display = '';
    } else if (isAssistant && requiredPerm && perms.includes(requiredPerm)) {
      el.style.display = '';
    } else if (isAssistant && !requiredPerm) {
      // assistant admins see generic admin-only items only if they have any perms
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // Items that ONLY the main admin can see (not assistant admins)
  document.querySelectorAll('.main-admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  const ui = document.getElementById('user-info');
  if (ui) {
    if (currentUser) {
      const initials = currentUser.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      let badge = '';
      if (isAdmin) {
        badge = `<span style="font-size:9px;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:4px;padding:1px 6px;font-weight:700;letter-spacing:0.5px;">ADMIN</span>`;
      } else if (isAssistant) {
        badge = `<span style="font-size:9px;background:rgba(124,108,252,0.15);color:#7c6cfc;border:1px solid rgba(124,108,252,0.3);border-radius:4px;padding:1px 6px;font-weight:700;letter-spacing:0.5px;">ASST ADMIN</span>`;
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
function showLoginModal() {
  const o = document.getElementById('login-overlay');
  if (o) { o.style.display = 'flex'; }
}

function switchLoginTab(tab) {
  const isSignin = tab === 'signin';
  const siBtn = document.getElementById('tab-signin-btn');
  const regBtn = document.getElementById('tab-register-btn');
  const submitBtn = document.getElementById('login-submit-btn');
  if (siBtn)  { siBtn.style.color  = isSignin ? '#00d4ff' : '#4a5568'; siBtn.style.borderBottomColor  = isSignin ? '#00d4ff' : 'transparent'; }
  if (regBtn) { regBtn.style.color = isSignin ? '#4a5568' : '#00d4ff'; regBtn.style.borderBottomColor = isSignin ? 'transparent' : '#00d4ff'; }
  if (submitBtn) submitBtn.textContent = isSignin ? 'Sign In' : 'Create Account';
  submitBtn._mode = tab;
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';
}

async function submitLogin() {
  const nameEl = document.getElementById('login-name');
  const pinEl  = document.getElementById('login-pin');
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-submit-btn');
  const name   = (nameEl.value || '').trim();
  const pin    = (pinEl.value || '').trim();
  const mode   = btn._mode || 'signin';

  if (errEl) errEl.style.display = 'none';
  if (!name || !pin) { _loginError('Please enter your name and PIN'); return; }

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const r = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin })
    });
    const d = await r.json();
    if (!r.ok) { _loginError(d.error || 'Error'); } else {
      currentUser = d.user;
      document.getElementById('login-overlay').style.display = 'none';
      _applyRoleUI();
      _initSocket();
    }
  } catch(e) { _loginError('Network error — try again'); }

  btn.disabled = false;
  btn.textContent = mode === 'register' ? 'Create Account' : 'Sign In';
}

function _loginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  currentUser = null;
  _applyRoleUI();
  if (_socket) { _socket.disconnect(); _socket = null; }
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
    }
    renderPBMarkers();
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
      renderPBMarkers();
      if (activePBId === data.pb_id) showPBPanel(r.data);
    }).catch(() => {});
  });

  _socket.on('claim_update', function(data) {
    const pb = mapPBs.find(p => p.id === data.pb_id);
    if (pb) { pb.claimed_by = data.claimed_by; pb.claimed_at = data.claimed_at; }
    if (activePBId === data.pb_id) {
      const banner = document.getElementById('pb-claimed-banner');
      if (banner && pb) banner.outerHTML = _buildClaimedBanner(pb);
    }
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
  } catch(e) { console.warn('Admin settings not loaded:', e); }
  renderLegend();
}

function renderLegend() {
  const el = document.getElementById('legend-items');
  if (!el) return;
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

// Snap threshold in % of map dimensions
const SNAP_THRESHOLD = 1.2;

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

    if (!result.success && result.error) {
      showSnapFeedback('⚠ ' + result.error, 'warn');
      if (container) container.style.cursor = 'crosshair';
      return;
    }

    const polygon = result.polygon;
    const bbox = result.bbox;

    if (!polygon || polygon.length < 3) {
      showSnapFeedback('⚠ No outline detected at that position. Try again.', 'warn');
      if (container) container.style.cursor = 'crosshair';
      return;
    }

    // Store polygon and bbox
    pbPolygons[String(pbId)] = polygon;
    localStorage.setItem('pb_polygons', JSON.stringify(pbPolygons));

    const bboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
    bboxes[String(pbId)] = {
      x: bbox.x_pct,
      y: bbox.y_pct,
      w: bbox.w_pct,
      h: bbox.h_pct
    };
    localStorage.setItem('pb_bboxes', JSON.stringify(bboxes));

    // Save to DB
    api.createSiteArea({
      site_map_id: snapPlaceMapId,
      power_block_id: pbId,
      name: pb.name,
      bbox_x: bbox.x_pct, bbox_y: bbox.y_pct,
      bbox_w: bbox.w_pct, bbox_h: bbox.h_pct,
      polygon: polygon,
      label_font_size: adminSettings.pb_label_font_size || 14
    }).catch(err => console.warn('area save:', err));

    // Advance queue
    snapPlaceQueue.shift();

    const msg = result.fallback
      ? `📍 ${pb.name} placed (no outline detected — default box used)`
      : `✅ ${pb.name} placed!`;
    showSnapFeedback(msg, result.fallback ? 'warn' : 'ok');

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

  const savedBboxes = JSON.parse(localStorage.getItem('pb_bboxes') || '{}');
  const hiddenPBs   = JSON.parse(localStorage.getItem('pb_hidden') || '[]');

  mapPBs.forEach((pb, i) => {
    if (hiddenPBs.includes(pb.id)) return;
    const key = String(pb.id);
    // Default grid layout for PBs that haven't been placed yet
    const col = i % 16;
    const row = Math.floor(i / 16);
    const defaultBbox = {
      x: col * (DEFAULT_PB_W + 0.3) + 1,
      y: row * (DEFAULT_PB_H + 0.5) + 1,
      w: DEFAULT_PB_W,
      h: DEFAULT_PB_H
    };
    const bbox = savedBboxes[key] || defaultBbox;

    const lbds = pb.lbds || [];
    const total = pb.lbd_count || lbds.length || 0;
    const summary = pb.lbd_summary || {};

    // Determine which status types are fully complete (all LBDs done)
    const completedTypes = [];
    const partialTypes = [];
    for (const st of LBD_STATUS_TYPES) {
      const done = summary[st] || 0;
      if (total > 0 && done >= total) {
        completedTypes.push(st);
      } else if (done > 0) {
        partialTypes.push(st);
      }
    }

    const allDone = total > 0 && lbds.filter(l => isLBDComplete(l)).length === total;
    const inProgress = completedTypes.length > 0 || partialTypes.length > 0;
    const isActive = false; // markers always render the same regardless of selection
    const num = (pb.power_block_number || pb.name.replace('INV-', '')).toString();

    // Build background
    let bgStyle;
    if (allDone) {
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

    const borderColor = allDone ? '#1e7e34' : inProgress ? '#d39e00' : '#555';

    const m = document.createElement('div');
    m.id = `pb-marker-${pb.id}`;
    m.dataset.pbId = pb.id;

    // All markers are rectangles
    const pbFontOverride = parseInt(localStorage.getItem('pb_font_size') || '0');
    const fontSize = pbFontOverride > 0 ? pbFontOverride : Math.max(7, Math.min(24, bbox.w * 0.35));
    m.style.cssText = [
      'position:absolute',
      `left:${bbox.x}%`,
      `top:${bbox.y}%`,
      `width:${bbox.w}%`,
      `height:${bbox.h}%`,
      `background:${bgStyle}`,
      `border:${isActive ? '3px solid #fff' : '2px solid ' + borderColor}`,
      `box-shadow:${isActive ? '0 0 0 3px #0d6efd,0 4px 14px rgba(0,0,0,.6)' : '0 2px 6px rgba(0,0,0,.3)'}`,
      'border-radius:4px',
      'display:flex;flex-direction:column;align-items:center;justify-content:center',
      'color:white;font-weight:700',
      `font-size:${fontSize}px`,
      `cursor:${mapEditMode ? 'grab' : 'pointer'}`,
      'user-select:none',
      'z-index:20',
      'text-align:center;line-height:1.1',
      'overflow:hidden',
      'text-shadow:0 1px 2px rgba(0,0,0,0.5)',
      'padding:1px'
    ].join(';');

    // Apply polygon clip-path if this PB has been snap-placed (only in view mode)
    const polyData = pbPolygons[key];
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
      m.style.filter = `drop-shadow(0 0 1.5px ${borderColor}) drop-shadow(0 0 0.5px #000)`;
    }

    // Tooltip with full info
    const statusInfo = LBD_STATUS_TYPES.map(st => {
      const done = summary[st] || 0;
      return `${STATUS_LABELS[st] || st}: ${done}/${total}`;
    }).join(' | ');
    m.title = `PB ${pb.name} — ${total} LBDs\n${statusInfo}`;

    // PB number — auto-fit: shrink font if text overflows the marker
    const numSpan = document.createElement('span');
    numSpan.textContent = num;
    numSpan.style.cssText = 'white-space:nowrap;overflow:hidden;max-width:100%;text-overflow:clip;';
    m.appendChild(numSpan);

    // "In Progress" indicator
    if (inProgress && !allDone) {
      const ipSpan = document.createElement('span');
      ipSpan.textContent = 'In Progress';
      const ipFontSize = Math.max(5, Math.min(12, fontSize * 0.45));
      ipSpan.style.cssText = `font-size:${ipFontSize}px;opacity:0.9;white-space:nowrap;margin-top:1px;letter-spacing:0.3px;max-width:100%;overflow:hidden;`;
      m.appendChild(ipSpan);
    }

    // After appending to DOM, check if text overflows and shrink to fit
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      if (!m.parentNode || !m.clientWidth) return;
      let fs = fontSize;
      const maxW = m.clientWidth - 2; // account for padding
      const maxH = m.clientHeight - 2;
      while (fs > 5 && (numSpan.scrollWidth > maxW || numSpan.scrollHeight > maxH * 0.75)) {
        fs -= 0.5;
        m.style.fontSize = fs + 'px';
      }
    }); });

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
    } else {
      // View mode: click fetches fresh data and opens panel
      m.style.cursor = 'pointer';
      m.addEventListener('click', async () => {
        // Intercept click in snap-place clear-one mode
        if (snapClearOneMode && pbPolygons[String(pb.id)]) {
          snapClearOnePB(pb);
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
    }

    container.appendChild(m);
  });
  syncHiddenBtn();
}

function toggleMapEditMode() {
  mapEditMode = !mapEditMode;
  const btn = document.getElementById('edit-mode-btn');
  const hint = document.getElementById('map-edit-hint');
  if (mapEditMode) {
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
  }
  renderPBMarkers();
  renderTextLabels();
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
      `cursor:${mapEditMode ? 'grab' : 'default'}`,
      'text-shadow:0 1px 3px rgba(255,255,255,0.8)'
    ].join(';');
    el.textContent = lbl.text;
    el.title = mapEditMode ? 'Drag to move • Right-click to edit/delete' : lbl.text;

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

function showPBPanel(pb) {
  activePBId = pb.id;
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
  document.getElementById('lbd-panel-bar-fill').style.width = pct + '%';
  document.getElementById('lbd-panel-bar-fill').style.background =
    pct >= 100 ? '#28a745' : pct > 0 ? '#ffc107' : '#dc3545';

  // Build grid template: LBD label column + one column per status type
  const colCount = LBD_STATUS_TYPES.length;
  const gridCols = `70px repeat(${colCount}, 1fr)`;

  // Header row + bulk row
  const headerEl = document.getElementById('lbd-grid-header');
  headerEl.innerHTML = `
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
  const marker = document.getElementById('pb-marker-' + pb.id);
  if (!marker) return;
  const lbds = pb.lbds || [];
  const total = pb.lbd_count || lbds.length || 0;
  const summary = pb.lbd_summary || {};
  const completedTypes = [], partialTypes = [];
  for (const st of LBD_STATUS_TYPES) {
    const d = summary[st] || 0;
    if (total > 0 && d >= total) completedTypes.push(st);
    else if (d > 0) partialTypes.push(st);
  }
  const allDone = total > 0 && lbds.filter(l => isLBDComplete(l)).length === total;
  let bgStyle;
  if (allDone) bgStyle = '#28a745';
  else if (completedTypes.length >= 2) {
    const colors = completedTypes.map(t => STATUS_COLORS[t] || '#999');
    const step = 100 / colors.length;
    bgStyle = 'linear-gradient(135deg, ' + colors.map((c, i) => c + ' ' + Math.round(i*step) + '%, ' + c + ' ' + Math.round((i+1)*step) + '%').join(', ') + ')';
  } else if (completedTypes.length === 1) bgStyle = STATUS_COLORS[completedTypes[0]] || '#ffc107';
  else if (partialTypes.length > 0) bgStyle = '#ffc107';
  else bgStyle = '#6c757d';
  const borderColor = allDone ? '#1e7e34' : (completedTypes.length > 0 || partialTypes.length > 0) ? '#d39e00' : '#555';
  marker.style.background = bgStyle;
  if (!marker.style.clipPath || marker.style.clipPath === 'none') marker.style.borderColor = borderColor;
  else marker.style.filter = 'drop-shadow(0 0 1.5px ' + borderColor + ') drop-shadow(0 0 0.5px #000)';
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
// WORK LOG PAGE
// ============================================================
let wl_workers = [];
let wl_blocks = [];
let wl_selectedWorkers = [];
let wl_selectedTask = '';
let wl_selectedBlocks = new Set();
let wl_date = new Date().toISOString().slice(0, 10);

async function loadWorkLogPage() {
  const el = document.getElementById('worklog-content');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Date picker -->
      <div class="form-section" style="padding:16px 20px;">
        <label style="font-size:12px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;">Date</label>
        <input type="date" id="wl-date" value="${wl_date}" onchange="wl_date=this.value; wl_loadEntries()"
          style="margin-left:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#eef2ff;border-radius:6px;padding:6px 12px;font-family:Inter,sans-serif;" />
      </div>

      <!-- Workers -->
      <div class="form-section" style="padding:16px 20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <label style="font-size:12px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;">👷 Workers</label>
          <button onclick="wl_addWorker()" style="background:linear-gradient(135deg,#00d4ff,#009abc);color:#000;border:none;border-radius:6px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer;">+ Add Worker</button>
        </div>
        <div id="wl-workers" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
      </div>

      <!-- Tasks -->
      <div class="form-section" style="padding:16px 20px;">
        <label style="font-size:12px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;display:block;">🔧 Task</label>
        <div id="wl-tasks" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
      </div>

      <!-- Power Blocks -->
      <div class="form-section" style="padding:16px 20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <label style="font-size:12px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;">⚡ Power Blocks</label>
          <div style="display:flex;gap:6px;">
            <button onclick="wl_selectAllBlocks()" style="background:rgba(0,212,255,0.12);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:5px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">All</button>
            <button onclick="wl_clearBlocks()" style="background:rgba(255,76,106,0.1);color:#ff4c6a;border:1px solid rgba(255,76,106,0.3);border-radius:5px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">None</button>
          </div>
        </div>
        <div id="wl-blocks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;"></div>
      </div>

      <!-- Submit -->
      <div style="display:flex;gap:12px;align-items:center;">
        <button onclick="wl_submit()" style="background:linear-gradient(135deg,#00e87a,#00b35f);color:#000;border:none;border-radius:8px;padding:12px 32px;font-size:14px;font-weight:800;cursor:pointer;">✓ Log Work</button>
        <span id="wl-status" style="font-size:13px;color:#8892b0;"></span>
      </div>

      <!-- Today's entries -->
      <div class="form-section" style="padding:16px 20px;">
        <label style="font-size:12px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;display:block;">📝 Entries for <span id="wl-entries-date"></span></label>
        <div id="wl-entries"></div>
      </div>
    </div>`;

  // Load data
  try {
    const [workersRes, blocksRes] = await Promise.all([
      api.call('/workers'),
      api.call('/tracker/power-blocks')
    ]);
    wl_workers = (workersRes.data || []).filter(w => w.is_active);
    wl_blocks = Array.isArray(blocksRes.data) ? blocksRes.data : [];
  } catch(e) { console.error('WorkLog load error:', e); }

  wl_renderWorkers();
  wl_renderTasks();
  wl_renderBlocks();
  wl_loadEntries();
}

function wl_renderWorkers() {
  const el = document.getElementById('wl-workers');
  if (!el) return;
  el.innerHTML = wl_workers.map(w => {
    const sel = wl_selectedWorkers.includes(w.id);
    return `<button onclick="wl_toggleWorker(${w.id})" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid ${sel ? '#00d4ff' : 'rgba(255,255,255,0.12)'};background:${sel ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)'};color:${sel ? '#00d4ff' : '#8892b0'};">${w.name}</button>`;
  }).join('');
}

function wl_toggleWorker(id) {
  const idx = wl_selectedWorkers.indexOf(id);
  if (idx >= 0) wl_selectedWorkers.splice(idx, 1);
  else wl_selectedWorkers.push(id);
  wl_renderWorkers();
}

async function wl_addWorker() {
  const name = prompt('Worker name:');
  if (!name || !name.trim()) return;
  try {
    await api.call('/workers', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    const r = await api.call('/workers');
    wl_workers = (r.data || []).filter(w => w.is_active);
    wl_renderWorkers();
  } catch(e) { alert('Error: ' + e.message); }
}

function wl_renderTasks() {
  const el = document.getElementById('wl-tasks');
  if (!el) return;
  const tasks = LBD_STATUS_TYPES;
  el.innerHTML = tasks.map(t => {
    const sel = wl_selectedTask === t;
    const color = STATUS_COLORS[t] || '#888';
    const label = STATUS_LABELS[t] || t.replace(/_/g, ' ');
    return `<button onclick="wl_selectedTask='${t}';wl_renderTasks()" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid ${sel ? color : 'rgba(255,255,255,0.12)'};background:${sel ? color + '22' : 'rgba(255,255,255,0.04)'};color:${sel ? color : '#8892b0'};">${label}</button>`;
  }).join('');
}

function wl_renderBlocks() {
  const el = document.getElementById('wl-blocks');
  if (!el) return;
  el.innerHTML = wl_blocks.map(b => {
    const sel = wl_selectedBlocks.has(b.id);
    return `<button onclick="wl_toggleBlock(${b.id})" style="padding:6px 4px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;text-align:center;border:1.5px solid ${sel ? '#00d4ff' : 'rgba(255,255,255,0.1)'};background:${sel ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.03)'};color:${sel ? '#00d4ff' : '#8892b0'};">${b.name}</button>`;
  }).join('');
}

function wl_toggleBlock(id) {
  if (wl_selectedBlocks.has(id)) wl_selectedBlocks.delete(id);
  else wl_selectedBlocks.add(id);
  wl_renderBlocks();
}

function wl_selectAllBlocks() { wl_blocks.forEach(b => wl_selectedBlocks.add(b.id)); wl_renderBlocks(); }
function wl_clearBlocks() { wl_selectedBlocks.clear(); wl_renderBlocks(); }

async function wl_submit() {
  const statusEl = document.getElementById('wl-status');
  if (wl_selectedWorkers.length === 0) { statusEl.textContent = '⚠ Select at least one worker'; return; }
  if (!wl_selectedTask) { statusEl.textContent = '⚠ Select a task'; return; }
  if (wl_selectedBlocks.size === 0) { statusEl.textContent = '⚠ Select at least one power block'; return; }

  statusEl.textContent = 'Logging...';
  try {
    const entries = [];
    for (const wid of wl_selectedWorkers) {
      for (const bid of wl_selectedBlocks) {
        entries.push({ worker_id: wid, power_block_id: bid, task_type: wl_selectedTask, work_date: wl_date });
      }
    }
    await api.call('/work-entries', { method: 'POST', body: JSON.stringify({ entries }) });
    statusEl.textContent = `✓ Logged ${entries.length} entries`;
    wl_loadEntries();
  } catch(e) { statusEl.textContent = '✗ ' + e.message; }
}

async function wl_loadEntries() {
  const dateEl = document.getElementById('wl-entries-date');
  const el = document.getElementById('wl-entries');
  if (!el) return;
  if (dateEl) dateEl.textContent = wl_date;
  try {
    const r = await api.call(`/work-entries?date=${wl_date}`);
    const entries = r.data || [];
    if (entries.length === 0) {
      el.innerHTML = '<p style="color:#4a5568;text-align:center;padding:20px;">No entries for this date</p>';
      return;
    }
    // Group by worker
    const grouped = {};
    entries.forEach(e => {
      const key = e.worker_name || 'Unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    });
    let html = '';
    for (const [worker, wEntries] of Object.entries(grouped)) {
      html += `<div style="margin-bottom:12px;">
        <div style="font-weight:700;color:#eef2ff;font-size:13px;margin-bottom:6px;">👷 ${worker}</div>`;
      wEntries.forEach(e => {
        const color = STATUS_COLORS[e.task_type] || '#888';
        const label = STATUS_LABELS[e.task_type] || e.task_type;
        html += `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;margin-bottom:3px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="color:#a0aec0;font-size:12px;">${label}</span>
          <span style="color:#4a5568;font-size:11px;">→ ${e.power_block_name || 'PB ' + e.power_block_id}</span>
          <button onclick="wl_deleteEntry(${e.id})" style="margin-left:auto;background:none;border:none;color:#4a5568;cursor:pointer;font-size:11px;" title="Remove">✕</button>
        </div>`;
      });
      html += '</div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = `<p style="color:#ff4c6a;">Error loading entries: ${e.message}</p>`; }
}

async function wl_deleteEntry(id) {
  try {
    await api.call(`/work-entries/${id}`, { method: 'DELETE' });
    wl_loadEntries();
  } catch(e) { alert('Error: ' + e.message); }
}


// ============================================================
// REPORTS PAGE
// ============================================================
let rp_viewMode = 'list';  // 'list' | 'calendar'

async function loadReportsPage() {
  const el = document.getElementById('reports-content');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:20px;">
      <button id="rp-tab-list" onclick="rp_switchView('list')" style="padding:8px 20px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid #00d4ff;background:rgba(0,212,255,0.15);color:#00d4ff;">List</button>
      <button id="rp-tab-calendar" onclick="rp_switchView('calendar')" style="padding:8px 20px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#8892b0;">Calendar</button>
      <button onclick="rp_generate()" style="margin-left:auto;background:linear-gradient(135deg,#00d4ff,#009abc);color:#000;border:none;border-radius:6px;padding:8px 20px;font-size:12px;font-weight:700;cursor:pointer;">Generate Today's Report</button>
    </div>
    <div id="rp-body"></div>`;

  rp_switchView(rp_viewMode);
}

function rp_switchView(mode) {
  rp_viewMode = mode;
  // Update tab styles
  ['list', 'calendar'].forEach(m => {
    const btn = document.getElementById('rp-tab-' + m);
    if (btn) {
      const active = m === mode;
      btn.style.borderColor = active ? '#00d4ff' : 'rgba(255,255,255,0.12)';
      btn.style.background = active ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)';
      btn.style.color = active ? '#00d4ff' : '#8892b0';
    }
  });
  if (mode === 'list') rp_loadList();
  else rp_loadCalendar();
}

async function rp_generate() {
  try {
    await api.call('/reports/generate', { method: 'POST', body: JSON.stringify({}) });
    rp_switchView(rp_viewMode);
  } catch(e) { alert('Error: ' + e.message); }
}

async function rp_loadList() {
  const el = document.getElementById('rp-body');
  if (!el) return;
  el.innerHTML = '<p style="color:#8892b0;">Loading...</p>';
  try {
    const r = await api.call('/reports');
    const reports = r.data || [];
    if (reports.length === 0) {
      el.innerHTML = '<p style="color:#4a5568;text-align:center;padding:40px;">No reports yet. Generate one or log work entries first.</p>';
      return;
    }
    let html = '';
    reports.sort((a, b) => b.report_date.localeCompare(a.report_date));
    reports.forEach(rpt => {
      const d = new Date(rpt.report_date + 'T12:00:00');
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const workers = rpt.total_workers || 0;
      const tasks = rpt.total_tasks || 0;
      html += `<div onclick="rp_showDetail('${rpt.report_date}')" style="padding:14px 18px;margin-bottom:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='rgba(0,212,255,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;color:#eef2ff;font-size:14px;">${dateStr}</div>
            <div style="color:#8892b0;font-size:12px;margin-top:2px;">${workers} worker${workers !== 1 ? 's' : ''} · ${tasks} task-block entries</div>
          </div>
          <span style="color:#4a5568;font-size:18px;">›</span>
        </div>
      </div>`;
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = `<p style="color:#ff4c6a;">Error: ${e.message}</p>`; }
}

async function rp_loadCalendar() {
  const el = document.getElementById('rp-body');
  if (!el) return;
  el.innerHTML = '<p style="color:#8892b0;">Loading...</p>';
  try {
    const r = await api.call('/reports');
    const reports = r.data || [];
    const reportDates = new Set(reports.map(rp => rp.report_date));

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    let html = `<div style="text-align:center;font-weight:700;color:#eef2ff;font-size:16px;margin-bottom:14px;">${monthName}</div>`;
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;">';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
      html += `<div style="font-size:10px;font-weight:700;color:#4a5568;padding:6px 0;">${d}</div>`;
    });

    for (let i = 0; i < firstDay; i++) html += '<div></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasReport = reportDates.has(dateStr);
      const isToday = day === now.getDate();
      html += `<div onclick="${hasReport ? "rp_showDetail('" + dateStr + "')" : ''}" style="padding:8px 4px;border-radius:6px;cursor:${hasReport ? 'pointer' : 'default'};background:${isToday ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.02)'};border:1px solid ${isToday ? 'rgba(0,212,255,0.3)' : 'transparent'};">
        <div style="font-size:13px;color:${isToday ? '#00d4ff' : '#eef2ff'};font-weight:${isToday ? '700' : '400'};">${day}</div>
        ${hasReport ? '<div style="width:6px;height:6px;border-radius:50%;background:#00e87a;margin:4px auto 0;"></div>' : ''}
      </div>`;
    }
    html += '</div>';
    html += '<div id="rp-detail" style="margin-top:20px;"></div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = `<p style="color:#ff4c6a;">Error: ${e.message}</p>`; }
}

async function rp_showDetail(dateStr) {
  let detailEl = document.getElementById('rp-detail');
  // If inside list view, append detail area
  if (!detailEl) {
    const body = document.getElementById('rp-body');
    body.insertAdjacentHTML('beforeend', '<div id="rp-detail" style="margin-top:20px;"></div>');
    detailEl = document.getElementById('rp-detail');
  }
  detailEl.innerHTML = '<p style="color:#8892b0;">Loading report...</p>';
  try {
    const r = await api.call(`/reports/date/${dateStr}`);
    const rpt = r.data;
    if (!rpt) { detailEl.innerHTML = '<p style="color:#4a5568;">No report for this date.</p>'; return; }

    const data = rpt.data || {};
    const d = new Date(dateStr + 'T12:00:00');
    const dateTitle = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    let html = `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;">
      <h3 style="color:#eef2ff;margin:0 0 16px;font-size:16px;">📊 Report — ${dateTitle}</h3>`;

    // By worker
    const byWorker = data.by_worker || {};
    if (Object.keys(byWorker).length > 0) {
      html += '<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">By Worker</div>';
      for (const [worker, tasks] of Object.entries(byWorker)) {
        html += `<div style="margin-bottom:8px;padding:8px 12px;background:rgba(255,255,255,0.02);border-radius:6px;">
          <div style="font-weight:600;color:#eef2ff;font-size:13px;margin-bottom:4px;">👷 ${worker}</div>`;
        if (typeof tasks === 'object') {
          for (const [task, blocks] of Object.entries(tasks)) {
            const color = STATUS_COLORS[task] || '#888';
            const label = STATUS_LABELS[task] || task;
            const blockList = Array.isArray(blocks) ? blocks.join(', ') : blocks;
            html += `<div style="display:flex;align-items:center;gap:6px;margin-left:8px;margin-bottom:2px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
              <span style="color:#a0aec0;font-size:12px;">${label}:</span>
              <span style="color:#8892b0;font-size:11px;">${blockList}</span>
            </div>`;
          }
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // By task
    const byTask = data.by_task || {};
    if (Object.keys(byTask).length > 0) {
      html += '<div><div style="font-size:11px;font-weight:700;color:#8892b0;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">By Task</div>';
      for (const [task, workers] of Object.entries(byTask)) {
        const color = STATUS_COLORS[task] || '#888';
        const label = STATUS_LABELS[task] || task;
        html += `<div style="margin-bottom:6px;padding:6px 12px;background:rgba(255,255,255,0.02);border-radius:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>
          <span style="font-weight:600;color:#eef2ff;font-size:13px;">${label}</span>`;
        if (typeof workers === 'object') {
          for (const [w, blocks] of Object.entries(workers)) {
            const blockList = Array.isArray(blocks) ? blocks.join(', ') : blocks;
            html += `<div style="margin-left:22px;color:#8892b0;font-size:11px;">${w}: ${blockList}</div>`;
          }
        }
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    detailEl.innerHTML = html;
  } catch(e) { detailEl.innerHTML = `<p style="color:#ff4c6a;">Error: ${e.message}</p>`; }
}


// Keyboard shortcuts
document.addEventListener('DOMContentLoaded', () => {
  // Initialize tab state for login modal
  const submitBtn = document.getElementById('login-submit-btn');
  if (submitBtn) submitBtn._mode = 'signin';

  loadAdminSettings().then(() => loadDashboard());
  checkAuth().then(() => {
    // If nobody logged in, show the login overlay automatically
    if (!currentUser) showLoginModal();
  });
});

// ============================================================
// ADMIN PAGE
// ============================================================
async function loadAdminPage() {
  switchAdminTab('colors');
  try {
    const r = await api.getAdminSettings();
    const d = r.data;
    adminSettings = d;
    renderAdminColorRows(d.colors || {}, d.all_columns || LBD_STATUS_TYPES, d.names || {});
    renderAdminNameRows(d.names || {}, d.all_columns || LBD_STATUS_TYPES);
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
  document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
  const content = document.getElementById('admin-tab-' + tabKey);
  if (content) content.style.display = 'block';
  const btn = document.getElementById('atab-' + tabKey);
  if (btn) btn.classList.add('active');
  if (tabKey === 'updates') loadUpdateTab();
  if (tabKey === 'users') loadUsersTab();
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
  upload_pdf: '📤 Upload PDF',
  edit_map: '🗺️ Edit Map',
  manage_blocks: '📦 Manage Blocks',
  manage_workers: '👷 Manage Workers',
  view_reports: '📊 View Reports',
  admin_settings: '⚙️ Admin Settings',
};

async function loadUsersTab() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  container.innerHTML = '<p style="color:#777;">Loading users…</p>';
  try {
    const res = await fetch('/api/auth/users', {credentials:'include'});
    if (!res.ok) { container.innerHTML = '<p style="color:#ff4c6a;">Failed to load users.</p>'; return; }
    const data = await res.json();
    const users = data.users || [];
    const allPrivs = data.all_privileges || Object.keys(PRIVILEGE_LABELS);

    if (!users.length) { container.innerHTML = '<p style="color:#777;">No users found.</p>'; return; }

    container.innerHTML = users.map(u => {
      const isMainAdmin = u.username === 'admin';
      const role = u.role || (u.is_admin ? 'admin' : 'user');
      const perms = u.permissions || [];

      let roleBadge = '';
      if (isMainAdmin) {
        roleBadge = '<span style="font-size:10px;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.3);border-radius:4px;padding:2px 8px;font-weight:700;">ADMIN</span>';
      } else if (role === 'assistant_admin') {
        roleBadge = '<span style="font-size:10px;background:rgba(124,108,252,0.15);color:#7c6cfc;border:1px solid rgba(124,108,252,0.3);border-radius:4px;padding:2px 8px;font-weight:700;">ASST ADMIN</span>';
      } else {
        roleBadge = '<span style="font-size:10px;background:rgba(255,255,255,0.05);color:#888;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 8px;font-weight:600;">USER</span>';
      }

      let controls = '';
      if (!isMainAdmin) {
        controls = `
          <div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
            <label style="font-size:12px;color:#aaa;">Role:</label>
            <select id="role-select-${u.id}" onchange="onRoleChange(${u.id})" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(7,9,26,0.8);color:#eef2ff;">
              <option value="user" ${role==='user'?'selected':''}>User</option>
              <option value="assistant_admin" ${role==='assistant_admin'?'selected':''}>Assistant Admin</option>
            </select>
          </div>
          <div id="perms-${u.id}" style="margin-top:8px;display:${role==='assistant_admin'?'flex':'none'};flex-wrap:wrap;gap:6px;">
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
        ${controls}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = '<p style="color:#ff4c6a;">Error: ' + e.message + '</p>';
  }
}

function onRoleChange(userId) {
  const sel = document.getElementById('role-select-' + userId);
  const permsDiv = document.getElementById('perms-' + userId);
  if (sel && permsDiv) {
    permsDiv.style.display = sel.value === 'assistant_admin' ? 'flex' : 'none';
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
