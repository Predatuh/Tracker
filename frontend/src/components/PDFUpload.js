import React, { useState } from 'react';
import { pdf_api } from '../api/apiClient';
import './PDFUpload.css';
import { useAppContext } from '../context/AppContext';

function PDFUpload() {
  const { currentTracker, trackerSettings } = useAppContext();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadedPDF, setUploadedPDF] = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);
  const [pageList, setPageList] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState([]);

  const subtitle = trackerSettings?.ui_text?.sub_dashboard
    || 'Upload source PDFs, choose the relevant pages, and move them into the current tracker workflow.';

  const toImagePath = (imagePath) => {
    if (!imagePath) return null;
    return `/${String(imagePath).replace(/\\/g, '/')}`;
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setError('');
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a PDF file');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await pdf_api.uploadPDF(file);
      setUploadedPDF(response.data.data);
      setSuccess(`PDF uploaded successfully! Total pages: ${response.data.data.page_count}`);
      setPageList(Array.from({ length: response.data.data.page_count }, (_, i) => i + 1));
      setFile(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Error uploading PDF');
    } finally {
      setLoading(false);
    }
  };

  const handlePageSelect = (pageNum) => {
    if (selectedPages.includes(pageNum)) {
      setSelectedPages(selectedPages.filter(p => p !== pageNum));
    } else {
      setSelectedPages([...selectedPages, pageNum]);
    }
  };

  const handleExtractPages = async () => {
    if (selectedPages.length === 0) {
      setError('Please select at least one page');
      return;
    }

    setExtracting(true);
    setError('');

    try {
      const response = await pdf_api.extractPages(uploadedPDF.pdf_path, selectedPages);
      setExtracted(response.data.extracted_pages);
      setSuccess('Pages extracted successfully!');
    } catch (err) {
      setError(err.response?.data?.error || 'Error extracting pages');
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="pdf-upload upload-shell">
      <section className="container upload-hero">
        <div>
          <span className="dashboard-kicker">{currentTracker?.name || 'Tracker'} Intake</span>
          <h1 className="section-title">Upload & Extract PDF Pages</h1>
          <p className="upload-hero-copy">{subtitle}</p>
        </div>
        <div className="upload-hero-grid">
          <div className="upload-hero-card">
            <span>Selected File</span>
            <strong>{file?.name || uploadedPDF?.filename || 'None'}</strong>
          </div>
          <div className="upload-hero-card">
            <span>Total Pages</span>
            <strong>{uploadedPDF?.page_count || 0}</strong>
          </div>
          <div className="upload-hero-card">
            <span>Chosen Pages</span>
            <strong>{selectedPages.length}</strong>
          </div>
          <div className="upload-hero-card">
            <span>Extracted</span>
            <strong>{extracted.length}</strong>
          </div>
        </div>
      </section>

      <section className="container upload-panel">

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {!uploadedPDF ? (
          <div className="upload-section">
            <div className="upload-dropzone">
              <div className="form-group">
                <label>Select PDF File</label>
                <input
                  className="upload-file-input"
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  disabled={loading}
                />
              </div>
              <p className="info-text">Upload the source PDF, then pick only the pages that should become power blocks.</p>
            </div>
            <button
              className="btn btn-success"
              onClick={handleUpload}
              disabled={!file || loading}
            >
              {loading ? 'Uploading...' : 'Upload PDF'}
            </button>
          </div>
        ) : (
          <div className="upload-workflow">
            <div className="alert alert-info">
              PDF uploaded: <strong>{uploadedPDF.filename}</strong> ({uploadedPDF.page_count} pages)
            </div>

            <div className="upload-section-head">
              <div>
                <span className="dashboard-kicker">Page Selection</span>
                <h2 className="section-title">Select Pages to Extract</h2>
              </div>
            </div>
            <p className="info-text">
              Choose which pages you want to extract as power block images.
            </p>

            <div className="page-selector">
              {pageList.map(pageNum => (
                <label key={pageNum} className={`page-option ${selectedPages.includes(pageNum) ? 'page-option--active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedPages.includes(pageNum)}
                    onChange={() => handlePageSelect(pageNum)}
                  />
                  <span>Page {pageNum}</span>
                </label>
              ))}
            </div>

            <div className="upload-action-row">
              <button
                className="btn btn-success"
                onClick={handleExtractPages}
                disabled={selectedPages.length === 0 || extracting}
              >
                {extracting ? 'Extracting...' : `Extract ${selectedPages.length} Page(s)`}
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => {
                  setUploadedPDF(null);
                  setSelectedPages([]);
                  setExtracted([]);
                  setPageList([]);
                }}
              >
                Upload Another PDF
              </button>
            </div>

            {extracted.length > 0 && (
              <div className="extracted-section">
                <div className="upload-section-head">
                  <div>
                    <span className="dashboard-kicker">Output</span>
                    <h2 className="section-title">Extracted Pages</h2>
                  </div>
                </div>
                <div className="extracted-list">
                  {extracted.map((page, idx) => (
                    <div key={idx} className="extracted-item">
                      <div className="page-info">
                        Page {page.page_number}
                      </div>
                      <img src={toImagePath(page.image_path)} alt={`Page ${page.page_number}`} />
                    </div>
                  ))}
                </div>
                <p className="success-text">
                  Ready to create power blocks. Go to {currentTracker?.dashboard_blocks_label || 'Power Blocks'} to manage these pages.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default PDFUpload;
