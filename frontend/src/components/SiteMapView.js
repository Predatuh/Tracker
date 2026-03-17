import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { map_api, admin_api, tracker_api } from '../api/apiClient';
import { useNavigate } from 'react-router-dom';
import './SiteMapView.css';
import { useAppContext } from '../context/AppContext';

function SiteMapView() {
  const { currentTracker, currentTrackerId, isAdmin, isGuest, hasPermission } = useAppContext();
  const navigate = useNavigate();
  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);
  const [mapAreas, setMapAreas] = useState([]);   // saved SiteArea rows
  const [file, setFile] = useState(null);
  const [mapName, setMapName] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Detected regions from backend scan (not yet saved)
  const [detectedRegions, setDetectedRegions] = useState([]);
  // Assignment: regionIndex -> pbName
  const [assignments, setAssignments] = useState({});

  // Font-size controls
  const [globalFontSize, setGlobalFontSize] = useState(14);
  const [fontSizeOverrides, setFontSizeOverrides] = useState({}); // areaId -> px

  const imgRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // ---- Placement mode state ----
  const [placementMode, setPlacementMode] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [pendingSnap, setPendingSnap] = useState(null); // { polygon, bbox }
  const [pendingName, setPendingName] = useState('');

  // Power block list for dropdown
  const [powerBlocks, setPowerBlocks] = useState([]);
  const [mapSearch, setMapSearch] = useState('');
  const [showLabels, setShowLabels] = useState(false);
  const [showOutlines, setShowOutlines] = useState(false);
  const [showAllAreas, setShowAllAreas] = useState(false);
  const [selectedAreaBlock, setSelectedAreaBlock] = useState(null);

  const formatMapLabel = useCallback((name) => {
    const raw = String(name || '').trim();
    if (!raw) return 'Site Map';

    return raw
      .replace(/^map[_-]*/i, '')
      .replace(/\.(svg|png|jpe?g)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Site Map';
  }, []);

  // ---- Load admin font size + power blocks on mount ----
  useEffect(() => {
    admin_api.getTrackerSettings(currentTrackerId).then(res => {
      setGlobalFontSize(res.data.data.pb_label_font_size || 14);
    }).catch(() => {});
    tracker_api.getPowerBlocks({ trackerId: currentTrackerId }).then(res => {
      const blocks = res.data.data || res.data || [];
      setPowerBlocks(blocks);
    }).catch(() => {});
  }, [currentTrackerId]);

  const fetchMaps = useCallback(async () => {
    try {
      const res = await map_api.getAllSiteMaps();
      setMaps(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error fetching maps');
    }
  }, []);

  useEffect(() => { fetchMaps(); }, [fetchMaps]);

  const filteredMaps = useMemo(() => {
    const query = mapSearch.trim().toLowerCase();
    if (!query) return maps;
    return maps.filter((map) => (map.name || '').toLowerCase().includes(query));
  }, [mapSearch, maps]);

  const mapSummary = useMemo(() => ({
    totalMaps: maps.length,
    totalPlacedAreas: mapAreas.length,
    availableBlocks: powerBlocks.length,
    mappedBlocks: mapAreas.filter((area) => powerBlocks.some((block) => block.name === area.name)).length,
  }), [mapAreas, maps.length, powerBlocks]);

  const manageableMaps = isAdmin || hasPermission('upload_pdf') || hasPermission('admin_settings');

  const trackerBlockNames = useMemo(() => new Set(powerBlocks.map((block) => block.name)), [powerBlocks]);
  const trackerBlockIds = useMemo(() => new Set(powerBlocks.map((block) => block.id)), [powerBlocks]);

  const trackerMatchedAreas = useMemo(() => {
    if (!powerBlocks.length) {
      return [];
    }

    return mapAreas.filter((area) => (
      (area.power_block_id && trackerBlockIds.has(area.power_block_id))
      || (area.name && trackerBlockNames.has(area.name))
    ));
  }, [mapAreas, powerBlocks, trackerBlockIds, trackerBlockNames]);

  const visibleMapAreas = useMemo(() => {
    if (showAllAreas) {
      return mapAreas;
    }
    if (!powerBlocks.length) {
      return [];
    }
    return trackerMatchedAreas;
  }, [mapAreas, powerBlocks.length, showAllAreas, trackerMatchedAreas]);

  const handleMapSelect = useCallback(async (map) => {
    setSelectedMap(map);
    setDetectedRegions([]);
    setAssignments({});
    setPendingSnap(null);
    setPlacementMode(false);
    setSelectedAreaBlock(null);
    setError('');
    try {
      // Load saved areas (with bbox data)
      const res = await map_api.getSiteMap(map.id);
      setMapAreas(res.data.data.areas || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Error fetching map');
    }
  }, []);

  useEffect(() => {
    if (!maps.length) {
      setSelectedMap(null);
      setMapAreas([]);
      return;
    }

    const matchingMap = selectedMap ? maps.find((map) => map.id === selectedMap.id) : null;
    if (matchingMap) {
      setSelectedMap(matchingMap);
      return;
    }

    handleMapSelect(maps[0]);
  }, [maps, selectedMap, handleMapSelect]);

  const handleUpload = async () => {
    if (!file || !mapName) { setError('Please select a file and enter a name'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      await map_api.uploadSiteMap(file, mapName);
      setSuccess('Site map uploaded successfully!');
      setFile(null); setMapName('');
      fetchMaps();
    } catch (err) {
      setError(err.response?.data?.error || 'Error uploading map');
    } finally { setLoading(false); }
  };

  const handleDeleteAllAreas = async () => {
    if (!selectedMap || !window.confirm('Delete all saved areas for this map?')) return;
    try {
      await map_api.deleteAllAreas(selectedMap.id);
      setMapAreas([]);
      setSuccess('All saved areas removed.');
    } catch (err) {
      setError(err.response?.data?.error || 'Error deleting areas');
    }
  };

  const handleDeleteMap = async () => {
    if (!selectedMap || !window.confirm(`Delete map "${selectedMap.name}"?`)) return;
    try {
      await map_api.deleteSiteMap(selectedMap.id);
      setSelectedMap(null);
      setMapAreas([]);
      setSuccess('Map deleted.');
      fetchMaps();
    } catch (err) {
      setError(err.response?.data?.error || 'Error deleting map');
    }
  };

  // ---- Scan map ----
  const handleScan = async () => {
    if (!selectedMap) return;
    setScanning(true); setError(''); setDetectedRegions([]); setAssignments({});
    try {
      const res = await map_api.scanMap(selectedMap.id);
      const regions = res.data.data || [];
      setDetectedRegions(regions);
      if (regions.length === 0) setError('No rectangular regions detected in this map.');
      else setSuccess(`Detected ${regions.length} region(s). Assign PB names below, then save.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Error scanning map');
    } finally { setScanning(false); }
  };

  // ---- Save detected assignments ----
  const handleSaveAssignments = async () => {
    setLoading(true); setError('');
    try {
      for (let i = 0; i < detectedRegions.length; i++) {
        const name = assignments[i];
        if (!name || !name.trim()) continue;
        const r = detectedRegions[i];
        await map_api.createSiteArea({
          site_map_id: selectedMap.id,
          name: name.trim(),
          bbox_x: r.x_pct,
          bbox_y: r.y_pct,
          bbox_w: r.w_pct,
          bbox_h: r.h_pct,
        });
      }
      setSuccess('Areas saved!');
      setDetectedRegions([]);
      setAssignments({});
      handleMapSelect(selectedMap);
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving areas');
    } finally { setLoading(false); }
  };

  // ---- Update per-area font size override ----
  const handleAreaFontSize = async (areaId, size) => {
    setFontSizeOverrides(prev => ({ ...prev, [areaId]: size }));
    try {
      await map_api.updateSiteArea(areaId, { label_font_size: size });
    } catch (e) { /* silent */ }
  };

  // ---- Delete area ----
  const handleDeleteArea = async (areaId) => {
    if (!window.confirm('Remove this area label?')) return;
    try {
      await map_api.deleteSiteArea(areaId);
      setMapAreas(prev => prev.filter(a => a.id !== areaId));
    } catch (err) {
      setError(err.response?.data?.error || 'Error deleting area');
    }
  };

  // ---- Click on map -> snap to outline ----
  const handleMapClick = async (e) => {
    if (!placementMode || !selectedMap || snapping) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x_pct = ((e.clientX - rect.left) / rect.width) * 100;
    const y_pct = ((e.clientY - rect.top) / rect.height) * 100;

    setSnapping(true);
    setError('');
    setSuccess('');
    try {
      const res = await map_api.snapOutline(selectedMap.id, x_pct, y_pct);
      if (res.data.success) {
        setPendingSnap({
          polygon: res.data.polygon,
          bbox: res.data.bbox,
        });
        setPendingName('');
        setSuccess(`Outline detected (${res.data.point_count} points). Select a PB name and save.`);
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'No outline found at that position.';
      setError(msg);
    } finally {
      setSnapping(false);
    }
  };

  // ---- Save the snapped outline as a new area ----
  const handleSaveSnap = async () => {
    if (!pendingSnap || !pendingName.trim()) {
      setError('Enter a name for this area.');
      return;
    }
    setLoading(true); setError('');
    try {
      await map_api.createSiteArea({
        site_map_id: selectedMap.id,
        name: pendingName.trim(),
        bbox_x: pendingSnap.bbox.x_pct,
        bbox_y: pendingSnap.bbox.y_pct,
        bbox_w: pendingSnap.bbox.w_pct,
        bbox_h: pendingSnap.bbox.h_pct,
        polygon: pendingSnap.polygon,
      });
      setSuccess(`"${pendingName.trim()}" saved!`);
      setPendingSnap(null);
      setPendingName('');
      handleMapSelect(selectedMap);
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving area');
    } finally { setLoading(false); }
  };

  // Get names of PBs already placed on map
  const placedNames = new Set(visibleMapAreas.map(a => a.name));

  const trackerTitle = currentTracker?.name || 'All Trackers';

  const resolveBlockForArea = useCallback((area) => {
    if (!area) return null;
    return powerBlocks.find((block) => (
      (area.power_block_id && block.id === area.power_block_id)
      || (area.name && block.name === area.name)
    )) || null;
  }, [powerBlocks]);

  const handleAreaOpen = useCallback((area) => {
    if (placementMode) return;
    const block = resolveBlockForArea(area);
    if (!block) {
      setError('That map area is not linked to a visible power block.');
      return;
    }
    setSelectedAreaBlock(block);
    if (!currentTrackerId) {
      if (!isGuest && block.has_ifc) {
        navigate(`/ifc/${block.id}`);
      } else if (isGuest) {
        setError('IFC drawings are only available to created users.');
      } else {
        setError('No IFC drawing is assigned to that power block yet.');
      }
    }
  }, [currentTrackerId, isGuest, navigate, placementMode, resolveBlockForArea]);

  useEffect(() => {
    setShowLabels(true);
    setShowOutlines(true);
    setShowAllAreas(false);
  }, [selectedMap?.id]);

  const renderSavedOutlines = manageableMaps ? showOutlines : true;
  const renderSavedLabels = manageableMaps ? showLabels : true;
  const renderDetectedRegions = manageableMaps && detectedRegions.length > 0;
  const renderPendingSnap = manageableMaps && pendingSnap;

  // ---- Calculate font-size to fit label inside a box ----
  const calcFontSize = (label, boxWpx, boxHpx, basePx) => {
    // Rough estimate: each char ~0.6em wide, line height 1.2
    const maxByWidth  = (boxWpx * 0.85) / (label.length * 0.6 || 1);
    const maxByHeight = boxHpx * 0.5;
    return Math.max(8, Math.min(basePx, maxByWidth, maxByHeight));
  };

  const onImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgSize({
        w: imgRef.current.offsetWidth,
        h: imgRef.current.offsetHeight,
      });
    }
  }, []);

  // Re-measure on window resize
  useEffect(() => {
    const handleResize = () => onImgLoad();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [onImgLoad]);

  const pctToPx = (pct, total) => (pct / 100) * total;

  // ---- Build SVG polygon "points" string from polygon data ----
  const polygonToSvgPoints = (polygon) => {
    if (!polygon || polygon.length === 0) return '';
    return polygon.map(pt =>
      `${(pt.x_pct / 100 * imgSize.w).toFixed(1)},${(pt.y_pct / 100 * imgSize.h).toFixed(1)}`
    ).join(' ');
  };

  // ---- Compute centroid of polygon for label placement ----
  const polygonCentroid = (polygon) => {
    if (!polygon || polygon.length === 0) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const pt of polygon) {
      sx += pt.x_pct / 100 * imgSize.w;
      sy += pt.y_pct / 100 * imgSize.h;
    }
    return { x: sx / polygon.length, y: sy / polygon.length };
  };

  // ---- Compute bounds of polygon for font sizing ----
  const polygonBounds = (polygon) => {
    if (!polygon || polygon.length === 0) return { w: 0, h: 0 };
    const xs = polygon.map(p => p.x_pct / 100 * imgSize.w);
    const ys = polygon.map(p => p.y_pct / 100 * imgSize.h);
    return {
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  };

  return (
    <div className="site-map-view smv-shell">
      <section className="container smv-hero">
        <div>
          <span className="dashboard-kicker">{trackerTitle}</span>
          <h1 className="section-title">Site Map</h1>
          <p className="smv-subtitle">
            Manage uploaded maps, label areas, and place power blocks for the selected tracker.
          </p>
        </div>
        <div className="smv-hero-grid">
          <div className="smv-hero-card">
            <span>Maps</span>
            <strong>{mapSummary.totalMaps}</strong>
          </div>
          <div className="smv-hero-card">
            <span>Placed Areas</span>
            <strong>{mapSummary.totalPlacedAreas}</strong>
          </div>
          <div className="smv-hero-card">
            <span>{currentTracker?.dashboard_blocks_label || 'Power Blocks'}</span>
            <strong>{mapSummary.availableBlocks}</strong>
          </div>
          <div className="smv-hero-card">
            <span>Mapped Blocks</span>
            <strong>{mapSummary.mappedBlocks}</strong>
          </div>
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="sitemap-layout">
        {/* ───── Sidebar ───── */}
        <div className="sitemap-sidebar container">
          <div className="smv-sidebar-section">
            <span className="dashboard-kicker">Selected Tracker</span>
            <h2 className="section-subtitle">{trackerTitle}</h2>
            <p className="smv-sidebar-copy">
              Placement and labeling use this tracker's power block list.
            </p>
          </div>

          {manageableMaps && (
          <div className="smv-sidebar-section">
            <h2 className="section-subtitle">Upload Site Map</h2>
          <div className="form-group">
            <label>Map Name</label>
            <input
              type="text"
              value={mapName}
              onChange={(e) => setMapName(e.target.value)}
              placeholder="e.g., Site Floor Plan"
            />
          </div>
          <div className="form-group">
            <label>Upload File (SVG, PNG, JPG)</label>
            <input
              type="file"
              accept=".svg,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files[0])}
            />
          </div>
          <button
            className="btn btn-success"
            onClick={handleUpload}
            disabled={!file || !mapName || loading}
          >
            {loading ? 'Uploading...' : 'Upload Map'}
          </button>
          </div>
          )}

          <div className="smv-sidebar-section">
          <h2 className="section-subtitle">Available Maps</h2>
          <div className="form-group">
            <label>Search Maps</label>
            <input
              type="text"
              value={mapSearch}
              onChange={(e) => setMapSearch(e.target.value)}
              placeholder="Search saved maps"
            />
          </div>
          {filteredMaps.length === 0 ? (
            <p className="no-maps">No site maps uploaded yet.</p>
          ) : (
            <div className="maps-list">
              {filteredMaps.map(map => (
                <button
                  key={map.id}
                  className={`map-item ${selectedMap?.id === map.id ? 'active' : ''}`}
                  onClick={() => handleMapSelect(map)}
                >
                  {formatMapLabel(map.name)}
                </button>
              ))}
            </div>
          )}
          </div>

          {/* ── Global font-size slider ── */}
          {selectedMap && manageableMaps && (
            <div className="font-size-sidebar smv-sidebar-section">
              <h3>PB Label Size</h3>
              <label>Global: <strong>{globalFontSize}px</strong></label>
              <input
                type="range"
                min={8}
                max={72}
                value={globalFontSize}
                onChange={e => setGlobalFontSize(Number(e.target.value))}
                className="font-size-slider"
              />
            </div>
          )}

          {selectedMap && manageableMaps && (
            <div className="smv-sidebar-section smv-admin-controls">
              <h3>Map Admin Controls</h3>
              <label className="smv-toggle-row">
                <input type="checkbox" checked={showOutlines} onChange={(e) => setShowOutlines(e.target.checked)} />
                <span>Show outlines</span>
              </label>
              <label className="smv-toggle-row">
                <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
                <span>Show PB labels</span>
              </label>
              <label className="smv-toggle-row">
                <input type="checkbox" checked={showAllAreas} onChange={(e) => setShowAllAreas(e.target.checked)} />
                <span>Show all saved areas</span>
              </label>
              <div className="smv-admin-note">
                Showing {visibleMapAreas.length} visible areas out of {mapAreas.length} saved.
              </div>
              <button className="btn btn-secondary" onClick={handleDeleteAllAreas}>Clear Saved Areas</button>
              <button className="btn btn-danger" onClick={handleDeleteMap}>Delete Map</button>
            </div>
          )}

          {/* ── Saved areas list ── */}
          {visibleMapAreas.length > 0 && manageableMaps && (
            <div className="areas-sidebar smv-sidebar-section">
              <h3>Saved Areas ({visibleMapAreas.length})</h3>
              {visibleMapAreas.map(area => (
                <div key={area.id} className="area-sidebar-item">
                  <span className="area-name">
                    {area.polygon ? '\u2B21 ' : '\u25AD '}{area.name}
                  </span>
                  <div className="area-controls">
                    <input
                      type="range"
                      min={8}
                      max={72}
                      value={fontSizeOverrides[area.id] ?? area.label_font_size ?? globalFontSize}
                      onChange={e => handleAreaFontSize(area.id, Number(e.target.value))}
                      title="Font size for this label"
                      className="area-font-slider"
                    />
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteArea(area.id)}
                    >×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ───── Main View ───── */}
        <div className="sitemap-main container">
          {selectedMap ? (
            <div className="map-display">
              <div className="map-toolbar">
                <div>
                  <span className="dashboard-kicker">{trackerTitle}</span>
                  <h2>Current Site Map</h2>
                </div>
                <div className="toolbar-buttons">
                  {selectedAreaBlock && currentTrackerId && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => navigate(`/ifc/${selectedAreaBlock.id}`)}
                      disabled={isGuest || !selectedAreaBlock.has_ifc}
                    >
                      View IFC
                    </button>
                  )}
                  {manageableMaps && (
                    <>
                      <button
                        className={`btn ${placementMode ? 'btn-warning' : 'btn-primary'}`}
                        onClick={() => {
                          setPlacementMode(!placementMode);
                          setPendingSnap(null);
                          setError('');
                        }}
                      >
                        {placementMode ? '\u270B Stop Placing' : '\uD83D\uDCCC Place PB on Map'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={handleScan}
                        disabled={scanning}
                      >
                        {scanning ? '\uD83D\uDD0D Scanning\u2026' : '\uD83D\uDD0D Auto-detect Regions'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {placementMode && (
                <div className="placement-hint">
                  {snapping
                    ? '\u23F3 Detecting outline\u2026'
                    : pendingSnap
                      ? '\u2705 Outline detected! Select a name below and click Save.'
                      : '\uD83D\uDC46 Click inside a black-outlined area on the map to snap to its shape.'}
                </div>
              )}

              {selectedAreaBlock && currentTrackerId && (
                <div className="placement-hint">
                  Selected {selectedAreaBlock.name}. {isGuest ? 'IFC drawings are only available to created users.' : selectedAreaBlock.has_ifc ? 'Use View IFC to open its drawing.' : 'No IFC drawing is assigned to this power block yet.'}
                </div>
              )}

              {/* ── Snap result name input ── */}
              {renderPendingSnap && (
                <div className="snap-save-bar">
                  <select
                    className="snap-name-input"
                    value={pendingName}
                    onChange={e => setPendingName(e.target.value)}
                  >
                    <option value="">-- Select Power Block --</option>
                    {powerBlocks
                      .filter(pb => !placedNames.has(pb.name))
                      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                      .map(pb => (
                        <option key={pb.id} value={pb.name}>{pb.name}</option>
                      ))}
                  </select>
                  <input
                    type="text"
                    className="snap-name-input"
                    placeholder="Or type a custom name\u2026"
                    value={pendingName}
                    onChange={e => setPendingName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveSnap(); }}
                  />
                  <button className="btn btn-success" onClick={handleSaveSnap} disabled={loading}>
                    {loading ? 'Saving\u2026' : 'Save'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setPendingSnap(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {/* ── Map canvas with overlays ── */}
              <div
                className={`map-container ${placementMode ? 'placement-active' : ''}`}
                style={{ position: 'relative', display: 'inline-block', width: '100%' }}
              >
                {selectedMap.file_path?.toLowerCase().endsWith('.svg') ? (
                  <div
                    className="svg-container"
                    ref={imgRef}
                    onLoad={onImgLoad}
                    dangerouslySetInnerHTML={{ __html: selectedMap.svg_content }}
                    style={{ width: '100%' }}
                  />
                ) : (
                  <img
                    ref={imgRef}
                    src={selectedMap.image_url}
                    alt={selectedMap.name}
                    className="map-image"
                    onLoad={onImgLoad}
                    onClick={handleMapClick}
                    style={{ width: '100%', display: 'block', cursor: placementMode ? 'crosshair' : 'default' }}
                  />
                )}

                {/* ── SVG overlay for polygons ── */}
                {imgSize.w > 0 && (
                  <svg
                    className="polygon-overlay"
                    viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: placementMode ? 'none' : 'auto',
                    }}
                  >
                    {/* ── Pending snap polygon (preview) ── */}
                    {pendingSnap && pendingSnap.polygon && (
                      <polygon
                        points={polygonToSvgPoints(pendingSnap.polygon)}
                        className="snap-preview-polygon"
                      />
                    )}

                    {/* ── Saved areas with polygons ── */}
                    {renderSavedOutlines && visibleMapAreas.filter(a => a.polygon).map(area => {
                      const centroid = polygonCentroid(area.polygon);
                      const bounds = polygonBounds(area.polygon);
                      const overrideSz = fontSizeOverrides[area.id] ?? area.label_font_size;
                      const fs = overrideSz
                        ? calcFontSize(area.name, bounds.w, bounds.h, overrideSz)
                        : calcFontSize(area.name, bounds.w, bounds.h, globalFontSize);
                      return (
                        <g key={area.id}>
                          <polygon
                            points={polygonToSvgPoints(area.polygon)}
                            className="saved-polygon"
                            style={{ pointerEvents: placementMode ? 'none' : 'auto', cursor: placementMode ? 'default' : 'pointer' }}
                            onClick={() => handleAreaOpen(area)}
                          />
                          {renderSavedLabels && bounds.w >= 30 && bounds.h >= 18 && (
                          <text
                            x={centroid.x}
                            y={centroid.y}
                            className="polygon-label"
                            style={{ fontSize: `${fs}px` }}
                            dominantBaseline="central"
                            textAnchor="middle"
                          >
                            {area.name}
                          </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                )}

                {/* ── Overlay: detected (unsaved) rectangular regions ── */}
                {imgSize.w > 0 && renderDetectedRegions && detectedRegions.map((r, i) => {
                  const x  = pctToPx(r.x_pct, imgSize.w);
                  const y  = pctToPx(r.y_pct, imgSize.h);
                  const bw = pctToPx(r.w_pct, imgSize.w);
                  const bh = pctToPx(r.h_pct, imgSize.h);
                  const lbl = assignments[i] || `R${i + 1}`;
                  const fs  = calcFontSize(lbl, bw, bh, globalFontSize);
                  return (
                    <div
                      key={i}
                      className="map-region detected"
                      style={{ left: x, top: y, width: bw, height: bh }}
                    >
                      <span className="region-label" style={{ fontSize: fs }}>
                        {assignments[i] || '?'}
                      </span>
                    </div>
                  );
                })}

                {/* ── Overlay: saved areas WITHOUT polygon (rectangle fallback) ── */}
                {imgSize.w > 0 && renderSavedOutlines && visibleMapAreas.filter(a => !a.polygon && a.bbox_x != null).map(area => {
                  const x  = pctToPx(area.bbox_x, imgSize.w);
                  const y  = pctToPx(area.bbox_y, imgSize.h);
                  const bw = pctToPx(area.bbox_w, imgSize.w);
                  const bh = pctToPx(area.bbox_h, imgSize.h);
                  const overrideSz = fontSizeOverrides[area.id] ?? area.label_font_size;
                  const fs = overrideSz
                    ? calcFontSize(area.name, bw, bh, overrideSz)
                    : calcFontSize(area.name, bw, bh, globalFontSize);
                  return (
                    <div
                      key={area.id}
                      className="map-region saved"
                      style={{ left: x, top: y, width: bw, height: bh }}
                      title={area.name}
                      onClick={() => handleAreaOpen(area)}
                    >
                      <span className="region-label" style={{ fontSize: fs, opacity: renderSavedLabels && bw >= 30 && bh >= 18 ? 1 : 0 }}>
                        {area.name}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── Detected regions assignment panel ── */}
              {renderDetectedRegions && (
                <div className="assign-panel">
                  <h3>Assign {currentTracker?.dashboard_blocks_label || 'Power Block'} Names to Detected Regions</h3>
                  <p className="admin-hint">
                    Enter the PB name for each detected region. Leave blank to skip saving it.
                  </p>
                  <div className="assign-grid">
                    {detectedRegions.map((r, i) => (
                      <div className="assign-row" key={i}>
                        <div className="assign-region-info">
                          <strong>Region {i + 1}</strong>
                          <span className="assign-coords">
                            {r.x_pct.toFixed(1)}%, {r.y_pct.toFixed(1)}% &nbsp;
                            {r.w_pct.toFixed(1)}×{r.h_pct.toFixed(1)}%
                          </span>
                        </div>
                        <input
                          type="text"
                          placeholder="PB Name (e.g. INV-01)"
                          value={assignments[i] || ''}
                          onChange={e => setAssignments(prev => ({ ...prev, [i]: e.target.value }))}
                          className="assign-input"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="assign-actions">
                    <button
                      className="btn btn-success"
                      onClick={handleSaveAssignments}
                      disabled={loading}
                    >
                      {loading ? 'Saving…' : 'Save Labeled Areas'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => { setDetectedRegions([]); setAssignments({}); }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="placeholder">
              <p>{maps.length ? 'Select visibility controls to inspect this map.' : 'No maps uploaded yet.'}</p>
            </div>
          )}

          {selectedMap && !showAllAreas && powerBlocks.length > 0 && visibleMapAreas.length === 0 && (
            <div className="alert alert-info">
              No saved areas match the selected tracker yet. Turn on "Show all saved areas" if you need to inspect the full map data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteMapView;
