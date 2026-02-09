/**
 * ============================================
 * FileUpload — Drag & drop / click file upload component
 * ============================================
 * 
 * Uploads file to server via /api/files/upload,
 * then calls onUploaded callback with file data for message sending.
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileIcon, Image, Film, Music } from 'lucide-react';
import api from '../../services/api';
import { formatFileSize, isImageFile } from '../../utils/helpers';
import { MAX_FILE_SIZE } from '../../utils/constants';
import toast from 'react-hot-toast';

const FileUpload = ({ onUploaded }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((selectedFile) => {
    if (!selectedFile) return;

    if (selectedFile.size > MAX_FILE_SIZE) {
      toast.error(`File too large. Max size is ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }

    setFile(selectedFile);

    // Generate preview for images
    if (isImageFile(selectedFile.type)) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(selectedFile);
    } else {
      setPreview(null);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const droppedFile = e.dataTransfer.files?.[0];
    handleFile(droppedFile);
  }, [handleFile]);

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          const pct = Math.round((event.loaded * 100) / event.total);
          setProgress(pct);
        },
      });

      const fileData = res.data.data.file;

      onUploaded?.({
        url: fileData.url,
        name: fileData.originalName || file.name,
        size: fileData.size || file.size,
        mimeType: fileData.mimeType || file.type,
        type: isImageFile(file.type) ? 'image' : 'file',
      });

      // Reset
      setFile(null);
      setPreview(null);
      setProgress(0);
    } catch (error) {
      const msg = error.response?.data?.message || 'Upload failed';
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const getFileIcon = (mimeType) => {
    if (!mimeType) return <FileIcon size={24} />;
    if (mimeType.startsWith('image/')) return <Image size={24} className="text-blue-400" />;
    if (mimeType.startsWith('video/')) return <Film size={24} className="text-purple-400" />;
    if (mimeType.startsWith('audio/')) return <Music size={24} className="text-green-400" />;
    return <FileIcon size={24} className="text-dark-400" />;
  };

  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />

      {!file ? (
        /* Drop zone */
        <div
          onDrop={handleDrop}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all active:scale-[0.98] ${
            isDragging
              ? 'border-primary-400 bg-primary-500/10'
              : 'border-dark-600 hover:border-dark-500 hover:bg-dark-700/50'
          }`}
        >
          <div className={`w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center ${isDragging ? 'bg-primary-500/20' : 'bg-dark-700'}`}>
            <Upload size={20} className={isDragging ? 'text-primary-400' : 'text-dark-500'} />
          </div>
          <p className="text-sm text-dark-400 font-medium">
            {isDragging ? 'Drop file here' : 'Tap or drag file to upload'}
          </p>
          <p className="text-xs text-dark-600 mt-1">
            Max {formatFileSize(MAX_FILE_SIZE)}
          </p>
        </div>
      ) : (
        /* File preview */
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-xl">
            {/* Preview / icon */}
            {preview ? (
              <img src={preview} alt="Preview" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className="w-12 h-12 bg-dark-700 rounded-lg flex items-center justify-center">
                {getFileIcon(file.type)}
              </div>
            )}

            {/* File info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate font-medium">{file.name}</p>
              <p className="text-xs text-dark-500">{formatFileSize(file.size)}</p>
            </div>

            {/* Remove */}
            {!isUploading && (
              <button onClick={clearFile} className="btn-icon w-8 h-8 text-dark-400 hover:text-red-400">
                <X size={16} />
              </button>
            )}
          </div>

          {/* Progress bar */}
          {isUploading && (
            <div className="w-full bg-dark-700 rounded-full h-2">
              <div
                className="bg-primary-500 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Upload button */}
          {!isUploading && (
            <button
              onClick={handleUpload}
              className="btn-primary w-full py-3 text-sm font-medium flex items-center justify-center gap-2"
            >
              <Upload size={16} />
              Send File
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
