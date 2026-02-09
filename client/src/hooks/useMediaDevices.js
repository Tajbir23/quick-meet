/**
 * ============================================
 * useMediaDevices Hook
 * ============================================
 * 
 * Provides media device enumeration and selection.
 * Lists available cameras, microphones, and speakers.
 */

import { useState, useEffect, useCallback } from 'react';

const useMediaDevices = () => {
  const [devices, setDevices] = useState({
    audioInput: [],
    audioOutput: [],
    videoInput: [],
  });
  const [selectedDevices, setSelectedDevices] = useState({
    audioInput: null,
    audioOutput: null,
    videoInput: null,
  });
  const [error, setError] = useState(null);

  const enumerateDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        throw new Error('Media devices API not available');
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();

      const audioInput = allDevices.filter(d => d.kind === 'audioinput');
      const audioOutput = allDevices.filter(d => d.kind === 'audiooutput');
      const videoInput = allDevices.filter(d => d.kind === 'videoinput');

      setDevices({ audioInput, audioOutput, videoInput });

      // Set defaults (first device of each type)
      setSelectedDevices({
        audioInput: audioInput[0]?.deviceId || null,
        audioOutput: audioOutput[0]?.deviceId || null,
        videoInput: videoInput[0]?.deviceId || null,
      });

      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    enumerateDevices();

    // Re-enumerate when devices change (plug/unplug)
    navigator.mediaDevices?.addEventListener('devicechange', enumerateDevices);

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', enumerateDevices);
    };
  }, [enumerateDevices]);

  const selectDevice = (kind, deviceId) => {
    setSelectedDevices(prev => ({
      ...prev,
      [kind]: deviceId,
    }));
  };

  return {
    devices,
    selectedDevices,
    selectDevice,
    enumerateDevices,
    error,
    hasCamera: devices.videoInput.length > 0,
    hasMicrophone: devices.audioInput.length > 0,
  };
};

export default useMediaDevices;
