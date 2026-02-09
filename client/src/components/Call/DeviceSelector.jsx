/**
 * ============================================
 * DeviceSelector Component
 * ============================================
 */

import { useState, useEffect, useRef } from 'react';
import { X, Mic, Speaker, Camera } from 'lucide-react';
import useMediaDevices from '../../hooks/useMediaDevices';
import useCallStore from '../../store/useCallStore';

const DeviceSelector = ({ onClose }) => {
  const { devices, selectedDevices, selectDevice, enumerateDevices } = useMediaDevices();
  const { switchAudioDevice, switchVideoDevice, switchAudioOutput, callType } = useCallStore();
  const [switching, setSwitching] = useState(null);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);

  // Refresh device list on mount
  useEffect(() => {
    enumerateDevices();
  }, [enumerateDevices]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleAudioInputChange = async (deviceId) => {
    try {
      setSwitching('audioInput');
      setError(null);
      selectDevice('audioInput', deviceId);
      await switchAudioDevice(deviceId);
    } catch (err) {
      setError('Failed to switch microphone');
      console.error(err);
    } finally {
      setSwitching(null);
    }
  };

  const handleVideoInputChange = async (deviceId) => {
    try {
      setSwitching('videoInput');
      setError(null);
      selectDevice('videoInput', deviceId);
      await switchVideoDevice(deviceId);
    } catch (err) {
      setError('Failed to switch camera');
      console.error(err);
    } finally {
      setSwitching(null);
    }
  };

  const handleAudioOutputChange = async (deviceId) => {
    try {
      setSwitching('audioOutput');
      setError(null);
      selectDevice('audioOutput', deviceId);
      const remoteAudio = document.querySelector('#remote-audio, #remote-video');
      if (remoteAudio) {
        await switchAudioOutput(remoteAudio, deviceId);
      }
    } catch (err) {
      setError('Failed to switch speaker');
      console.error(err);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-dark-800 rounded-2xl shadow-2xl border border-dark-600 p-4 w-[calc(100vw-2rem)] max-w-xs z-50 animate-slide-up"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm">Device Settings</h3>
        <button
          onClick={onClose}
          className="text-dark-400 hover:text-white transition-colors p-1 rounded-full hover:bg-dark-700"
        >
          <X size={16} />
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Microphone Selection */}
      <div className="mb-3">
        <label className="flex items-center gap-2 text-dark-300 text-xs mb-1.5 font-medium">
          <Mic size={13} />
          Microphone
          {switching === 'audioInput' && <span className="animate-spin text-primary-400">⏳</span>}
        </label>
        <select
          value={selectedDevices.audioInput || ''}
          onChange={(e) => handleAudioInputChange(e.target.value)}
          disabled={switching === 'audioInput'}
          className="w-full bg-dark-900 text-white text-sm rounded-xl px-3 py-2.5 border border-dark-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/50 disabled:opacity-50 transition-all"
        >
          {devices.audioInput.length === 0 && (
            <option value="">No microphone found</option>
          )}
          {devices.audioInput.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
      </div>

      {/* Speaker Selection */}
      {devices.audioOutput.length > 0 && (
        <div className="mb-3">
          <label className="flex items-center gap-2 text-dark-300 text-xs mb-1.5 font-medium">
            <Speaker size={13} />
            Speaker / Headphone
            {switching === 'audioOutput' && <span className="animate-spin text-primary-400">⏳</span>}
          </label>
          <select
            value={selectedDevices.audioOutput || ''}
            onChange={(e) => handleAudioOutputChange(e.target.value)}
            disabled={switching === 'audioOutput'}
            className="w-full bg-dark-900 text-white text-sm rounded-xl px-3 py-2.5 border border-dark-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/50 disabled:opacity-50 transition-all"
          >
            {devices.audioOutput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Camera Selection (only for video calls) */}
      {callType === 'video' && (
        <div className="mb-3">
          <label className="flex items-center gap-2 text-dark-300 text-xs mb-1.5 font-medium">
            <Camera size={13} />
            Camera
            {switching === 'videoInput' && <span className="animate-spin text-primary-400">⏳</span>}
          </label>
          <select
            value={selectedDevices.videoInput || ''}
            onChange={(e) => handleVideoInputChange(e.target.value)}
            disabled={switching === 'videoInput'}
            className="w-full bg-dark-900 text-white text-sm rounded-xl px-3 py-2.5 border border-dark-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/50 disabled:opacity-50 transition-all"
          >
            {devices.videoInput.length === 0 && (
              <option value="">No camera found</option>
            )}
            {devices.videoInput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-dark-500 text-[10px] mt-2 text-center">
        Switch devices during an active call
      </p>
    </div>
  );
};

export default DeviceSelector;
