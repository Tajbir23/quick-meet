/**
 * ============================================
 * File Transfer Indicator — Floating Button
 * ============================================
 * 
 * Shows a floating button when there are active transfers.
 * Click to toggle the FileTransferPanel.
 */

import { ArrowUpDown } from 'lucide-react';
import useFileTransferStore from '../../store/useFileTransferStore';

const FileTransferIndicator = () => {
  const { transfers, incomingRequests, showPanel, togglePanel } = useFileTransferStore();

  const transferList = Object.values(transfers);
  const activeCount = transferList.filter(t =>
    ['transferring', 'connecting', 'pending', 'paused'].includes(t.status)
  ).length;
  const pendingCount = incomingRequests.length;
  const totalCount = activeCount + pendingCount;

  // Don't show if no transfers and panel is closed
  if (totalCount === 0 && !showPanel) return null;

  // Calculate overall progress
  const activeTransfers = transferList.filter(t => t.status === 'transferring');
  const overallProgress = activeTransfers.length > 0
    ? activeTransfers.reduce((sum, t) => sum + (t.progress || 0), 0) / activeTransfers.length
    : 0;

  return (
    <button
      onClick={togglePanel}
      className={`fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95 ${
        showPanel
          ? 'bg-dark-700 text-dark-400'
          : pendingCount > 0
          ? 'bg-primary-600 text-white animate-pulse'
          : 'bg-dark-700 text-primary-400 border border-dark-600'
      }`}
      title={`${totalCount} transfer${totalCount !== 1 ? 's' : ''}`}
    >
      <ArrowUpDown size={20} />
      
      {/* Badge */}
      {totalCount > 0 && !showPanel && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {totalCount}
        </span>
      )}

      {/* Progress ring */}
      {activeTransfers.length > 0 && !showPanel && (
        <svg className="absolute inset-0 w-12 h-12 -rotate-90" viewBox="0 0 48 48">
          <circle
            cx="24" cy="24" r="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={`${(overallProgress / 100) * 138.2} 138.2`}
            className="text-primary-400"
          />
        </svg>
      )}
    </button>
  );
};

export default FileTransferIndicator;
