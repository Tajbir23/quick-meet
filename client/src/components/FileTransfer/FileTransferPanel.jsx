/**
 * ============================================
 * File Transfer Panel — Active Transfers UI
 * ============================================
 * 
 * Shows all active, paused, and completed P2P file transfers.
 * Includes progress bars, speed indicators, pause/resume/cancel controls.
 */

import { useState } from 'react';
import {
  X, Upload, Download, Pause, Play, XCircle,
  CheckCircle, AlertCircle, Clock, Wifi, WifiOff,
  ArrowUpCircle, ArrowDownCircle, Trash2, ChevronDown, ChevronUp,
  FolderOpen, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2,
} from 'lucide-react';
import useFileTransferStore from '../../store/useFileTransferStore';

/**
 * Format bytes to human-readable string
 */
const formatSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};

/**
 * Format speed (bytes/sec) to readable
 */
const formatSpeed = (bps) => {
  if (!bps || bps === 0) return '0 B/s';
  return `${formatSize(bps)}/s`;
};

/**
 * Format ETA in seconds to readable
 */
const formatETA = (seconds) => {
  if (!seconds || seconds === Infinity || seconds <= 0) return '--:--';
  if (seconds > 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds > 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds > 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
};

/**
 * Status badge colors
 */
const statusColors = {
  pending: 'text-yellow-400 bg-yellow-500/10',
  connecting: 'text-blue-400 bg-blue-500/10',
  transferring: 'text-green-400 bg-green-500/10',
  paused: 'text-orange-400 bg-orange-500/10',
  verifying: 'text-cyan-400 bg-cyan-500/10',
  completed: 'text-emerald-400 bg-emerald-500/10',
  failed: 'text-red-400 bg-red-500/10',
  cancelled: 'text-dark-400 bg-dark-500/10',
};

const statusIcons = {
  pending: Clock,
  connecting: Wifi,
  transferring: ArrowUpCircle,
  paused: Pause,
  verifying: Loader2,
  completed: CheckCircle,
  failed: AlertCircle,
  cancelled: XCircle,
};

/**
 * Single transfer item
 */
const TransferItem = ({ transfer }) => {
  const { cancelTransfer, pauseTransfer, resumeTransfer } = useFileTransferStore();
  const [expanded, setExpanded] = useState(false);

  const StatusIcon = statusIcons[transfer.status] || Clock;
  const isActive = ['transferring', 'connecting', 'pending', 'verifying'].includes(transfer.status);
  const canPause = transfer.status === 'transferring';
  const canResume = transfer.status === 'paused';
  const canCancel = ['transferring', 'paused', 'connecting', 'pending'].includes(transfer.status);

  return (
    <div className="bg-dark-700/50 rounded-xl p-3 border border-dark-600/50 hover:border-dark-500/50 transition-colors">
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Direction icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          transfer.isReceiver ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
        }`}>
          {transfer.isReceiver ? <Download size={18} /> : <Upload size={18} />}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-white font-medium truncate">{transfer.fileName}</p>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[transfer.status]}`}>
              {transfer.status}
            </span>
          </div>
          <p className="text-xs text-dark-400 mt-0.5">
            {formatSize(transfer.bytesTransferred || 0)} / {formatSize(transfer.fileSize)}
            {transfer.speed > 0 && transfer.status === 'transferring' && (
              <span className="ml-2 text-green-400">
                {formatSpeed(transfer.speed)} • ETA: {formatETA(transfer.eta)}
              </span>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {canPause && (
            <button
              onClick={() => pauseTransfer(transfer.transferId)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-dark-400 hover:text-orange-400 hover:bg-dark-600 transition-colors"
              title="Pause"
            >
              <Pause size={14} />
            </button>
          )}
          {canResume && (
            <button
              onClick={() => resumeTransfer(transfer.transferId)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-dark-400 hover:text-green-400 hover:bg-dark-600 transition-colors"
              title="Resume"
            >
              <Play size={14} />
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => cancelTransfer(transfer.transferId)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-dark-400 hover:text-red-400 hover:bg-dark-600 transition-colors"
              title="Cancel"
            >
              <XCircle size={14} />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-dark-500 hover:text-dark-300 hover:bg-dark-600 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isActive || transfer.status === 'paused' ? (
        <div className="mt-2.5">
          <div className="h-1.5 bg-dark-600 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                transfer.status === 'paused'
                  ? 'bg-orange-500'
                  : 'bg-gradient-to-r from-primary-500 to-primary-400'
              }`}
              style={{ width: `${Math.min(transfer.progress || 0, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-dark-500 mt-1 text-right">
            {(transfer.progress || 0).toFixed(1)}%
          </p>
        </div>
      ) : null}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-dark-600/50 space-y-1 text-xs text-dark-400">
          <p>Chunks: {transfer.currentChunk || 0} / {transfer.totalChunks}</p>
          <p>Direction: {transfer.isReceiver ? 'Receiving' : 'Sending'}</p>
          <p>Chunk size: {formatSize(transfer.chunkSize || 65536)}</p>
          {transfer.status === 'paused' && <p className="text-orange-400">Transfer paused — will resume when peer reconnects</p>}
          {transfer.status === 'completed' && transfer.isReceiver && transfer.savePath && (
            <p className="text-emerald-400 flex items-center gap-1">
              <FolderOpen size={12} />
              Saved to: {transfer.savePath}
            </p>
          )}
          {transfer.status === 'completed' && transfer.isReceiver && !transfer.savePath && (
            <p className="text-emerald-400 flex items-center gap-1">
              <FolderOpen size={12} />
              Saved to Downloads folder
            </p>
          )}
        </div>
      )}

      {/* Show save location on completion (without needing to expand) */}
      {transfer.status === 'completed' && transfer.isReceiver && (
        <div className="mt-2 space-y-1">
          {/* Save location */}
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80">
            <CheckCircle size={12} />
            <span className="truncate">
              {transfer.savePath
                ? `Saved: ${transfer.savePath}`
                : 'Saved to Downloads folder'}
            </span>
          </div>
          {/* Verification status */}
          {transfer.hashVerified === true && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <ShieldCheck size={12} />
              <span>File verified — integrity check passed</span>
            </div>
          )}
          {transfer.hashVerified === false && (
            <div className="flex items-center gap-1.5 text-[11px] text-red-400">
              <ShieldAlert size={12} />
              <span>Warning: File integrity check FAILED — file may be corrupted</span>
            </div>
          )}
          {transfer.hashStatus === 'no_hash' && (
            <div className="flex items-center gap-1.5 text-[11px] text-dark-500">
              <ShieldQuestion size={12} />
              <span>No hash — file not verified</span>
            </div>
          )}
          {transfer.hashStatus === 'unverifiable' && (
            <div className="flex items-center gap-1.5 text-[11px] text-yellow-500/70">
              <ShieldQuestion size={12} />
              <span>Streaming mode — hash verification skipped</span>
            </div>
          )}
        </div>
      )}

      {/* Verifying state */}
      {transfer.status === 'verifying' && transfer.isReceiver && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan-400">
          <Loader2 size={12} className="animate-spin" />
          <span>Verifying file integrity...</span>
        </div>
      )}

      {/* Sender-side: hash computation status */}
      {transfer.hashStatus === 'computing' && !transfer.isReceiver && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan-400">
          <Loader2 size={12} className="animate-spin" />
          <span>Computing file hash for verification...</span>
        </div>
      )}
      {transfer.hashStatus === 'skipped' && !transfer.isReceiver && transfer.status === 'pending' && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-dark-400">
          <ShieldQuestion size={12} />
          <span>Large file — hash verification skipped</span>
        </div>
      )}
    </div>
  );
};

