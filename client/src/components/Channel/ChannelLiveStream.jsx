/**
 * ============================================
 * ChannelLiveStream — Live Stream View
 * ============================================
 * 
 * Features:
 * - Video player for live stream (WebRTC)
 * - Live chat overlay
 * - Viewer count
 * - Start/Stop controls for admins
 * - Join as viewer
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Radio, Users, Send, Maximize2, Minimize2,
  Volume2, VolumeX, Zap, Play, Square, MessageCircle
} from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useAuthStore from '../../store/useAuthStore';
import { getSocket } from '../../services/socket';
import { ICE_SERVERS } from '../../utils/constants';
import { formatMessageTime } from '../../utils/helpers';

const ChannelLiveStream = ({ channel, onClose }) => {
  const user = useAuthStore(s => s.user);
  const liveStream = useChannelStore(s => s.liveStream);
  const liveChat = useChannelStore(s => s.liveChat);
  const liveViewerCount = useChannelStore(s => s.liveViewerCount);
  const startLiveStream = useChannelStore(s => s.startLiveStream);
  const stopLiveStream = useChannelStore(s => s.stopLiveStream);
  const joinLiveStream = useChannelStore(s => s.joinLiveStream);
  const leaveLiveStream = useChannelStore(s => s.leaveLiveStream);
  const sendLiveChatMessage = useChannelStore(s => s.sendLiveChatMessage);

  const videoRef = useRef(null);
  const chatEndRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const [chatMessage, setChatMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [streamTitle, setStreamTitle] = useState('');
  const [showStartForm, setShowStartForm] = useState(false);

  const isLive = channel?.liveStream?.isLive;
  const isChannelOwner = channel?.owner?._id === user?._id || channel?.owner === user?._id;
  const myMember = channel?.members?.find(m => (m.user?._id || m.user) === user?._id);
  const canManageLive = isChannelOwner || myMember?.role === 'admin';

  // Auto-scroll live chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveChat.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupWebRTC();
    };
  }, []);

  const cleanupWebRTC = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
  };

  // ─── BROADCASTER: Start streaming ───
  const handleStartStream = async () => {
    if (!streamTitle.trim()) return;

    try {
      // Get camera + mic
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });
      localStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Start stream on server
      await startLiveStream(channel._id, { title: streamTitle.trim() });
      setIsBroadcasting(true);
      setShowStartForm(false);

      // Set up WebRTC for broadcasting
      const socket = getSocket();
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('channel:live-stream-ice', {
            channelId: channel._id,
            candidate: event.candidate,
          });
        }
      };

      // Listen for viewer offers
      socket.on('channel:live-stream-offer', async ({ viewerId, offer }) => {
        // For each viewer, create answer (simplified — in production use SFU)
        const answer = await pc.createAnswer();
        // This is simplified; real implementation would need per-viewer PeerConnection
        socket.emit('channel:live-stream-answer', {
          channelId: channel._id,
          targetUserId: viewerId,
          answer,
        });
      });

      // Create initial offer for the broadcast
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('channel:live-stream-offer', {
        channelId: channel._id,
        offer,
      });

    } catch (err) {
      console.error('Failed to start stream:', err);
    }
  };

  // ─── VIEWER: Join stream ───
  const handleJoinAsViewer = async () => {
    try {
      await joinLiveStream(channel._id);
      const socket = getSocket();

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('channel:live-stream-ice', {
            channelId: channel._id,
            candidate: event.candidate,
          });
        }
      };

      // Listen for broadcaster's answer
      socket.on('channel:live-stream-answer', async ({ answer }) => {
        if (pc.signalingState !== 'closed') {
          await pc.setRemoteDescription(answer);
        }
      });

      // Listen for ICE candidates
      socket.on('channel:live-stream-ice', async ({ candidate }) => {
        if (pc.signalingState !== 'closed') {
          await pc.addIceCandidate(candidate);
        }
      });

      // Request offer from broadcaster
      socket.emit('channel:live-stream-request-offer', {
        channelId: channel._id,
      });

    } catch (err) {
      console.error('Failed to join stream:', err);
    }
  };

  // ─── Stop stream ───
  const handleStopStream = async () => {
    if (!window.confirm('Stop the live stream?')) return;
    await stopLiveStream(channel._id);
    cleanupWebRTC();
    setIsBroadcasting(false);
  };

  // ─── Leave stream ───
  const handleLeave = () => {
    leaveLiveStream(channel._id);
    cleanupWebRTC();
    onClose();
  };

  // ─── Send chat ───
  const handleSendChat = () => {
    if (!chatMessage.trim()) return;
    sendLiveChatMessage(channel._id, chatMessage.trim());
    setChatMessage('');
  };

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50' : 'relative'} bg-black flex flex-col`}>
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">
            <Zap size={12} />
            LIVE
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {channel?.liveStream?.title || channel?.name || 'Live Stream'}
            </p>
            <div className="flex items-center gap-2 text-xs text-dark-300">
              <span className="flex items-center gap-1">
                <Users size={11} />
                {liveViewerCount} watching
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChat(!showChat)}
            className={`btn-icon text-white/70 hover:text-white ${showChat ? 'bg-white/10' : ''}`}
          >
            <MessageCircle size={18} />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="btn-icon text-white/70 hover:text-white"
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button onClick={handleLeave} className="btn-icon text-white/70 hover:text-red-400">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 flex items-center justify-center relative min-h-[200px]">
        {isLive || isBroadcasting ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isMuted || isBroadcasting}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-center">
            <Radio size={48} className="text-dark-600 mx-auto mb-4" />
            <p className="text-dark-400 text-sm mb-4">Stream is offline</p>
            {canManageLive && !showStartForm && (
              <button
                onClick={() => setShowStartForm(true)}
                className="btn-primary flex items-center gap-2 mx-auto"
              >
                <Play size={16} /> Start Streaming
              </button>
            )}
            {showStartForm && (
              <div className="bg-dark-800 rounded-xl p-4 max-w-sm mx-auto">
                <input
                  type="text"
                  value={streamTitle}
                  onChange={(e) => setStreamTitle(e.target.value)}
                  placeholder="Stream title..."
                  className="input-field w-full mb-3"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={handleStartStream} className="btn-primary flex-1 flex items-center justify-center gap-2">
                    <Play size={16} /> Go Live
                  </button>
                  <button onClick={() => setShowStartForm(false)} className="btn-secondary px-4">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Volume control */}
        {(isLive || isBroadcasting) && !isBroadcasting && (
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="absolute bottom-4 left-4 btn-icon bg-black/50 text-white/70 hover:text-white"
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        )}

        {/* Join as viewer button */}
        {isLive && !isBroadcasting && !pcRef.current && (
          <button
            onClick={handleJoinAsViewer}
            className="absolute bottom-4 right-4 btn-primary flex items-center gap-2"
          >
            <Play size={16} /> Watch Stream
          </button>
        )}

        {/* Stop stream button for broadcaster */}
        {isBroadcasting && (
          <button
            onClick={handleStopStream}
            className="absolute bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600 flex items-center gap-2 text-sm"
          >
            <Square size={16} /> Stop Stream
          </button>
        )}
      </div>

      {/* Live chat */}
      {showChat && (
        <div className={`${isFullscreen ? 'absolute right-0 top-0 bottom-0 w-80' : 'h-48'} bg-dark-900/90 backdrop-blur-sm border-t border-dark-700 flex flex-col`}>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {liveChat.map((msg, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-xs font-medium text-indigo-400 flex-shrink-0">
                  {msg.username}:
                </span>
                <span className="text-xs text-dark-200 break-words">{msg.content}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-2 p-2 border-t border-dark-700">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              placeholder="Say something..."
              className="input-field flex-1 text-xs py-2"
            />
            <button
              onClick={handleSendChat}
              disabled={!chatMessage.trim()}
              className="btn-icon w-8 h-8 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChannelLiveStream;
