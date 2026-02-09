/**
 * ============================================
 * DeviceSelector Component
 * ============================================
 * 
 * Dropdown panel to select microphone, camera,
 * and speaker devices during an active call.
 * Uses useMediaDevices hook for enumeration.
 */

import { useState, useEffect, useRef } from 'react';
import useMediaDevices from '../../hooks/useMediaDevices';
import useCallStore from '../../store/useCallStore';

const DeviceSelector = ({ onClose }) => {
  const { devices, selectedDevices, selectDevice, enumerateDevices } = useMediaDevices();
  const { switchAudioDevice, switchVideoDevice, switchAudioOutput, callType } = useCallStore();
  const [switching, setSwitching] = useState(null); // track which is switching
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
      setError('মাইক্রোফোন পরিবর্তন করতে সমস্যা হয়েছে');
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
      setError('ক্যামেরা পরিবর্তন করতে সমস্যা হয়েছে');
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
      // Find the remote audio/video element and switch its output
      const remoteAudio = document.querySelector('#remote-audio, #remote-video');
      if (remoteAudio) {
        await switchAudioOutput(remoteAudio, deviceId);
      }
    } catch (err) {
      setError('স্পিকার পরিবর্তন করতে সমস্যা হয়েছে');
      console.error(err);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-gray-900 rounded-xl shadow-2xl border border-gray-700 p-4 w-80 z-50"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">ডিভাইস সেটিংস</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Microphone Selection */}
      <div className="mb-3">
        <label className="block text-gray-400 text-xs mb-1 flex items-center gap-1">
          🎤 মাইক্রোফোন
          {switching === 'audioInput' && <span className="animate-spin">⏳</span>}
        </label>
        <select
          value={selectedDevices.audioInput || ''}
          onChange={(e) => handleAudioInputChange(e.target.value)}
          disabled={switching === 'audioInput'}
          className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        >
          {devices.audioInput.length === 0 && (
            <option value="">কোনো মাইক্রোফোন পাওয়া যায়নি</option>
          )}
          {devices.audioInput.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `মাইক্রোফোন ${device.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
      </div>

      {/* Speaker Selection */}
      {devices.audioOutput.length > 0 && (
        <div className="mb-3">
          <label className="block text-gray-400 text-xs mb-1 flex items-center gap-1">
            🔊 স্পিকার / হেডফোন
            {switching === 'audioOutput' && <span className="animate-spin">⏳</span>}
          </label>
          <select
            value={selectedDevices.audioOutput || ''}
            onChange={(e) => handleAudioOutputChange(e.target.value)}
            disabled={switching === 'audioOutput'}
            className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {devices.audioOutput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `স্পিকার ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Camera Selection (only for video calls) */}
      {callType === 'video' && (
        <div className="mb-3">
          <label className="block text-gray-400 text-xs mb-1 flex items-center gap-1">
            📹 ক্যামেরা
            {switching === 'videoInput' && <span className="animate-spin">⏳</span>}
          </label>
          <select
            value={selectedDevices.videoInput || ''}
            onChange={(e) => handleVideoInputChange(e.target.value)}
            disabled={switching === 'videoInput'}
            className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {devices.videoInput.length === 0 && (
              <option value="">কোনো ক্যামেরা পাওয়া যায়নি</option>
            )}
            {devices.videoInput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `ক্যামেরা ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-gray-500 text-[10px] mt-2">
        💡 কল চলাকালীন ডিভাইস পরিবর্তন করা যাবে
      </p>
    </div>
  );
};

export default DeviceSelector;
