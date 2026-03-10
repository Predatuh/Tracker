import React, { useState } from 'react';
import { pdf_api } from '../api/apiClient';
import './PDFUpload.css';

function PDFUpload() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadedPDF, setUploadedPDF] = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);
  const [pageList, setPageList] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState([]);

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
    <div className="pdf-upload container">
      <h1 className="section-title">Upload & Extract PDF Pages</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {!uploadedPDF ? (
        <div className="upload-section">
          <div className="form-group">
            <label>Select PDF File</label>
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              disabled={loading}
            />
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
        <div>
          <div className="alert alert-info">
            ✅ PDF uploaded: <strong>{uploadedPDF.filename}</strong> ({uploadedPDF.page_count} pages)
          </div>

          <h2 className="section-subtitle">Select Pages to Extract</h2>
          <p className="info-text">
            Choose which pages you want to extract as power block images
          </p>

          <div className="page-selector">
            {pageList.map(pageNum => (
              <label key={pageNum} className="page-option">
                <input
                  type="checkbox"
                  checked={selectedPages.includes(pageNum)}
                  onChange={() => handlePageSelect(pageNum)}
                />
                Page {pageNum}
              </label>
            ))}
          </div>

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
            style={{ marginLeft: '10px' }}
          >
            Upload Another PDF
          </button>

          {extracted.length > 0 && (
            <div className="extracted-section">
              <h2 className="section-subtitle">Extracted Pages</h2>
              <div className="extracted-list">
                {extracted.map((page, idx) => (
                  <div key={idx} className="extracted-item">
                    <div className="page-info">
                      Page {page.page_number}
                    </div>
                    <img src={page.image_path} alt={`Page ${page.page_number}`} />
                  </div>
                ))}
              </div>
              <p className="success-text">
                ✅ Ready to create power blocks! Go to Power Blocks to manage these pages.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PDFUpload;
