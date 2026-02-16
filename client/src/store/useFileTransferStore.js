/**
 * ============================================
 * File Transfer Store (Zustand)
 * ============================================
 * 
 * Manages P2P file transfer state for the UI.
 * 
 * STATE:
 * - transfers: Map of transferId → transfer info
 * - incomingRequests: pending transfer requests awaiting user action
 * - showPanel: whether the transfer panel is visible
 */

import { create } from 'zustand';
import p2pFileTransfer from '../services/p2pFileTransfer';
import { updateTransferProgress, dismissTransferNotification } from '../services/backgroundService';
import useAuthStore from './useAuthStore';

const useFileTransferStore = create((set, get) => ({
  // Active transfers: { [transferId]: { ...transferInfo } }
  transfers: {},
  // Incoming transfer requests pending user accept/reject
  incomingRequests: [],
  // Show the transfer panel
  showPanel: false,
  // Is initialized
  initialized: false,
  // Auto-accept flag: set when user taps Accept on notification before socket delivers the request
  // Can be `true` (accept any) or a specific transferId string
  autoAcceptTransferId: null,

  /**
   * Initialize the P2P file transfer system
   * Call once after socket connects
   */
  initialize: () => {
    if (get().initialized) {
      // Already initialized — but ensure listeners are still bound to the current socket
      p2pFileTransfer.ensureListeners();
      return;
    }

    // Set current user ID so pending-list can distinguish sender vs receiver
    const user = useAuthStore.getState().user;
    if (user?._id) {
      p2pFileTransfer.setCurrentUserId(user._id);
    }

    p2pFileTransfer.bindSocketListeners();

    // If binding failed (socket not ready), don't mark as initialized
    // so it can retry on next call
    if (!p2pFileTransfer._socketListenersBound) {
      console.warn('[FileTransferStore] ⚠️ Socket not ready — will retry initialization later');
      return;
    }

    // Wire up callbacks
    p2pFileTransfer.onTransferUpdate = (transferId, info) => {
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]: info,
        },
      }));

      // Update Android notification with transfer progress
      if (info && typeof info.progress === 'number') {
        const direction = info.direction === 'send' ? 'sending' : 'receiving';
        updateTransferProgress(
          info.fileName || 'file',
          Math.round(info.progress),
          direction
        );
      }
    };

    p2pFileTransfer.onIncomingTransfer = (data) => {
      // Check if auto-accept is pending (user tapped Accept on notification)
      const autoAccept = get().autoAcceptTransferId;
      if (autoAccept && (autoAccept === true || autoAccept === data.transferId)) {
        console.log(`[FileTransferStore] Auto-accepting transfer: ${data.transferId}`);
        set({ autoAcceptTransferId: null });
        // Accept immediately — socket is connected (we just received this via socket)
        p2pFileTransfer.acceptTransfer(data);
        dismissTransferNotification();
        return;
      }
      
      set((state) => ({
        incomingRequests: [
          ...state.incomingRequests.filter(r => r.transferId !== data.transferId),
          data,
        ],
        showPanel: true, // Auto-show panel on incoming request
      }));
    };

    p2pFileTransfer.onTransferComplete = (transferId) => {
      // Keep in transfers for history, but update status
      const transfer = get().transfers[transferId];
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]: {
            ...state.transfers[transferId],
            status: 'completed',
          },
        },
      }));

      // Show completion in Android notification
      const direction = transfer?.direction === 'send' ? 'sending' : 'receiving';
      updateTransferProgress(transfer?.fileName || 'file', 100, direction);
    };

    p2pFileTransfer.onTransferError = (transferId, error) => {
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]: {
            ...state.transfers[transferId],
            status: 'failed',
            error: error?.message || 'Transfer failed',
          },
        },
      }));
      // Dismiss Android transfer notification on error
      dismissTransferNotification();
    };

    // Check for pending transfers (resume)
    p2pFileTransfer.checkPendingTransfers();

    set({ initialized: true });
  },

  /**
   * Send a file to a user
   */
  sendFile: async (file, receiverId) => {
    try {
      const transferId = await p2pFileTransfer.sendFile(file, receiverId);
      set({ showPanel: true });
      return transferId;
    } catch (err) {
      console.error('Failed to initiate file transfer:', err);
      throw err;
    }
  },

  /**
   * Accept an incoming transfer request
   */
  acceptTransfer: async (transferData) => {
    try {
      await p2pFileTransfer.acceptTransfer(transferData);
      // Dismiss Android incoming transfer notification
      dismissTransferNotification();
      // Remove from incoming requests
      set((state) => ({
        incomingRequests: state.incomingRequests.filter(
          r => r.transferId !== transferData.transferId
        ),
      }));
    } catch (err) {
      console.error('Failed to accept transfer:', err);
    }
  },

  /**
   * Reject an incoming transfer request
   */
  rejectTransfer: (transferId) => {
    p2pFileTransfer.rejectTransfer(transferId);
    dismissTransferNotification();
    set((state) => ({
      incomingRequests: state.incomingRequests.filter(
        r => r.transferId !== transferId
      ),
    }));
  },

  /**
   * Cancel an active transfer
   */
  cancelTransfer: (transferId) => {
    p2pFileTransfer.cancelTransfer(transferId);
    set((state) => {
      const newTransfers = { ...state.transfers };
      delete newTransfers[transferId];
      return { transfers: newTransfers };
    });
  },

  /**
   * Pause a transfer
   */
  pauseTransfer: (transferId) => {
    p2pFileTransfer.pauseTransfer(transferId);
  },

  /**
   * Resume a transfer
   */
  resumeTransfer: (transferId) => {
    p2pFileTransfer.resumeTransfer(transferId);
  },

  /**
   * Toggle panel visibility
   */
  togglePanel: () => set((state) => ({ showPanel: !state.showPanel })),
  setShowPanel: (show) => set({ showPanel: show }),

  /**
   * Clear completed/failed transfers from the list
   */
  clearCompleted: () => {
    set((state) => {
      const newTransfers = {};
      Object.entries(state.transfers).forEach(([id, t]) => {
        if (t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled') {
          newTransfers[id] = t;
        }
      });
      return { transfers: newTransfers };
    });
  },

  /**
   * Cleanup on logout
   */
  cleanup: () => {
    p2pFileTransfer.destroyAll();
    set({
      transfers: {},
      incomingRequests: [],
      showPanel: false,
      initialized: false,
      autoAcceptTransferId: null,
    });
  },
}));

export default useFileTransferStore;
