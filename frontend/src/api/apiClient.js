import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export const pdf_api = {
  uploadPDF: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/pdf/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  extractPages: (pdfPath, pageNumbers) => {
    return client.post('/pdf/extract-pages', {
      pdf_path: pdfPath,
      page_numbers: pageNumbers
    });
  },

  createPowerBlocks: (pages) => {
    return client.post('/pdf/create-power-blocks', { pages });
  }
};

export const auth_api = {
  me: () => client.get('/auth/me'),
  login: (payload) => client.post('/auth/login', payload),
  register: (payload) => client.post('/auth/register', payload),
  logout: () => client.post('/auth/logout'),
  listUsers: () => client.get('/auth/users'),
  updateUserJobSite: (userId, jobToken) => client.put(`/auth/users/${userId}/job-site`, { job_token: jobToken }),
};

export const tracker_api = {
  getPowerBlockIfcUrl: (blockId) => `${API_BASE_URL}/tracker/power-blocks/${blockId}/ifc`,

  getPowerBlocks: (options = {}) => {
    const params = {};
    if (options.trackerId) params.tracker_id = options.trackerId;
    return client.get('/tracker/power-blocks', { params });
  },

  getPowerBlock: (blockId) => {
    return client.get(`/tracker/power-blocks/${blockId}`);
  },

  updatePowerBlock: (blockId, data) => {
    return client.put(`/tracker/power-blocks/${blockId}`, data);
  },

  createLBD: (data) => {
    return client.post('/tracker/lbds', data);
  },

  getLBD: (lbdId) => {
    return client.get(`/tracker/lbds/${lbdId}`);
  },

  updateLBD: (lbdId, data) => {
    return client.put(`/tracker/lbds/${lbdId}`, data);
  },

  updateLBDStatus: (lbdId, statusType, data) => {
    return client.put(`/tracker/lbds/${lbdId}/status/${statusType}`, data);
  },

  getClaimPeople: () => {
    return client.get('/tracker/claim-people');
  }
};

export const map_api = {
  uploadSiteMap: (file, name) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    return client.post('/map/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  getSiteMap: (mapId) => {
    return client.get(`/map/sitemap/${mapId}`);
  },

  getAllSiteMaps: () => {
    return client.get('/map/sitemaps');
  },

  createSiteArea: (data) => {
    return client.post('/map/area', data);
  },

  updateSiteArea: (areaId, data) => {
    return client.put(`/map/area/${areaId}`, data);
  },

  getMapStatus: (mapId) => {
    return client.get(`/map/map-status/${mapId}`);
  },

  scanMap: (mapId) => {
    return client.post(`/map/scan/${mapId}`);
  },

  snapOutline: (mapId, x_pct, y_pct) => {
    return client.post(`/map/snap-outline/${mapId}`, { x_pct, y_pct });
  },

  deleteSiteArea: (areaId) => {
    return client.delete(`/map/area/${areaId}`);
  },

  deleteAllAreas: (mapId) => {
    return client.delete(`/map/areas/${mapId}`);
  },

  deleteSiteMap: (mapId) => {
    return client.delete(`/map/sitemap/${mapId}`);
  }
};

export const lbd_api = {
  getPowerBlockLBDs: (blockId) => {
    return client.get(`/lbd/power-block/${blockId}/lbds`);
  },

  getStatusColors: () => {
    return client.get('/lbd/status-colors');
  }
};

export const admin_api = {
  listTrackers: () => {
    return client.get('/admin/trackers');
  },

  getSettings: () => {
    return client.get('/admin/settings');
  },

  getTrackerSettings: (trackerId) => {
    const params = trackerId ? { tracker_id: trackerId } : {};
    return client.get('/admin/settings', { params });
  },

  updateColors: (colors, trackerId) => {
    const payload = { colors };
    if (trackerId) payload.tracker_id = trackerId;
    return client.put('/admin/settings/colors', payload);
  },

  updateNames: (names, trackerId) => {
    const payload = { names };
    if (trackerId) payload.tracker_id = trackerId;
    return client.put('/admin/settings/names', payload);
  },

  addColumn: (key, label, color, trackerId) => {
    const payload = { key, label, color };
    if (trackerId) payload.tracker_id = trackerId;
    return client.post('/admin/settings/columns', payload);
  },

  deleteColumn: (columnKey, trackerId) => {
    const config = trackerId ? { data: { tracker_id: trackerId } } : undefined;
    return client.delete(`/admin/settings/columns/${columnKey}`, config);
  },

  updateFontSize: (size, trackerId) => {
    const payload = { size };
    if (trackerId) payload.tracker_id = trackerId;
    return client.put('/admin/settings/font-size', payload);
  },

  bulkComplete: (powerBlockId, statusTypes, isCompleted) => {
    return client.post('/admin/bulk-complete', {
      power_block_id: powerBlockId,
      status_types: statusTypes,
      is_completed: isCompleted
    });
  }
};

export const workers_api = {
  list: (includeInactive = false) =>
    client.get(`/workers${includeInactive ? '?all=true' : ''}`),
  create: (name) =>
    client.post('/workers', { name }),
  update: (id, data) =>
    client.put(`/workers/${id}`, data),
  remove: (id) =>
    client.delete(`/workers/${id}`),
};

export const worklog_api = {
  getEntries: (date, trackerId) =>
    client.get('/work-entries', { params: { ...(date ? { date } : {}), ...(trackerId ? { tracker_id: trackerId } : {}) } }),
  logWork: (payload, trackerId) =>
    client.post('/work-entries', { ...payload, ...(trackerId ? { tracker_id: trackerId } : {}) }),
  deleteEntry: (id) =>
    client.delete(`/work-entries/${id}`),
};

export const reports_api = {
  list: (trackerId) =>
    client.get('/reports', { params: trackerId ? { tracker_id: trackerId } : {} }),
  get: (id, trackerId) =>
    client.get(`/reports/${id}`, { params: trackerId ? { tracker_id: trackerId } : {} }),
  getByDate: (dateStr, trackerId) =>
    client.get(`/reports/date/${dateStr}`, { params: trackerId ? { tracker_id: trackerId } : {} }),
  generate: (dateStr, trackerId) =>
    client.post('/reports/generate', { ...(dateStr ? { date: dateStr } : {}), ...(trackerId ? { tracker_id: trackerId } : {}) }),
  getRange: (type, params, trackerId) =>
    client.get('/reports/range', { params: { type, ...params, ...(trackerId ? { tracker_id: trackerId } : {}) } }),
};

export { client };
