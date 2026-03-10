import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { tracker_api } from '../api/apiClient';
import './PowerBlockList.css';

function PowerBlockList() {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPowerBlocks();
  }, []);

  const fetchPowerBlocks = async () => {
    try {
      const response = await tracker_api.getPowerBlocks();
      setBlocks(response.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error loading power blocks');
    } finally {
      setLoading(false);
    }
  };

  const getCompletionColor = (block) => {
    if (block.is_completed) return '#2ecc71';
    const stats = block.lbd_summary;
    if (!stats.total) return '#95a5a6';
    const completed = Object.values(stats).slice(1).reduce((a, b) => a + b, 0);
    const percentage = (completed / (stats.total * 6)) * 100;
    if (percentage > 75) return '#f39c12';
    if (percentage > 50) return '#e74c3c';
    return '#bdc3c7';
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="power-block-list container">
      <h1 className="section-title">Power Blocks</h1>
      
      {blocks.length === 0 ? (
        <div className="alert alert-info">
          No power blocks yet. <Link to="/upload">Upload a PDF</Link> to create power blocks.
        </div>
      ) : (
        <div className="blocks-grid">
          {blocks.map(block => (
            <Link
              key={block.id}
              to={`/power-block/${block.id}`}
              className="block-card"
              style={{ borderLeftColor: getCompletionColor(block) }}
            >
              <div className="block-header">
                <h3 className="block-title">{block.name}</h3>
                <span className="completion-badge" style={{ backgroundColor: getCompletionColor(block) }}>
                  {block.is_completed ? 'Complete' : 'In Progress'}
                </span>
              </div>

              {block.image_path && (
                <div className="block-image-preview">
                  <img src={block.image_path} alt={block.name} />
                </div>
              )}

              <div className="block-stats">
                <div className="stat">
                  <span className="stat-label">LBDs</span>
                  <span className="stat-value">{block.lbd_count}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Page</span>
                  <span className="stat-value">{block.page_number || 'N/A'}</span>
                </div>
              </div>

              <div className="status-summary">
                {block.lbd_summary && (
                  <div className="status-items">
                    {Object.entries(block.lbd_summary).map(([key, value]) => (
                      key !== 'total' && value > 0 && (
                        <div key={key} className="status-item">
                          <span className="status-label">{key.replace(/_/g, ' ')}</span>
                          <span className="status-count">{value}</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default PowerBlockList;
