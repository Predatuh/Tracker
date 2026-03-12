"""Replace toggleMapStatus with optimistic-only version (no server refetch, no full re-render)."""
import os

filepath = os.path.join(os.path.dirname(__file__), 'backend', 'static', 'js', 'app.js')

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = 'async function toggleMapStatus(lbdId, statusType, currentDone, btn, pbId) {'
end_marker = 'function updateSelectedPages() {'

start = content.find(start_marker)
end = content.find(end_marker, start)

if start < 0 or end < 0:
    print(f"ERROR: Could not find markers. start={start} end={end}")
    exit(1)

new_function = '''async function toggleMapStatus(lbdId, statusType, currentDone, btn, pbId) {
  const newDone = !currentDone;
  const col = STATUS_COLORS[statusType];

  // Instant optimistic update \u2014 button
  btn.style.background = newDone ? col : 'rgba(255,255,255,0.04)';
  btn.style.color       = newDone ? '#000' : '#4a5568';
  btn.style.border      = '1px solid ' + (newDone ? col : 'rgba(255,255,255,0.08)');
  btn.style.fontWeight  = newDone ? '700' : '400';
  btn.innerHTML         = newDone ? '\\u2713' : '\\u00b7';
  btn.onclick = () => toggleMapStatus(lbdId, statusType, newDone, btn, pbId);

  // Update local cache instantly \u2014 no server refetch
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
      '<span style="font-weight:600;color:#333;">' + total + '</span> total  \\u00b7 ' +
      '<span style="font-weight:700;color:#28a745;">' + done + ' complete</span>  \\u00b7 ' +
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

  // Fire API call in background \u2014 don't block the UI
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
    btn.innerHTML         = currentDone ? '\\u2713' : '\\u00b7';
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

'''

new_content = content[:start] + new_function + content[end:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"Replaced {end - start} chars with {len(new_function)} chars")
print("Done!")
