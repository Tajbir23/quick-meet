/**
 * ============================================
 * ChannelView — Main Channel Post Viewer
 * ============================================
 * 
 * Full-screen channel view with:
 * - Header with channel info, live badge, member count
 * - Scrollable post feed
 * - Admin post composer at bottom
 * - Channel info side panel
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, Radio, Info, Volume2, Users, Search,
  ChevronDown, Loader2, Pin, X
} from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import ChannelPost from './ChannelPost';
import ChannelPostInput from './ChannelPostInput';
import ChannelInfo from './ChannelInfo';
import ChannelLiveStream from './ChannelLiveStream';
import { getSocket } from '../../services/socket';

const ChannelView = () => {
  const activeChat = useChatStore(s => s.activeChat);
  const clearActiveChat = useChatStore(s => s.clearActiveChat);
  const user = useAuthStore(s => s.user);

  const activeChannel = useChannelStore(s => s.activeChannel);
  const channelPosts = useChannelStore(s => s.channelPosts);
  const pinnedPosts = useChannelStore(s => s.pinnedPosts);
  const isLoadingPosts = useChannelStore(s => s.isLoadingPosts);
  const hasMorePosts = useChannelStore(s => s.hasMorePosts);
  const fetchPosts = useChannelStore(s => s.fetchPosts);
  const fetchMorePosts = useChannelStore(s => s.fetchMorePosts);
  const fetchPinnedPosts = useChannelStore(s => s.fetchPinnedPosts);
  const getChannelById = useChannelStore(s => s.getChannelById);
  const setActiveChannel = useChannelStore(s => s.setActiveChannel);
  const liveStream = useChannelStore(s => s.liveStream);

  const containerRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showPinnedBar, setShowPinnedBar] = useState(true);
  const [pinnedIndex, setPinnedIndex] = useState(0);

  // Determine user role in channel
  const myMember = activeChannel?.members?.find(m => {
    const uid = m.user?._id || m.user;
    return uid === user?._id;
  });
  const myRole = myMember?.role || 'subscriber';
  const canPost = myRole === 'owner' || myRole === 'admin' ||
    (myRole === 'moderator' && myMember?.permissions?.post_messages !== false);
  const isOwner = activeChannel?.owner?._id === user?._id || activeChannel?.owner === user?._id;

  // Fetch channel data when selected
  useEffect(() => {
    if (!activeChat?.id || activeChat.type !== 'channel') return;

    const loadChannel = async () => {
      // Fetch full channel data if not already loaded
      if (!activeChannel || activeChannel._id !== activeChat.id) {
        await getChannelById(activeChat.id);
      }
      await fetchPosts(activeChat.id);
      await fetchPinnedPosts(activeChat.id);

      // Join socket room
      const socket = getSocket();
      if (socket) {
        socket.emit('channel:join-room', { channelId: activeChat.id });
      }
    };

    loadChannel();
  }, [activeChat?.id]);

  // Auto-show live stream when channel is live
  useEffect(() => {
    if (activeChannel?.liveStream?.isLive) {
      setShowLive(true);
    }
  }, [activeChannel?.liveStream?.isLive]);

  // Scroll handling
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Show scroll-to-bottom button
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);

    // Load more posts when scrolling to top
    if (el.scrollTop < 100 && hasMorePosts && !isLoadingPosts) {
      fetchMorePosts(activeChat.id);
    }
  }, [hasMorePosts, isLoadingPosts, activeChat?.id]);

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  };

  // Auto-scroll to bottom on new posts
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 300) {
      scrollToBottom();
    }
  }, [channelPosts.length]);

  const handleBack = () => {
    clearActiveChat();
    useChannelStore.getState().setActiveChannel(null);
  };

  if (!activeChat || activeChat.type !== 'channel') return null;

  const subscriberCount = activeChannel?.stats?.subscriberCount || activeChat.memberCount || 0;
  const isLive = activeChannel?.liveStream?.isLive;

  return (
    <div className="absolute inset-0 flex flex-col bg-dark-900">
      {/* Header */}
      <div className="h-16 bg-dark-800 border-b border-dark-700 flex items-center px-4 gap-3 flex-shrink-0">
        <button
          onClick={handleBack}
          className="md:hidden btn-icon text-dark-400 hover:text-white flex-shrink-0"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <Radio size={18} className="text-indigo-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white truncate">{activeChat.name}</h2>
            {isLive ? (
              <button
                onClick={() => setShowLive(true)}
                className="bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5 animate-pulse hover:bg-red-600 transition-colors"
              >
                LIVE
              </button>
            ) : (isOwner || myRole === 'admin') ? (
              <button
                onClick={() => setShowLive(true)}
                className="bg-dark-600 text-dark-300 text-[10px] font-semibold rounded-full px-2 py-0.5 hover:bg-indigo-500/20 hover:text-indigo-400 transition-colors"
              >
                Go Live
              </button>
            ) : null}
          </div>
          <p className="text-xs text-dark-400">
            {subscriberCount} subscribers
            {activeChat.username && ` · @${activeChat.username}`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowInfo(true)}
            className="btn-icon text-dark-400 hover:text-indigo-400 hover:bg-indigo-500/10"
          >
            <Info size={18} />
          </button>
        </div>
      </div>

      {/* Pinned posts bar */}
      {showPinnedBar && pinnedPosts.length > 0 && (
        <div className="bg-dark-800/80 border-b border-dark-700 px-4 py-2 flex items-center gap-3 backdrop-blur-sm">
          <Pin size={14} className="text-amber-400 flex-shrink-0" />
          <button
            onClick={() => {
              setPinnedIndex((pinnedIndex + 1) % pinnedPosts.length);
            }}
            className="flex-1 text-left min-w-0"
          >
            <p className="text-xs text-dark-300 truncate">
              {pinnedPosts[pinnedIndex]?.content || 'Pinned post'}
            </p>
            {pinnedPosts.length > 1 && (
              <p className="text-[10px] text-dark-500">
                {pinnedIndex + 1} of {pinnedPosts.length} pinned
              </p>
            )}
          </button>
          <button onClick={() => setShowPinnedBar(false)} className="text-dark-500 hover:text-dark-300">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Live stream viewer/broadcaster (overlay) */}
      {showLive && (
        <ChannelLiveStream
          channel={activeChannel}
          onClose={() => setShowLive(false)}
        />
      )}

      {/* Posts feed */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4"
      >
        {/* Loading more indicator */}
        {isLoadingPosts && channelPosts.length > 0 && (
          <div className="flex justify-center py-3">
            <Loader2 size={20} className="animate-spin text-dark-500" />
          </div>
        )}

        {/* Initial loading */}
        {isLoadingPosts && channelPosts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-indigo-400 mb-3" />
            <p className="text-dark-400 text-sm">Loading posts...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoadingPosts && channelPosts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full">
            <Radio size={48} className="text-dark-600 mb-4" />
            <h3 className="text-lg font-semibold text-dark-300 mb-1">No posts yet</h3>
            <p className="text-dark-500 text-sm">
              {canPost ? 'Create the first post!' : 'Posts will appear here'}
            </p>
          </div>
        )}

        {/* Posts */}
        {channelPosts.map(post => (
          <ChannelPost
            key={post._id}
            post={post}
            canManage={canPost}
            isOwner={isOwner}
            myRole={myRole}
            channelId={activeChat.id}
          />
        ))}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-6 w-10 h-10 bg-dark-700 border border-dark-600 rounded-full flex items-center justify-center shadow-lg hover:bg-dark-600 transition-colors z-10"
        >
          <ChevronDown size={20} className="text-dark-300" />
        </button>
      )}

      {/* Post input (admins/mods only) */}
      {canPost && (
        <ChannelPostInput channelId={activeChat.id} />
      )}

      {/* Channel info side panel */}
      {showInfo && (
        <ChannelInfo
          channel={activeChannel}
          onClose={() => setShowInfo(false)}
          myRole={myRole}
          isOwner={isOwner}
        />
      )}
    </div>
  );
};

export default ChannelView;