/**
 * Main File Transfer Panel
 */
const FileTransferPanel = () => {
  const { transfers, showPanel, setShowPanel, clearCompleted } = useFileTransferStore();

  const transferList = Object.values(transfers);
  const activeCount = transferList.filter(t =>
    ['transferring', 'connecting', 'pending', 'paused'].includes(t.status)
  ).length;
  const completedCount = transferList.filter(t =>
    ['completed', 'failed', 'cancelled'].includes(t.status)
  ).length;

  if (!showPanel) return null;

  return (
    <div className="fixed bottom-4 right-4 w-[380px] max-h-[70vh] bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-500/10 flex items-center justify-center">
            <ArrowUpCircle size={16} className="text-primary-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">P2P Transfers</h3>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 bg-primary-500/20 text-primary-400 rounded text-[10px] font-medium">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {completedCount > 0 && (
            <button
              onClick={clearCompleted}
              className="text-dark-500 hover:text-dark-300 p-1 rounded-lg hover:bg-dark-700 transition-colors"
              title="Clear completed"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={() => setShowPanel(false)}
            className="text-dark-500 hover:text-dark-300 p-1 rounded-lg hover:bg-dark-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 overscroll-contain">
        {/* Active transfers */}
        {transferList.length > 0 ? (
          transferList
            .sort((a, b) => {
              // Active first, then paused, then completed
              const order = { transferring: 0, connecting: 1, pending: 2, paused: 3, completed: 4, failed: 5, cancelled: 6 };
              return (order[a.status] ?? 9) - (order[b.status] ?? 9);
            })
            .map((transfer) => (
              <TransferItem key={transfer.transferId} transfer={transfer} />
            ))
        ) : (
          <div className="py-8 text-center">
            <div className="text-3xl mb-2">📁</div>
            <p className="text-dark-500 text-xs">No active transfers</p>
            <p className="text-dark-600 text-[10px] mt-1">Files are sent directly P2P — never through the server</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTransferPanel;
