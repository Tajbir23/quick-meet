/**
 * ============================================
 * ImagePreview — Full-screen image preview popup
 * ============================================
 * 
 * Opens when user clicks on a chat image.
 * Features: zoom, download button, close on backdrop click/Esc.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Download, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { SERVER_URL } from '../../utils/constants';

const ImagePreview = ({ imageUrl, fileName, onClose }) => {
  const [downloading, setDownloading] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${SERVER_URL}${imageUrl}`;

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (downloading) return;

    const filename = imageUrl.split('/').pop();
    const downloadUrl = `${SERVER_URL}/api/files/download/${filename}`;
    const downloadName = fileName || filename;

    try {
      setDownloading(true);

      // Electron: use native file download via IPC
      if (window.electronAPI?.downloadFile) {
        const result = await window.electronAPI.downloadFile(downloadUrl, downloadName);
        if (!result.success && result.error !== 'Cancelled') {
          throw new Error(result.error);
        }
        return;
      }

      // Browser: fetch blob and trigger download
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      window.open(downloadUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10">
        <p className="text-white text-sm font-medium truncate max-w-[60%]">
          {fileName || 'Image'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setZoomed(!zoomed); }}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            title={zoomed ? 'Zoom out' : 'Zoom in'}
          >
            {zoomed ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors disabled:opacity-50"
            title="Download"
          >
            {downloading ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Loading spinner */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={36} className="text-white animate-spin" />
        </div>
      )}

      {/* Image */}
      <img
        src={fullUrl}
        alt={fileName || 'Preview'}
        className={`max-h-[85vh] max-w-[90vw] object-contain transition-transform duration-300 select-none ${
          zoomed ? 'scale-150 cursor-zoom-out' : 'cursor-zoom-in'
        } ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => { e.stopPropagation(); setZoomed(!zoomed); }}
        onLoad={() => setLoaded(true)}
        draggable={false}
      />
    </div>
  );
};

export default ImagePreview;
