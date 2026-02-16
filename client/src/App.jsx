import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import useAuthStore from './store/useAuthStore';
import { onForceLogout } from './services/socket';
import { initBackgroundService, stopService as stopBgService, setNotificationActionCallbacks } from './services/backgroundService';
import { initPushNotifications, unregisterPushNotifications } from './services/pushNotifications';
import useCallStore from './store/useCallStore';
import useFileTransferStore from './store/useFileTransferStore';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import HomePage from './pages/HomePage';
import OwnerDashboard from './pages/OwnerDashboard';
import FileTransferPage from './pages/FileTransferPage';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import IncomingCall from './components/Call/IncomingCall';
import IncomingGroupCall from './components/Call/IncomingGroupCall';
import NetworkStatus from './components/Common/NetworkStatus';
import Notification from './components/Common/Notification';
import UpdateNotification from './components/Common/UpdateNotification';
import StatusBar from './components/Common/StatusBar';
import FileTransferPanel from './components/FileTransfer/FileTransferPanel';
import FileTransferIndicator from './components/FileTransfer/FileTransferIndicator';
import IncomingFileTransfer from './components/FileTransfer/IncomingFileTransfer';

function App() {
  const { checkAuth, isAuthenticated, isLoading, isOwner, handleForceLogout } = useAuthStore();

  const handleForceReload = useCallback(() => {
    // Clear all caches and hard reload
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }
    // Clear session storage
    try { sessionStorage.clear(); } catch (e) {}
    // Hard reload bypassing cache
    window.location.reload(true);
  }, []);

  // Initialize background service when authenticated (Android foreground service)
  useEffect(() => {
    if (isAuthenticated) {
      initBackgroundService();
      initPushNotifications(); // Register FCM push notifications

      // Wire notification action buttons to store actions
      setNotificationActionCallbacks({
        onAnswerCall: () => {
          const callStore = useCallStore.getState();
          if (callStore.incomingCall) {
            callStore.acceptCall();
          }
        },
        onDeclineCall: () => {
          const callStore = useCallStore.getState();
          if (callStore.incomingCall) {
            callStore.rejectCall();
          }
        },
        onAcceptTransfer: () => {
          const ftStore = useFileTransferStore.getState();
          const pending = ftStore.incomingRequests;
          if (pending.length > 0) {
            // Accept the most recent incoming transfer
            ftStore.acceptTransfer(pending[pending.length - 1]);
          }
        },
        onRejectTransfer: () => {
          const ftStore = useFileTransferStore.getState();
          const pending = ftStore.incomingRequests;
          if (pending.length > 0) {
            ftStore.rejectTransfer(pending[pending.length - 1].transferId);
          }
        },
      });
    } else {
      stopBgService();
      unregisterPushNotifications(); // Remove FCM token on logout
    }
  }, [isAuthenticated]);

  useEffect(() => {
    checkAuth();
    // Wire up socket force-logout to auth store
    onForceLogout((reason) => handleForceLogout(reason));
  }, [checkAuth, handleForceLogout]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-dark-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-white text-2xl font-bold">Q</span>
          </div>
          <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-dark-400 text-sm font-medium">Loading Quick Meet...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-dark-900 overflow-hidden flex flex-col">
      <NetworkStatus />
      <Notification />
      <UpdateNotification />
      {isAuthenticated && <StatusBar />}
      {isAuthenticated && <IncomingCall />}
      {isAuthenticated && <IncomingGroupCall />}
      {isAuthenticated && <IncomingFileTransfer />}
      {isAuthenticated && <FileTransferPanel />}
      {isAuthenticated && <FileTransferIndicator />}

      {/* Force Reload Button — always visible, works even when socket disconnected */}
      <button
        onClick={handleForceReload}
        title="Force Reload"
        className="fixed bottom-4 left-4 z-[9997] w-10 h-10 rounded-full bg-dark-800/80 hover:bg-dark-700 border border-dark-600 hover:border-primary-500/50 text-dark-400 hover:text-primary-400 flex items-center justify-center transition-all duration-200 shadow-lg backdrop-blur-sm active:scale-90"
      >
        <RefreshCw size={16} />
      </button>

      <div className="flex-1 overflow-hidden">
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/signup"
          element={isAuthenticated ? <Navigate to="/" replace /> : <SignupPage />}
        />
        <Route
          path="/owner/*"
          element={
            <ProtectedRoute>
              {isOwner ? <OwnerDashboard /> : <Navigate to="/" replace />}
            </ProtectedRoute>
          }
        />
        <Route
          path="/transfer"
          element={
            <ProtectedRoute>
              <FileTransferPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
      </Routes>
      </div>
    </div>
  );
}

export default App;
