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

const useFileTransferStore = create((set, get) => ({
  // Active transfers: { [transferId]: { ...transferInfo } }
  transfers: {},
  // Incoming transfer requests pending user accept/reject
  incomingRequests: [],
  // Show the transfer panel
  showPanel: false,
  // Is initialized
  initialized: false,

  /**
   * Initialize the P2P file transfer system
   * Call once after socket connects
   */
  initialize: () => {
    if (get().initialized) return;

    p2pFileTransfer.bindSocketListeners();

    // Wire up callbacks
    p2pFileTransfer.onTransferUpdate = (transferId, info) => {
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]: info,
        },
      }));
    };

    p2pFileTransfer.onIncomingTransfer = (data) => {
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
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]: {
            ...state.transfers[transferId],
            status: 'completed',
          },
        },
      }));
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
    });
  },
}));

export default useFileTransferStore;
