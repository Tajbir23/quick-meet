import { useEffect, useRef, useState } from 'react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import { formatDateSeparator, shouldShowDateSeparator } from '../../utils/helpers';

const ChatWindow = () => {
  const { activeChat, messages, fetchMessages, isLoadingMessages, typingUsers, markAsRead } = useChatStore();
  const { user } = useAuthStore();
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const [pagination, setPagination] = useState(null);

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
    if (containerRef.current?.scrollTop === 0 && pagination && pagination.page < pagination.pages) {
      fetchMessages(activeChat.id, activeChat.type, pagination.page + 1).then(pag => {
        setPagination(pag);
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-dark-900 min-h-0">
      {/* Messages area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
        onScroll={handleScroll}
      >
        {isLoadingMessages && chatMessages.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {chatMessages.length === 0 && !isLoadingMessages && (
          <div className="flex items-center justify-center py-8">
            <p className="text-dark-500 text-sm">No messages yet. Say hello! 👋</p>
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
                <div className="flex items-center justify-center py-3">
                  <div className="flex-1 border-t border-dark-700" />
                  <span className="px-3 text-xs text-dark-400 bg-dark-900 font-medium">
                    {formatDateSeparator(msg.createdAt)}
                  </span>
                  <div className="flex-1 border-t border-dark-700" />
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
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex gap-1">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
            <span className="text-xs text-dark-400">typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <MessageInput />
    </div>
  );
};

export default ChatWindow;
