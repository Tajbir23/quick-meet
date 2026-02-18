import { useEffect, useRef, useState, useCallback } from 'react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import PinnedMessages from './PinnedMessages';
import Header from '../Layout/Header';
import GroupChat from '../Group/GroupChat';
import ForwardMessageModal from '../Common/ForwardMessageModal';
import UserProfileModal from '../Common/UserProfileModal';
import { formatDateSeparator, shouldShowDateSeparator, formatMessageTime } from '../../utils/helpers';
import { ChevronDown, Pin, X, ChevronUp, Loader2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const ChatWindow = () => {
  // Use individual selectors to prevent re-rendering when unrelated
  // store state changes (e.g., 'users' or 'onlineUsers' updates).
  // Without selectors, ANY state change in useChatStore triggers re-render.
  const activeChat = useChatStore(s => s.activeChat);
  const messages = useChatStore(s => s.messages);
  const fetchMessages = useChatStore(s => s.fetchMessages);
  const isLoadingMessages = useChatStore(s => s.isLoadingMessages);
  const isLoadingMore = useChatStore(s => s.isLoadingMore);
  const typingUsers = useChatStore(s => s.typingUsers);
  const markAsRead = useChatStore(s => s.markAsRead);
  const showPinnedPanel = useChatStore(s => s.showPinnedPanel);
  const pinnedMessages = useChatStore(s => s.pinnedMessages);
  const fetchPinnedMessages = useChatStore(s => s.fetchPinnedMessages);
  const pinMessage = useChatStore(s => s.pinMessage);
  const unpinMessage = useChatStore(s => s.unpinMessage);
  const user = useAuthStore(s => s.user);
  const containerRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const prevMsgCountRef = useRef(0);
  const [pagination, setPagination] = useState(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [viewProfileUser, setViewProfileUser] = useState(null);
  const [pinnedPreviewIndex, setPinnedPreviewIndex] = useState(0);
  const [pinnedBarDismissed, setPinnedBarDismissed] = useState(false);

  // Delete message handler
  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.delete(`/messages/${messageId}`);
      // Remove from local store
      useChatStore.setState((state) => ({
        messages: {
          ...state.messages,
          [activeChat.id]: (state.messages[activeChat.id] || []).filter(m => m._id !== messageId),
        },
      }));
      toast.success('Message deleted');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete message');
    }
  };

  // Forward message handler
  const handleForwardMessage = (message) => {
    setForwardMessage(message);
  };

  // Pin / Unpin handler
  const handlePinMessage = async (message) => {
    try {
      if (message.isPinned) {
        await unpinMessage(message._id, activeChat.id, activeChat.type);
        toast.success('Message unpinned');
      } else {
        await pinMessage(message._id, activeChat.id, activeChat.type);
        toast.success('Message pinned');
      }
    } catch {
      toast.error(message.isPinned ? 'Failed to unpin' : 'Failed to pin');
    }
  };

  // Scroll to a specific message (used by PinnedMessages panel)
  const scrollToMessage = (messageId) => {
    const el = containerRef.current;
    if (!el) return;
    const msgEl = el.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('bg-amber-500/10');
      setTimeout(() => msgEl.classList.remove('bg-amber-500/10'), 2000);
    }
  };

  // View profile handler
  const handleViewProfile = (sender) => {
    const userId = typeof sender === 'object' ? (sender._id || sender.id) : sender;
    if (userId) setViewProfileUser(userId);
  };

  // Fetch messages when active chat changes
  useEffect(() => {
    if (activeChat) {
      fetchMessages(activeChat.id, activeChat.type).then(pag => {
        setPagination(pag);
      });
      // Mark as read
      if (activeChat.type === 'user') {
        markAsRead(activeChat.id);
      }
    }
    setShowGroupInfo(false); // Close group info when switching chats
    useChatStore.getState().closePinnedPanel(); // Close pinned panel when switching chats
    setPinnedPreviewIndex(0);
    setPinnedBarDismissed(false);
    // Fetch pinned messages for the preview bar
    if (activeChat) {
      fetchPinnedMessages(activeChat.id, activeChat.type);
    }
  }, [activeChat?.id]);

  // Auto scroll to bottom only for NEW messages (not when loading older pages)
  useEffect(() => {
    const el = containerRef.current;
    const currentMsgs = messages[activeChat?.id] || [];
    const prevCount = prevMsgCountRef.current;

    if (el && currentMsgs.length > 0) {
      if (loadingMoreRef.current) {
        // Older messages were prepended — preserve scroll position
        const newScrollHeight = el.scrollHeight;
        const addedHeight = newScrollHeight - (el._prevScrollHeight || 0);
        el.scrollTop = addedHeight;
        loadingMoreRef.current = false;
      } else {
        // New message arrived or first load — scroll to bottom
        el.scrollTop = el.scrollHeight;
      }
    }

    prevMsgCountRef.current = currentMsgs.length;
  }, [messages[activeChat?.id]?.length]);

  if (!activeChat) return null;

  const chatMessages = messages[activeChat.id] || [];
  const typing = typingUsers[activeChat.id];
  const isTyping = typing && Object.keys(typing).length > 0;

  // Pinned preview bar data — defensive
  const currentPinnedList = (pinnedMessages && activeChat && Array.isArray(pinnedMessages[activeChat.id]))
    ? pinnedMessages[activeChat.id]
    : [];
  const hasPinnedMessages = currentPinnedList.length > 0 && !pinnedBarDismissed;
  const safeIndex = hasPinnedMessages ? (pinnedPreviewIndex % currentPinnedList.length) : 0;
  const currentPinnedMsg = hasPinnedMessages ? currentPinnedList[safeIndex] : null;

  // Cycle through pinned messages (Telegram-style)
  const handlePinnedBarClick = () => {
    if (!currentPinnedMsg || !currentPinnedMsg._id) return;
    scrollToMessage(currentPinnedMsg._id);
    if (currentPinnedList.length > 1) {
      setPinnedPreviewIndex((prev) => (prev + 1) % currentPinnedList.length);
    }
  };

  const getPinnedPreviewText = (msg) => {
    if (!msg) return '';
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      return msg.content.length > 80 ? msg.content.substring(0, 80) + '...' : msg.content;
    }
    if (msg.fileUrl) {
      const isImage = msg.fileMimeType && msg.fileMimeType.startsWith('image/');
      return isImage ? '📷 Photo' : `📎 ${msg.fileName || 'File'}`;
    }
    if (msg.type === 'call') return '📞 Call';
    return 'Pinned message';
  };

  // Load more messages (scroll to top) with loading guard & scroll preservation
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Show scroll-to-bottom button when scrolled up
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);

    // Trigger load when scrolled near top (within 50px)
    if (
      el.scrollTop < 50 &&
      pagination &&
      pagination.page < pagination.pages &&
      !loadingMoreRef.current
    ) {
      loadingMoreRef.current = true;
      el._prevScrollHeight = el.scrollHeight;
      fetchMessages(activeChat.id, activeChat.type, pagination.page + 1).then(pag => {
        setPagination(pag);
      }).catch(() => {
        loadingMoreRef.current = false;
      });
    }
  }, [pagination, activeChat?.id, activeChat?.type, fetchMessages]);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-dark-900 absolute inset-0">
      {/* Chat header (Fixed height) */}
      <div className="flex-shrink-0">
        <Header
          onToggleGroupInfo={() => setShowGroupInfo(prev => !prev)}
          showGroupInfo={showGroupInfo}
        />
      </div>

      {/* Chat body: messages + optional group info panel side by side */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

      {/* Messages column */}
      <div className="flex-1 flex flex-col min-w-0">

      {/* Telegram-style pinned message preview bar */}
      {hasPinnedMessages && currentPinnedMsg && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 md:px-4 py-2 bg-dark-800/90 border-b border-dark-700/50 backdrop-blur-sm cursor-pointer hover:bg-dark-750 transition-colors group/pin"
          onClick={handlePinnedBarClick}
        >
          {/* Left accent line + pin icon */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-0.5 h-8 bg-primary-500 rounded-full" />
            <Pin size={14} className="text-primary-400 flex-shrink-0" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-primary-400">
                Pinned Message{currentPinnedList.length > 1 ? ` #${safeIndex + 1}` : ''}
              </span>
              {currentPinnedList.length > 1 && (
                <span className="text-[10px] text-dark-500">of {currentPinnedList.length}</span>
              )}
            </div>
            <p className="text-[12px] text-dark-300 truncate leading-snug mt-0.5">
              {getPinnedPreviewText(currentPinnedMsg)}
            </p>
          </div>

          {/* Cycle / Close buttons */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {currentPinnedList.length > 1 && (
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-dark-400 opacity-0 group-hover/pin:opacity-100 transition-opacity">
                <ChevronUp size={14} />
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setPinnedBarDismissed(true); }}
              className="w-5 h-5 rounded-full flex items-center justify-center text-dark-500 hover:text-dark-300 opacity-0 group-hover/pin:opacity-100 transition-opacity"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Messages area (Flexible height, scrollable) */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4 space-y-1 overscroll-contain min-h-0"
        onScroll={handleScroll}
      >
        {/* Loading older messages spinner at top */}
        {isLoadingMore && (
          <div className="flex items-center justify-center py-3">
            <Loader2 size={20} className="animate-spin text-primary-500" />
            <span className="text-dark-500 text-xs ml-2">Loading older messages...</span>
          </div>
        )}

        {/* Has more pages indicator */}
        {!isLoadingMore && pagination && pagination.page < pagination.pages && chatMessages.length > 0 && (
          <div className="flex items-center justify-center py-2">
            <span className="text-dark-600 text-[10px]">Scroll up for more</span>
          </div>
        )}

        {isLoadingMessages && chatMessages.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-dark-500 text-xs">Loading messages...</p>
            </div>
          </div>
        )}

        {chatMessages.length === 0 && !isLoadingMessages && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="text-4xl mb-3">👋</div>
              <p className="text-dark-400 text-sm font-medium">No messages yet</p>
              <p className="text-dark-500 text-xs mt-1">Say hello to start the conversation!</p>
            </div>
          </div>
        )}

        {chatMessages.map((msg, index) => {
          const isMine = msg.sender?._id === user?._id || msg.sender === user?._id;
          const showAvatar = !isMine && (
            index === 0 ||
            chatMessages[index - 1]?.sender?._id !== msg.sender?._id
          );

          // Show date separator when messages cross local calendar day boundary
          const prevDate = index > 0 ? chatMessages[index - 1]?.createdAt : null;
          const showDateSep = shouldShowDateSeparator(msg.createdAt, prevDate);

          return (
            <div key={msg._id || index} data-message-id={msg._id} className="transition-colors duration-500 rounded-lg">
              {showDateSep && (
                <div className="flex items-center justify-center py-4">
                  <div className="flex-1 border-t border-dark-700/50" />
                  <span className="px-4 py-1 text-[11px] text-dark-400 bg-dark-800/80 rounded-full font-medium backdrop-blur-sm">
                    {formatDateSeparator(msg.createdAt)}
                  </span>
                  <div className="flex-1 border-t border-dark-700/50" />
                </div>
              )}
              <MessageBubble
                message={msg}
                isMine={isMine}
                showAvatar={showAvatar}
                onDelete={handleDeleteMessage}
                onForward={handleForwardMessage}
                onViewProfile={handleViewProfile}
                onPin={handlePinMessage}
              />
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="bg-dark-700 rounded-2xl px-4 py-2.5 flex items-center gap-2">
              <div className="flex gap-1">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
              <span className="text-xs text-dark-400">typing...</span>
            </div>
          </div>
        )}

      </div>

      {/* Message input — stays at bottom */}
      <div className="flex-shrink-0 relative">
        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute -top-12 right-4 w-10 h-10 bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-full flex items-center justify-center text-dark-300 shadow-lg transition-all animate-scale-in z-10"
          >
            <ChevronDown size={20} />
          </button>
        )}
        <MessageInput />
      </div>

      </div>{/* end messages column */}

      {/* Group info panel */}
      {showGroupInfo && activeChat?.type === 'group' && (
        <GroupChat
          groupId={activeChat.id}
          onClose={() => setShowGroupInfo(false)}
        />
      )}

      {/* Pinned messages panel */}
      {showPinnedPanel && activeChat && (
        <PinnedMessages
          chatId={activeChat.id}
          chatType={activeChat.type}
          onScrollToMessage={scrollToMessage}
        />
      )}

      </div>{/* end chat body flex row */}

      {/* Forward message modal */}
      {forwardMessage && (
        <ForwardMessageModal
          message={forwardMessage}
          onClose={() => setForwardMessage(null)}
        />
      )}

      {/* View profile modal */}
      {viewProfileUser && (
        <UserProfileModal
          userId={viewProfileUser}
          onClose={() => setViewProfileUser(null)}
        />
      )}
    </div>
  );
};

export default ChatWindow;
