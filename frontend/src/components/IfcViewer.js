import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { tracker_api } from '../api/apiClient';
import './IfcViewer.css';

function IfcViewer() {
  const { id } = useParams();
  const [block, setBlock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    tracker_api.getPowerBlock(id)
      .then((response) => {
        if (!active) return;
        setBlock(response.data.data || null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.response?.data?.error || 'Unable to load IFC drawing');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return <div className="container"><div className="loading"><div className="spinner" /></div></div>;
  }

  if (error || !block) {
    return <div className="container"><div className="alert alert-error">{error || 'Power block not found'}</div></div>;
  }

  if (!block.has_ifc) {
    return <div className="container"><div className="alert alert-info">No IFC drawing is assigned to {block.name} yet.</div></div>;
  }

  return (
    <div className="ifc-viewer container">
      <div className="ifc-viewer-head">
        <div>
          <Link to="/site-map" className="pbd-back-link">← Back to Site Map</Link>
          <h1 className="section-title">{block.name} IFC Drawing</h1>
          <p className="ifc-viewer-copy">Page {block.ifc_page_number || 'N/A'} from the assigned IFC file.</p>
        </div>
        <a className="btn btn-secondary" href={tracker_api.getPowerBlockIfcUrl(block.id)} target="_blank" rel="noreferrer">
          Open Raw PDF
        </a>
      </div>
      <div className="ifc-frame-wrap">
        <iframe title={`${block.name} IFC`} src={tracker_api.getPowerBlockIfcUrl(block.id)} className="ifc-frame" />
      </div>
    </div>
  );
}

export default IfcViewer;