/**
 * ============================================
 * CallControls — Audio/Video/Screen/EndCall buttons
 * + Device Selector (settings gear)
 * ============================================
 */

import { useState } from 'react';
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  PhoneOff, Settings
} from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import DeviceSelector from './DeviceSelector';
import toast from 'react-hot-toast';

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
  } = useCallStore();

  const [showDeviceSelector, setShowDeviceSelector] = useState(false);

  const handleScreenShare = async () => {
    try {
      await toggleScreenShare();
    } catch (err) {
      toast.error('Screen sharing failed');
    }
  };

  const btnSize = compact ? 'w-10 h-10' : 'w-12 h-12';
  const iconSize = compact ? 18 : 22;

  return (
    <div className="relative flex items-center justify-center gap-3">
      {/* Device Selector (Settings gear) */}
      <button
        onClick={() => setShowDeviceSelector(!showDeviceSelector)}
        className={`${btnSize} rounded-full flex items-center justify-center transition-all ${
          showDeviceSelector
            ? 'bg-primary-500/20 text-primary-400'
            : 'bg-dark-700 hover:bg-dark-600 text-white'
        }`}
        title="Device settings"
      >
        <Settings size={iconSize} />
      </button>

      {/* Mic toggle */}
      <button
        onClick={toggleAudio}
        className={`${btnSize} rounded-full flex items-center justify-center transition-all ${
          isAudioEnabled
            ? 'bg-dark-700 hover:bg-dark-600 text-white'
            : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
        }`}
        title={isAudioEnabled ? 'Mute' : 'Unmute'}
      >
        {isAudioEnabled ? <Mic size={iconSize} /> : <MicOff size={iconSize} />}
      </button>

      {/* Camera toggle (video calls only) */}
      {callType === 'video' && (
        <button
          onClick={toggleVideo}
          className={`${btnSize} rounded-full flex items-center justify-center transition-all ${
            isVideoEnabled
              ? 'bg-dark-700 hover:bg-dark-600 text-white'
              : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          }`}
          title={isVideoEnabled ? 'Camera off' : 'Camera on'}
        >
          {isVideoEnabled ? <Video size={iconSize} /> : <VideoOff size={iconSize} />}
        </button>
      )}

      {/* Screen share */}
      <button
        onClick={handleScreenShare}
        className={`${btnSize} rounded-full flex items-center justify-center transition-all ${
          isScreenSharing
            ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
            : 'bg-dark-700 hover:bg-dark-600 text-white'
        }`}
        title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
      >
        {isScreenSharing ? <MonitorOff size={iconSize} /> : <Monitor size={iconSize} />}
      </button>

      {/* End call */}
      <button
        onClick={endCall}
        className={`${btnSize} rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all`}
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
