import { useEffect, useRef, useState } from 'react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import Header from '../Layout/Header';
import { formatDateSeparator, shouldShowDateSeparator } from '../../utils/helpers';
import { ChevronDown } from 'lucide-react';

const ChatWindow = () => {
  const { activeChat, messages, fetchMessages, isLoadingMessages, typingUsers, markAsRead } = useChatStore();
  const { user } = useAuthStore();
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const [pagination, setPagination] = useState(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

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
  }, [activeChat?.id]);

  // Auto scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Chat header with back button & call buttons */}
      <Header />

      {/* Messages area */}
      <div className="flex-1 flex flex-col bg-dark-900 min-h-0 relative">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4 space-y-1 overscroll-contain"
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

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 md:bottom-24 right-4 w-10 h-10 bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-full flex items-center justify-center text-dark-300 shadow-lg transition-all animate-scale-in z-10"
        >
          <ChevronDown size={20} />
        </button>
      )}

      {/* Message input */}
      <MessageInput />
      </div>
    </div>
  );
};

export default ChatWindow;
