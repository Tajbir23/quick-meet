/**
 * ============================================
 * File Transfer Page — Dedicated P2P File Sharing
 * ============================================
 * 
 * Full page for P2P file transfer. Users can:
 * 1. Select a user from the list
 * 2. Pick file(s) to send
 * 3. View all active/completed transfers
 * 4. Manage transfers (pause, resume, cancel)
 * 
 * This page works independently of the chat system.
 */

import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, X, Upload, Download, HardDrive,
  Play, Pause, XCircle, CheckCircle, AlertCircle, Trash2,
  Users, Send, FileIcon, Film, Image, Music, FileText,
  Archive, Clock, Wifi, WifiOff, Shield, FolderUp, RefreshCw
} from 'lucide-react';
import useChatStore from '../store/useChatStore';
import useAuthStore from '../store/useAuthStore';
import useFileTransferStore from '../store/useFileTransferStore';
import { canReceiveLargeFiles, getPlatformCapability } from '../services/p2pFileTransfer';
import { MAX_P2P_FILE_SIZE, MAX_P2P_FILE_SIZE_BROWSER_MEMORY } from '../utils/constants';
import { getInitials, stringToColor, formatFileSize } from '../utils/helpers';
import { SERVER_URL } from '../utils/constants';
import toast from 'react-hot-toast';

// ── Helpers ────────────────────────────────────────────────
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};

const formatSpeed = (bytesPerSec) => {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
  return `${formatSize(bytesPerSec)}/s`;
};

const formatETA = (seconds) => {
  if (!seconds || !isFinite(seconds)) return '--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const getFileIcon = (fileName) => {
  const ext = fileName?.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'avi', 'mkv', 'mov', 'webm'].includes(ext)) return <Film size={20} className="text-purple-400" />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return <Image size={20} className="text-blue-400" />;
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'].includes(ext)) return <Music size={20} className="text-pink-400" />;
  if (['pdf', 'doc', 'docx', 'txt', 'xlsx', 'pptx', 'csv'].includes(ext)) return <FileText size={20} className="text-orange-400" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <Archive size={20} className="text-yellow-400" />;
  if (['iso', 'img', 'dmg'].includes(ext)) return <HardDrive size={20} className="text-emerald-400" />;
  return <FileIcon size={20} className="text-dark-300" />;
};

const statusConfig = {
  pending: { color: 'text-dark-400', bg: 'bg-dark-600', icon: Clock, label: 'Pending' },
  connecting: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Wifi, label: 'Connecting' },
  transferring: { color: 'text-primary-400', bg: 'bg-primary-500/10', icon: Upload, label: 'Transferring' },
  paused: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: Pause, label: 'Paused' },
  completed: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle, label: 'Completed' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10', icon: AlertCircle, label: 'Failed' },
  cancelled: { color: 'text-dark-400', bg: 'bg-dark-600', icon: XCircle, label: 'Cancelled' },
};

