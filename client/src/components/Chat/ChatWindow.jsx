import { useEffect, useRef, useState } from 'react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import Header from '../Layout/Header';
import GroupChat from '../Group/GroupChat';
import ForwardMessageModal from '../Common/ForwardMessageModal';
import UserProfileModal from '../Common/UserProfileModal';
import { formatDateSeparator, shouldShowDateSeparator } from '../../utils/helpers';
import { ChevronDown } from 'lucide-react';
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
  const typingUsers = useChatStore(s => s.typingUsers);
  const markAsRead = useChatStore(s => s.markAsRead);
  const user = useAuthStore(s => s.user);
  const containerRef = useRef(null);
  const [pagination, setPagination] = useState(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [viewProfileUser, setViewProfileUser] = useState(null);

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
  }, [activeChat?.id]);

  // Auto scroll to bottom on new messages
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages[activeChat?.id]?.length]);

  if (!activeChat) return null;

  const chatMessages = messages[activeChat.id] || [];
  const typing = typingUsers[activeChat.id];
  const isTyping = typing && Object.keys(typing).length > 0;

  // Load more messages (scroll to top)
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;

    // Show scroll-to-bottom button when scrolled up
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);

    if (el.scrollTop === 0 && pagination && pagination.page < pagination.pages) {
      fetchMessages(activeChat.id, activeChat.type, pagination.page + 1).then(pag => {
        setPagination(pag);
      });
    }
  };

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

      {/* Messages area (Flexible height, scrollable) */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4 space-y-1 overscroll-contain min-h-0"
        onScroll={handleScroll}
      >
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
            <div key={msg._id || index}>
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
