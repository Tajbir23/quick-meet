/**
 * ============================================
 * CallControls — Audio/Video/Screen/EndCall buttons
 * + Device Selector (settings gear)
 * ============================================
 */

import { useState } from 'react';
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  PhoneOff, Settings, Minimize2
} from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import DeviceSelector from './DeviceSelector';
import toast from 'react-hot-toast';
import { isNative } from '../../utils/platform';

const CallControls = ({ compact = false }) => {
  const {
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    callType,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    endCall,
    toggleMinimize,
  } = useCallStore();

  const [showDeviceSelector, setShowDeviceSelector] = useState(false);

  const handleScreenShare = async () => {
    // Screen share is not possible on mobile native apps (Android/iOS WebView limitation)
    if (isNative()) {
      toast.error('Screen sharing is not available on mobile devices');
      return;
    }
    try {
      await toggleScreenShare();
    } catch (err) {
      toast.error(err?.message || 'Screen sharing failed');
    }
  };

  const btnBase = compact
    ? 'w-12 h-12 md:w-11 md:h-11'
    : 'w-14 h-14 md:w-12 md:h-12';
  const iconSize = compact ? 20 : 24;

  return (
    <div className="relative flex items-center justify-center gap-3 md:gap-3">
      {/* Device Selector (Settings gear) */}
      <button
        onClick={() => setShowDeviceSelector(!showDeviceSelector)}
        className={`${btnBase} rounded-full flex items-center justify-center transition-all ${
          showDeviceSelector
            ? 'bg-primary-500/20 text-primary-400 ring-2 ring-primary-400/30'
            : 'bg-dark-700/80 hover:bg-dark-600 text-white backdrop-blur-sm'
        }`}
        title="Device settings"
      >
        <Settings size={iconSize - 2} />
      </button>

      {/* Mic toggle */}
      <button
        onClick={toggleAudio}
        className={`${btnBase} rounded-full flex items-center justify-center transition-all ${
          isAudioEnabled
            ? 'bg-dark-700/80 hover:bg-dark-600 text-white backdrop-blur-sm'
            : 'bg-red-500/20 text-red-400 ring-2 ring-red-400/30'
        }`}
        title={isAudioEnabled ? 'Mute' : 'Unmute'}
      >
        {isAudioEnabled ? <Mic size={iconSize} /> : <MicOff size={iconSize} />}
      </button>

      {/* Camera toggle (video calls only) */}
      {callType === 'video' && (
        <button
          onClick={toggleVideo}
          className={`${btnBase} rounded-full flex items-center justify-center transition-all ${
            isVideoEnabled
              ? 'bg-dark-700/80 hover:bg-dark-600 text-white backdrop-blur-sm'
              : 'bg-red-500/20 text-red-400 ring-2 ring-red-400/30'
          }`}
          title={isVideoEnabled ? 'Camera off' : 'Camera on'}
        >
          {isVideoEnabled ? <Video size={iconSize} /> : <VideoOff size={iconSize} />}
        </button>
      )}

      {/* Screen share */}
      <button
        onClick={handleScreenShare}
        className={`${btnBase} rounded-full flex items-center justify-center transition-all ${
          isScreenSharing
            ? 'bg-primary-500/20 text-primary-400 ring-2 ring-primary-400/30'
            : 'bg-dark-700/80 hover:bg-dark-600 text-white backdrop-blur-sm'
        }`}
        title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
      >
        {isScreenSharing ? <MonitorOff size={iconSize} /> : <Monitor size={iconSize} />}
      </button>

      {/* Minimize call */}
      <button
        onClick={toggleMinimize}
        className={`${btnBase} rounded-full flex items-center justify-center transition-all bg-dark-700/80 hover:bg-dark-600 text-white backdrop-blur-sm`}
        title="Minimize call"
      >
        <Minimize2 size={iconSize} />
      </button>

      {/* End call */}
      <button
        onClick={endCall}
        className={`${btnBase} rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 text-white flex items-center justify-center transition-all shadow-lg shadow-red-500/25`}
        title="End call"
      >
        <PhoneOff size={iconSize} />
      </button>

      {/* Device selector panel */}
      {showDeviceSelector && (
        <DeviceSelector onClose={() => setShowDeviceSelector(false)} />
      )}
    </div>
  );
};

export default CallControls;