// ── Transfer Card Component ────────────────────────────────
const TransferCard = ({ transfer, onPause, onResume, onCancel }) => {
  const config = statusConfig[transfer.status] || statusConfig.pending;
  const StatusIcon = config.icon;
  const isActive = transfer.status === 'transferring' || transfer.status === 'connecting';
  const canPause = transfer.status === 'transferring';
  const canResume = transfer.status === 'paused';
  const canCancel = ['pending', 'connecting', 'transferring', 'paused'].includes(transfer.status);

  return (
    <div className={`bg-dark-800 rounded-2xl border border-dark-700/60 p-4 transition-all hover:border-dark-600 ${
      isActive ? 'ring-1 ring-primary-500/20' : ''
    }`}>
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="w-10 h-10 rounded-xl bg-dark-700/80 flex items-center justify-center flex-shrink-0">
          {getFileIcon(transfer.fileName)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-white truncate">{transfer.fileName}</p>
            {transfer.isReceiver ? (
              <Download size={12} className="text-blue-400 flex-shrink-0" />
            ) : (
              <Upload size={12} className="text-emerald-400 flex-shrink-0" />
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-dark-400 mb-2">
            <span>{formatSize(transfer.fileSize)}</span>
            <span className="text-dark-600">•</span>
            <span className={`flex items-center gap-1 ${config.color}`}>
              <StatusIcon size={10} />
              {config.label}
            </span>
            {transfer.status === 'transferring' && (
              <>
                <span className="text-dark-600">•</span>
                <span className="text-primary-300">{formatSpeed(transfer.speed)}</span>
                <span className="text-dark-600">•</span>
                <span>ETA: {formatETA(transfer.eta)}</span>
              </>
            )}
          </div>

          {/* Progress bar */}
          {(isActive || transfer.status === 'paused') && (
            <div className="relative">
              <div className="w-full h-1.5 bg-dark-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    transfer.status === 'paused' ? 'bg-yellow-500' : 'bg-gradient-to-r from-primary-500 to-primary-400'
                  }`}
                  style={{ width: `${Math.min(transfer.progress || 0, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-dark-500">{formatSize(transfer.bytesTransferred || 0)}</span>
                <span className="text-[10px] text-dark-500">{(transfer.progress || 0).toFixed(1)}%</span>
              </div>
            </div>
          )}

          {/* Completed stats */}
          {transfer.status === 'completed' && (
            <p className="text-[10px] text-emerald-400/70">
              ✓ Transfer complete — {formatSize(transfer.fileSize)}
            </p>
          )}

          {/* Error */}
          {transfer.status === 'failed' && transfer.error && (
            <p className="text-[10px] text-red-400/80 truncate">{transfer.error}</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {canPause && (
            <button
              onClick={() => onPause(transfer.transferId)}
              className="w-8 h-8 rounded-lg bg-dark-700 hover:bg-yellow-500/20 flex items-center justify-center transition-colors"
              title="Pause"
            >
              <Pause size={14} className="text-yellow-400" />
            </button>
          )}
          {canResume && (
            <button
              onClick={() => onResume(transfer.transferId)}
              className="w-8 h-8 rounded-lg bg-dark-700 hover:bg-emerald-500/20 flex items-center justify-center transition-colors"
              title="Resume"
            >
              <Play size={14} className="text-emerald-400" />
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => onCancel(transfer.transferId)}
              className="w-8 h-8 rounded-lg bg-dark-700 hover:bg-red-500/20 flex items-center justify-center transition-colors"
              title="Cancel"
            >
              <XCircle size={14} className="text-red-400" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main Page Component ────────────────────────────────────
const FileTransferPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Stores
  const currentUser = useAuthStore(s => s.user);
  const { users, onlineUsers } = useChatStore();
  const {
    transfers, sendFile, pauseTransfer, resumeTransfer,
    cancelTransfer, clearCompleted
  } = useFileTransferStore();

  // Local state
  const [selectedUser, setSelectedUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState('send'); // 'send' | 'transfers'

  // Platform capability
  const capability = getPlatformCapability();
  const maxSize = canReceiveLargeFiles() ? MAX_P2P_FILE_SIZE : MAX_P2P_FILE_SIZE_BROWSER_MEMORY;
  const maxLabel = canReceiveLargeFiles() ? '100GB' : '2GB';

  // Filter users
  const isOnline = (userId) => onlineUsers.some(u => u.userId === userId);
  const filteredUsers = users
    .filter(u => u._id !== currentUser?._id)
    .filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const aOn = isOnline(a._id);
      const bOn = isOnline(b._id);
      if (aOn && !bOn) return -1;
      if (!aOn && bOn) return 1;
      return a.username.localeCompare(b.username);
    });

  // Transfer list
  const transferList = Object.values(transfers);
  const activeTransfers = transferList.filter(t =>
    ['transferring', 'connecting', 'pending', 'paused'].includes(t.status)
  );
  const completedTransfers = transferList.filter(t =>
    ['completed', 'failed', 'cancelled'].includes(t.status)
  );

  // File selection handlers
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addFiles = (files) => {
    const validFiles = [];
    for (const file of files) {
      if (file.size > maxSize) {
        toast.error(`"${file.name}" is too large (${formatSize(file.size)}). Max: ${maxLabel}`, { duration: 4000 });
        continue;
      }
      // Prevent duplicates
      if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        validFiles.push(file);
      }
    }
    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Drag & drop
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, [selectedFiles, maxSize]);

  // Send files
  const handleSendFiles = async () => {
    if (!selectedUser || selectedFiles.length === 0) return;

    setSending(true);
    let successCount = 0;

    for (const file of selectedFiles) {
      try {
        await sendFile(file, selectedUser._id);
        successCount++;
      } catch (err) {
        toast.error(`Failed to send "${file.name}"`);
      }
    }

    if (successCount > 0) {
      toast.success(`Sending ${successCount} file${successCount > 1 ? 's' : ''} to ${selectedUser.username}`, { duration: 3000 });
      setSelectedFiles([]);
      setView('transfers'); // Switch to transfers view
    }
    setSending(false);
  };

  return (
    <div className="h-full flex flex-col bg-dark-900">
      {/* ── Header ────────────────────────────────────── */}
      <div className="h-14 bg-dark-800 border-b border-dark-700 flex items-center px-4 gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="btn-icon text-dark-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <HardDrive size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">P2P File Transfer</h1>
            <p className="text-[10px] text-dark-400">WebRTC Direct • Max {maxLabel}</p>
          </div>
        </div>

        {/* Platform badge */}
        <div className="ml-auto flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${
            capability === 'desktop-stream'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : capability === 'browser-fsaa'
              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
          }`}>
            <Shield size={10} />
            {capability === 'desktop-stream' ? 'Desktop App' : capability === 'browser-fsaa' ? 'Chrome/Edge' : 'Browser (2GB)'}
          </div>
        </div>
      </div>

      {/* ── Tab Bar ───────────────────────────────────── */}
      <div className="flex border-b border-dark-700 bg-dark-800/50">
        <button
          onClick={() => setView('send')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-all relative ${
            view === 'send' ? 'text-primary-400' : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          <Send size={14} />
          <span>Send Files</span>
          {view === 'send' && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary-400 rounded-full" />}
        </button>
        <button
          onClick={() => setView('transfers')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-all relative ${
            view === 'transfers' ? 'text-primary-400' : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          <RefreshCw size={14} />
          <span>Transfers</span>
          {activeTransfers.length > 0 && (
            <span className="w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] flex items-center justify-center font-bold">
              {activeTransfers.length}
            </span>
          )}
          {view === 'transfers' && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary-400 rounded-full" />}
        </button>
      </div>

      {/* ── Content ───────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {view === 'send' ? (
          <div className="h-full flex flex-col md:flex-row">
            {/* ── Left: User Selection ──────────────────── */}
            <div className="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-dark-700 flex flex-col flex-shrink-0 max-h-[40vh] md:max-h-full">
              {/* Search */}
              <div className="p-3 border-b border-dark-700/50">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search users..."
                    className="input-field pl-9 py-2 text-sm bg-dark-800"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {selectedUser && (
                  <div className="mt-2 flex items-center gap-2 bg-primary-500/10 border border-primary-500/20 rounded-xl px-3 py-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: stringToColor(selectedUser.username) }}
                    >
                      {getInitials(selectedUser.username)}
                    </div>
                    <span className="text-sm text-primary-300 font-medium flex-1 truncate">{selectedUser.username}</span>
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="text-primary-400 hover:text-primary-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* User list */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                <div className="px-3 py-2 flex items-center gap-2">
                  <Users size={12} className="text-dark-500" />
                  <span className="text-[10px] text-dark-500 uppercase font-semibold tracking-wider">
                    Select recipient ({filteredUsers.filter(u => isOnline(u._id)).length} online)
                  </span>
                </div>

                {filteredUsers.map(user => {
                  const online = isOnline(user._id);
                  const isSelected = selectedUser?._id === user._id;

                  return (
                    <button
                      key={user._id}
                      onClick={() => setSelectedUser(user)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all ${
                        isSelected
                          ? 'bg-primary-500/10 border-l-2 border-primary-400'
                          : 'hover:bg-dark-800 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        {user.avatar ? (
                          <img
                            src={`${SERVER_URL}${user.avatar}`}
                            alt={user.username}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                            style={{ backgroundColor: stringToColor(user.username) }}
                          >
                            {getInitials(user.username)}
                          </div>
                        )}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-900 ${
                          online ? 'bg-emerald-400' : 'bg-dark-500'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary-300' : 'text-white'}`}>
                          {user.username}
                        </p>
                        <p className={`text-[10px] ${online ? 'text-emerald-400' : 'text-dark-500'}`}>
                          {online ? 'Online — ready to receive' : 'Offline'}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckCircle size={16} className="text-primary-400 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}

                {filteredUsers.length === 0 && (
                  <div className="p-8 text-center">
                    <Users size={28} className="mx-auto text-dark-600 mb-2" />
                    <p className="text-dark-400 text-sm">No users found</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Right: File Selection & Send ──────────── */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Drop zone */}
              <div
                className={`flex-1 flex flex-col items-center justify-center p-6 transition-all ${
                  dragOver ? 'bg-primary-500/5 ring-2 ring-primary-500/30 ring-inset' : ''
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {selectedFiles.length === 0 ? (
                  /* Empty state — drop zone */
                  <div className="text-center max-w-md">
                    <div className={`w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center transition-all ${
                      dragOver
                        ? 'bg-primary-500/20 scale-110'
                        : 'bg-dark-800 border-2 border-dashed border-dark-600'
                    }`}>
                      <FolderUp size={32} className={dragOver ? 'text-primary-400' : 'text-dark-500'} />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {dragOver ? 'Drop files here' : 'Drag & drop files'}
                    </h3>
                    <p className="text-dark-400 text-sm mb-5">
                      or click to browse • Max {maxLabel} per file • WebRTC P2P direct
                    </p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-primary px-6 py-2.5 text-sm font-medium inline-flex items-center gap-2"
                    >
                      <Upload size={16} />
                      Browse Files
                    </button>

                    {/* Platform info */}
                    {capability === 'browser-memory' && (
                      <p className="mt-4 text-[10px] text-yellow-400/70">
                        ⚠ This browser uses memory for downloads. Max 2GB. Use Chrome/Edge or Desktop App for larger files.
                      </p>
                    )}
                  </div>
                ) : (
                  /* File list */
                  <div className="w-full max-w-xl space-y-2 overflow-y-auto max-h-full">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <FileIcon size={14} className="text-primary-400" />
                        {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
                        <span className="text-dark-400 font-normal">
                          ({formatSize(selectedFiles.reduce((sum, f) => sum + f.size, 0))} total)
                        </span>
                      </h3>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"
                      >
                        <Upload size={12} />
                        Add more
                      </button>
                    </div>

                    {selectedFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex items-center gap-3 bg-dark-800 rounded-xl p-3 border border-dark-700/60"
                      >
                        <div className="w-9 h-9 rounded-lg bg-dark-700/80 flex items-center justify-center flex-shrink-0">
                          {getFileIcon(file.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{file.name}</p>
                          <p className="text-[10px] text-dark-400">{formatSize(file.size)}</p>
                        </div>
                        <button
                          onClick={() => removeFile(index)}
                          className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center transition-colors"
                        >
                          <X size={14} className="text-dark-400 hover:text-red-400" />
                        </button>
                      </div>
                    ))}

                    {/* Send button */}
                    <div className="pt-4 flex items-center gap-3">
                      <button
                        onClick={() => setSelectedFiles([])}
                        className="btn-secondary px-4 py-2.5 text-sm flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        Clear
                      </button>
                      <button
                        onClick={handleSendFiles}
                        disabled={!selectedUser || sending}
                        className={`flex-1 py-2.5 text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-all ${
                          selectedUser && !sending
                            ? 'bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white shadow-lg shadow-primary-500/20'
                            : 'bg-dark-700 text-dark-500 cursor-not-allowed'
                        }`}
                      >
                        {sending ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            {selectedUser
                              ? `Send to ${selectedUser.username}`
                              : 'Select a user first'
                            }
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
        ) : (
          /* ── Transfers View ─────────────────────────── */
          <div className="h-full overflow-y-auto overscroll-contain p-4 space-y-4">
            {/* Active transfers */}
            {activeTransfers.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Wifi size={12} className="text-primary-400" />
                  Active Transfers ({activeTransfers.length})
                </h3>
                <div className="space-y-2">
                  {activeTransfers.map(t => (
                    <TransferCard
                      key={t.transferId}
                      transfer={t}
                      onPause={pauseTransfer}
                      onResume={resumeTransfer}
                      onCancel={cancelTransfer}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed transfers */}
            {completedTransfers.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle size={12} className="text-emerald-400" />
                    History ({completedTransfers.length})
                  </h3>
                  <button
                    onClick={clearCompleted}
                    className="text-[10px] text-dark-500 hover:text-dark-300 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 size={10} />
                    Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {completedTransfers.map(t => (
                    <TransferCard
                      key={t.transferId}
                      transfer={t}
                      onPause={pauseTransfer}
                      onResume={resumeTransfer}
                      onCancel={cancelTransfer}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {transferList.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="w-20 h-20 rounded-3xl bg-dark-800 flex items-center justify-center mb-5">
                  <HardDrive size={32} className="text-dark-600" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">No transfers yet</h3>
                <p className="text-dark-400 text-sm mb-5 max-w-sm">
                  Go to the "Send Files" tab to start a P2P file transfer with another user.
                </p>
                <button
                  onClick={() => setView('send')}
                  className="btn-primary px-5 py-2 text-sm flex items-center gap-2"
                >
                  <Send size={14} />
                  Send Files
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTransferPage;
