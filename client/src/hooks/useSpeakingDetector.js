/**
 * ============================================
 * useSpeakingDetector Hook
 * ============================================
 *
 * Uses Web Audio API (AudioContext + AnalyserNode) to detect
 * whether a MediaStream has active audio (someone is speaking).
 *
 * Returns a boolean `isSpeaking` that flips true when
 * the average audio volume exceeds a threshold.
 *
 * WHY Web Audio API:
 * - Only reliable way to detect actual audio amplitude
 * - Works on both local and remote MediaStreams
 * - Low CPU: uses requestAnimationFrame with throttle
 *
 * USAGE:
 *   const isSpeaking = useSpeakingDetector(stream);
 */

import { useState, useEffect, useRef } from 'react';

const THRESHOLD = 15;       // Volume level (0-255) above which = "speaking"
const SMOOTHING = 0.3;      // AnalyserNode smoothing (0 = responsive, 1 = sluggish)
const CHECK_INTERVAL = 150; // ms between checks (lower = more responsive but more CPU)

const useSpeakingDetector = (stream) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const lastCheckRef = useRef(0);
  const prevStreamIdRef = useRef(null);

  useEffect(() => {
    // Bail out if no stream or no audio tracks
    if (!stream || stream.getAudioTracks().length === 0) {
      setIsSpeaking(false);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState === 'ended') {
      setIsSpeaking(false);
      return;
    }

    // Build a unique ID for this stream's audio track
    const streamId = audioTrack.id;

    // If same track is already connected, skip re-setup
    if (streamId === prevStreamIdRef.current && ctxRef.current) {
      return;
    }
    prevStreamIdRef.current = streamId;

    // Clean up previous audio context
    cleanup();

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = SMOOTHING;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      // Don't connect analyser to destination — we're only analysing, not playing

      ctxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const detect = (timestamp) => {
        rafRef.current = requestAnimationFrame(detect);

        // Throttle checks
        if (timestamp - lastCheckRef.current < CHECK_INTERVAL) return;
        lastCheckRef.current = timestamp;

        if (!analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        setIsSpeaking(average > THRESHOLD);
      };

      rafRef.current = requestAnimationFrame(detect);
    } catch (err) {
      console.warn('useSpeakingDetector: AudioContext error:', err.message);
    }

    return cleanup;
  }, [stream]);

  function cleanup() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch (e) { /* ignore */ }
      sourceRef.current = null;
    }
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      try { ctxRef.current.close(); } catch (e) { /* ignore */ }
      ctxRef.current = null;
    }
    analyserRef.current = null;
  }

  return isSpeaking;
};

export default useSpeakingDetector;
