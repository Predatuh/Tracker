"""
Fix 3 issues:
1. Bulk actions (bulkMapColumn/bulkMapAll) - optimistic local update instead of server refetch
2. PB marker text cutoff - auto-shrink font to fit, allow horizontal stretch
3. PB 110 stuck size - likely a snap-place polygon issue. Fix text fit regardless.
"""
import os

filepath = os.path.join(os.path.dirname(__file__), 'backend', 'static', 'js', 'app.js')

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# ──────────────────────────────────────────────────────────────
# FIX 1: Replace bulkMapColumn and bulkMapAll with optimistic versions
# ──────────────────────────────────────────────────────────────
old_bulk = '''async function bulkMapColumn(pbId, statusType, complete) {
  try {
    await api.bulkComplete(pbId, [statusType], complete);
    const r = await api.getPowerBlock(pbId);
    const idx = mapPBs.findIndex(p => p.id === pbId);
    if (idx >= 0) mapPBs[idx] = r.data;
    showPBPanel(r.data);
    renderPBMarkers();
  } catch(e) { alert('Bulk error: ' + e.message); }
}

async function bulkMapAll(pbId, complete) {
  try {
    await api.bulkComplete(pbId, LBD_STATUS_TYPES, complete);
    const r = await api.getPowerBlock(pbId);
    const idx = mapPBs.findIndex(p => p.id === pbId);
    if (idx >= 0) mapPBs[idx] = r.data;
    showPBPanel(r.data);
    renderPBMarkers();
  } catch(e) { alert('Bulk error: ' + e.message); }
}'''

new_bulk = '''async function bulkMapColumn(pbId, statusType, complete) {
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
}'''

assert old_bulk in content, "Could not find old bulk functions"
content = content.replace(old_bulk, new_bulk)
print("FIX 1: Replaced bulk functions with optimistic versions")

# ──────────────────────────────────────────────────────────────
# FIX 2: Replace PB number rendering to auto-fit text
# ──────────────────────────────────────────────────────────────
# Find and replace the number span + "In Progress" section
old_numspan = '''    // PB number
    const numSpan = document.createElement('span');
    numSpan.textContent = num;
    numSpan.style.cssText = 'white-space:nowrap;';
    m.appendChild(numSpan);

    // "In Progress" indicator
    if (inProgress && !allDone) {
      const ipSpan = document.createElement('span');
      ipSpan.textContent = 'In Progress';
      const ipFontSize = Math.max(5, Math.min(12, fontSize * 0.45));
      ipSpan.style.cssText = `font-size:${ipFontSize}px;opacity:0.9;white-space:nowrap;margin-top:1px;letter-spacing:0.3px;`;
      m.appendChild(ipSpan);
    }'''

new_numspan = '''    // PB number — auto-fit: shrink font if text overflows the marker
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
    requestAnimationFrame(() => {
      if (!m.parentNode) return;
      let fs = fontSize;
      while (fs > 6 && (numSpan.scrollWidth > m.clientWidth * 0.92 || numSpan.scrollHeight > m.clientHeight * 0.7)) {
        fs -= 0.5;
        m.style.fontSize = fs + 'px';
      }
    });'''

assert old_numspan in content, "Could not find old numSpan section"
content = content.replace(old_numspan, new_numspan)
print("FIX 2: Added auto-fit text sizing for PB markers")

# ──────────────────────────────────────────────────────────────
# Write the result
# ──────────────────────────────────────────────────────────────
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied successfully!")
