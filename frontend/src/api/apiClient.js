import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

export const pdf_api = {
  uploadPDF: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API_BASE_URL}/pdf/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  extractPages: (pdfPath, pageNumbers) => {
    return axios.post(`${API_BASE_URL}/pdf/extract-pages`, {
      pdf_path: pdfPath,
      page_numbers: pageNumbers
    });
  },

  createPowerBlocks: (pages) => {
    return axios.post(`${API_BASE_URL}/pdf/create-power-blocks`, { pages });
  }
};

export const tracker_api = {
  getPowerBlocks: () => {
    return axios.get(`${API_BASE_URL}/tracker/power-blocks`);
  },

  getPowerBlock: (blockId) => {
    return axios.get(`${API_BASE_URL}/tracker/power-blocks/${blockId}`);
  },

  updatePowerBlock: (blockId, data) => {
    return axios.put(`${API_BASE_URL}/tracker/power-blocks/${blockId}`, data);
  },

  createLBD: (data) => {
    return axios.post(`${API_BASE_URL}/tracker/lbds`, data);
  },

  getLBD: (lbdId) => {
    return axios.get(`${API_BASE_URL}/tracker/lbds/${lbdId}`);
  },

  updateLBD: (lbdId, data) => {
    return axios.put(`${API_BASE_URL}/tracker/lbds/${lbdId}`, data);
  },

  updateLBDStatus: (lbdId, statusType, data) => {
    return axios.put(`${API_BASE_URL}/tracker/lbds/${lbdId}/status/${statusType}`, data);
  }
};

export const map_api = {
  uploadSiteMap: (file, name) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    return axios.post(`${API_BASE_URL}/map/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  getSiteMap: (mapId) => {
    return axios.get(`${API_BASE_URL}/map/sitemap/${mapId}`);
  },

  getAllSiteMaps: () => {
    return axios.get(`${API_BASE_URL}/map/sitemaps`);
  },

  createSiteArea: (data) => {
    return axios.post(`${API_BASE_URL}/map/area`, data);
  },

  updateSiteArea: (areaId, data) => {
    return axios.put(`${API_BASE_URL}/map/area/${areaId}`, data);
  },

  getMapStatus: (mapId) => {
    return axios.get(`${API_BASE_URL}/map/map-status/${mapId}`);
  },

  scanMap: (mapId) => {
    return axios.post(`${API_BASE_URL}/map/scan/${mapId}`);
  },

  snapOutline: (mapId, x_pct, y_pct) => {
    return axios.post(`${API_BASE_URL}/map/snap-outline/${mapId}`, { x_pct, y_pct });
  },

  deleteSiteArea: (areaId) => {
    return axios.delete(`${API_BASE_URL}/map/area/${areaId}`);
  }
};

export const lbd_api = {
  getPowerBlockLBDs: (blockId) => {
    return axios.get(`${API_BASE_URL}/lbd/power-block/${blockId}/lbds`);
  },

  getStatusColors: () => {
    return axios.get(`${API_BASE_URL}/lbd/status-colors`);
  }
};

export const admin_api = {
  getSettings: () => {
    return axios.get(`${API_BASE_URL}/admin/settings`);
  },

  updateColors: (colors) => {
    return axios.put(`${API_BASE_URL}/admin/settings/colors`, { colors });
  },

  updateNames: (names) => {
    return axios.put(`${API_BASE_URL}/admin/settings/names`, { names });
  },

  addColumn: (key, label, color) => {
    return axios.post(`${API_BASE_URL}/admin/settings/columns`, { key, label, color });
  },

  deleteColumn: (columnKey) => {
    return axios.delete(`${API_BASE_URL}/admin/settings/columns/${columnKey}`);
  },

  updateFontSize: (size) => {
    return axios.put(`${API_BASE_URL}/admin/settings/font-size`, { size });
  },

  bulkComplete: (powerBlockId, statusTypes, isCompleted) => {
    return axios.post(`${API_BASE_URL}/admin/bulk-complete`, {
      power_block_id: powerBlockId,
      status_types: statusTypes,
      is_completed: isCompleted
    });
  }
};
