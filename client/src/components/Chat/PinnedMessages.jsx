import { useEffect, memo, useCallback } from 'react';
import { X, Pin, PinOff, FileText, Image as ImageIcon } from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import { formatMessageTime, formatFileSize } from '../../utils/helpers';
import toast from 'react-hot-toast';

// Safe getter — guards against typeof null === 'object' gotcha
const getSenderName = (sender) => {
  if (sender && typeof sender === 'object' && sender.username) return sender.username;
  return 'Unknown';
};
const getPinnedByName = (pinnedBy) => {
  if (pinnedBy && typeof pinnedBy === 'object' && pinnedBy.username) return pinnedBy.username;
  return 'Someone';
};
const getSenderId = (sender) => {
  if (sender && typeof sender === 'object' && sender._id) return sender._id;
  if (typeof sender === 'string') return sender;
  return null;
};

const PinnedMessages = ({ chatId, chatType, onScrollToMessage }) => {
  // Use stable selector — avoid || [] which creates new ref each render
  const allPinnedMessages = useChatStore(s => s.pinnedMessages);
  const fetchPinnedMessages = useChatStore(s => s.fetchPinnedMessages);
  const unpinMessage = useChatStore(s => s.unpinMessage);
  const closePinnedPanel = useChatStore(s => s.closePinnedPanel);
  const user = useAuthStore(s => s.user);

  // Safely get the array — defensive
  const pinnedMessages = (allPinnedMessages && chatId && Array.isArray(allPinnedMessages[chatId]))
    ? allPinnedMessages[chatId]
    : [];

  useEffect(() => {
    if (chatId) {
      fetchPinnedMessages(chatId, chatType);
    }
  }, [chatId, chatType, fetchPinnedMessages]);

  const handleUnpin = useCallback(async (messageId) => {
    try {
      await unpinMessage(messageId, chatId, chatType);
      toast.success('Message unpinned');
    } catch {
      toast.error('Failed to unpin message');
    }
  }, [unpinMessage, chatId, chatType]);

  const getMessagePreview = (msg) => {
    if (!msg) return 'Message';
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      return msg.content.length > 120 ? msg.content.substring(0, 120) + '...' : msg.content;
    }
    if (msg.fileUrl) {
      const isImage = msg.fileMimeType && msg.fileMimeType.startsWith('image/');
      return isImage ? '📷 Photo' : `📎 ${msg.fileName || 'File'}`;
    }
    if (msg.type === 'call') return '📞 Call';
    return 'Message';
  };

  return (
    <div className="flex flex-col h-full bg-dark-800 border-l border-dark-700 w-80 md:w-96">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Pin size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Pinned Messages</h3>
          <span className="text-[11px] text-dark-400 bg-dark-700 px-2 py-0.5 rounded-full">
            {pinnedMessages.length}
          </span>
        </div>
        <button
          onClick={closePinnedPanel}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-dark-700 transition-colors text-dark-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      {/* Pinned Messages List */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {pinnedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-dark-700 flex items-center justify-center mb-3">
              <Pin size={24} className="text-dark-500" />
            </div>
            <p className="text-dark-400 text-sm font-medium">No pinned messages</p>
            <p className="text-dark-500 text-xs mt-1">
              Pin important messages to find them easily
            </p>
          </div>
        ) : (
          <div className="divide-y divide-dark-700/50">
            {pinnedMessages.map((msg) => {
              if (!msg || !msg._id) return null;
              const senderName = getSenderName(msg.sender);
              const pinnedByName = getPinnedByName(msg.pinnedBy);
              const isMine = getSenderId(msg.sender) === user?._id;

              return (
                <div
                  key={msg._id}
                  className="px-4 py-3 hover:bg-dark-700/50 transition-colors cursor-pointer group"
                  onClick={() => onScrollToMessage && onScrollToMessage(msg._id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {/* Sender + time */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold ${isMine ? 'text-primary-400' : 'text-emerald-400'}`}>
                          {isMine ? 'You' : senderName}
                        </span>
                        <span className="text-[10px] text-dark-500">
                          {formatMessageTime(msg.createdAt)}
                        </span>
                      </div>

                      {/* Message content preview */}
                      <p className="text-[13px] text-dark-200 leading-relaxed break-words">
                        {getMessagePreview(msg)}
                      </p>

                      {/* File info */}
                      {msg.fileUrl && msg.fileSize && (
                        <div className="flex items-center gap-1.5 mt-1">
                          {msg.fileMimeType && msg.fileMimeType.startsWith('image/')
                            ? <ImageIcon size={11} className="text-dark-500" />
                            : <FileText size={11} className="text-dark-500" />
                          }
                          <span className="text-[10px] text-dark-500">{formatFileSize(msg.fileSize)}</span>
                        </div>
                      )}

                      {/* Pinned by info */}
                      <p className="text-[10px] text-dark-500 mt-1.5 flex items-center gap-1">
                        <Pin size={9} className="text-amber-400/60" />
                        Pinned by {pinnedByName}{msg.pinnedAt ? ` · ${formatMessageTime(msg.pinnedAt)}` : ''}
                      </p>
                    </div>

                    {/* Unpin button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnpin(msg._id); }}
                      className="w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 text-dark-400 hover:text-red-400 flex-shrink-0 mt-1"
                      title="Unpin"
                    >
                      <PinOff size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(PinnedMessages);
