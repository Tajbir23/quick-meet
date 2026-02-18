import { useState, useRef, useEffect, memo } from 'react';
import { Download, FileText, Loader2, Phone, Video, PhoneMissed, PhoneOff, PhoneIncoming, PhoneOutgoing, Trash2, Forward, MoreVertical, User as UserIcon, Pin, PinOff, RotateCcw, CheckCircle2, Circle, Reply, SmilePlus } from 'lucide-react';
import { getInitials, stringToColor, formatMessageTime, isImageFile, formatFileSize, formatDuration } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';
import ImagePreview from '../Common/ImagePreview';
import MessageStatus from '../Common/MessageStatus';

// Quick reaction emoji palette
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];

const MessageBubble = ({ message, isMine, showAvatar, onDelete, onForward, onViewProfile, onPin, onRetry, onReply, onReact, selectMode, isSelected, onToggleSelect, onEnterSelectMode }) => {
  const [downloading, setDownloading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const menuRef = useRef(null);
  const emojiRef = useRef(null);
  const longPressTimer = useRef(null);
  const isSystem = message.type === 'system';
  const isCall = message.type === 'call';
  const hasFile = message.fileUrl;
  const isImage = hasFile && isImageFile(message.fileMimeType);

  // Long press to enter select mode
  const handlePointerDown = (e) => {
    if (selectMode || isSystem) return;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      onEnterSelectMode && onEnterSelectMode();
    }, 500);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Tap to toggle selection when in select mode
  const handleBubbleClick = (e) => {
    if (selectMode) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect && onToggleSelect();
    }
  };

  /**
   * Download file — uses Electron native download if available,
   * otherwise falls back to fetch+blob in the browser.
   */
  const handleDownload = async (e) => {
    e.preventDefault();
    if (downloading) return;

    const filename = message.fileUrl.split('/').pop();
    const downloadUrl = `${SERVER_URL}/api/files/download/${filename}`;
    const downloadName = message.fileName || filename;

    try {
      setDownloading(true);

      // Electron: use native file download via IPC
      if (window.electronAPI?.downloadFile) {
        const result = await window.electronAPI.downloadFile(downloadUrl, downloadName);
        if (!result.success && result.error !== 'Cancelled') {
          throw new Error(result.error);
        }
        return;
      }

      // Browser: fetch blob and trigger download
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      window.open(downloadUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  // Close menu on outside click
  const handleMenuToggle = (e) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu && !showEmojiPicker) return;
    const handleClickOutside = (e) => {
      if (showMenu && menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
      if (showEmojiPicker && emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu, showEmojiPicker]);

  // System message
  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-[11px] text-dark-500 bg-dark-800/80 px-3 py-1 rounded-full backdrop-blur-sm">
          {message.content}
        </span>
      </div>
    );
  }

  // ─── CALL LOG MESSAGE ─────────────────────────
  if (isCall) {
    const isCompleted = message.callStatus === 'completed';
    const isMissed = message.callStatus === 'missed';
    const isRejected = message.callStatus === 'rejected';
    const isVideoCall = message.callType === 'video';

    // Determine icon
    let CallIcon;
    if (isCompleted) {
      CallIcon = isMine ? PhoneOutgoing : PhoneIncoming;
    } else if (isMissed) {
      CallIcon = PhoneMissed;
    } else {
      CallIcon = PhoneOff;
    }

    // Determine label
    let callLabel;
    if (isCompleted) {
      callLabel = isMine
        ? (isVideoCall ? 'Outgoing Video Call' : 'Outgoing Voice Call')
        : (isVideoCall ? 'Incoming Video Call' : 'Incoming Voice Call');
    } else if (isMissed) {
      callLabel = isMine
        ? (isVideoCall ? 'Cancelled Video Call' : 'Cancelled Voice Call')
        : (isVideoCall ? 'Missed Video Call' : 'Missed Voice Call');
    } else {
      callLabel = isVideoCall ? 'Declined Video Call' : 'Declined Voice Call';
    }

    const iconColor = isCompleted ? 'text-green-400' : 'text-red-400';
    const bgColor = isCompleted ? 'bg-green-500/10' : 'bg-red-500/10';
    const borderColor = isCompleted ? 'border-green-500/20' : 'border-red-500/20';

    return (
      <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1 animate-fade-in`}>
        <div className={`flex gap-2 max-w-[85%] md:max-w-[70%] ${isMine ? 'flex-row-reverse' : ''}`}>
          {/* Avatar (only for received messages) */}
          {!isMine && showAvatar ? (
            typeof message.sender === 'object' && message.sender.avatar ? (
              <img
                src={`${SERVER_URL}${message.sender.avatar}`}
                alt={typeof message.sender === 'object' ? message.sender.username : 'Unknown'}
                className="w-7 h-7 md:w-8 md:h-8 rounded-full object-cover flex-shrink-0 mt-auto"
              />
            ) : (
              <div
                className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] md:text-xs font-bold text-white flex-shrink-0 mt-auto"
                style={{ backgroundColor: stringToColor(typeof message.sender === 'object' ? message.sender.username : 'Unknown') }}
              >
                {getInitials(typeof message.sender === 'object' ? message.sender.username : 'Unknown')}
              </div>
            )
          ) : (
            !isMine && <div className="w-7 md:w-8 flex-shrink-0" />
          )}

          <div className={`rounded-2xl px-4 py-3 border ${bgColor} ${borderColor} backdrop-blur-sm`}>
            <div className="flex items-center gap-3">
              {/* Call type icon */}
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isCompleted ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {isVideoCall && isCompleted ? (
                  <Video size={18} className={iconColor} />
                ) : (
                  <CallIcon size={18} className={iconColor} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-medium ${isCompleted ? 'text-green-300' : 'text-red-300'}`}>
                  {callLabel}
                </p>
                {isCompleted && message.callDuration > 0 && (
                  <p className="text-[11px] text-dark-400 mt-0.5">
                    ⏱ {formatDuration(message.callDuration)}
                  </p>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <p className="text-[10px] text-dark-500 text-right mt-1.5">
              {formatMessageTime(message.createdAt)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const senderName = typeof message.sender === 'object'
    ? message.sender.username
    : 'Unknown';

  const senderAvatar = typeof message.sender === 'object'
    ? message.sender.avatar
    : null;

  return (
    <div
      className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1 animate-fade-in ${selectMode ? 'cursor-pointer' : ''} ${isSelected ? 'bg-primary-500/10 rounded-lg' : ''}`}
      onClick={handleBubbleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Selection checkbox */}
      {selectMode && (
        <div className="flex items-center px-2 flex-shrink-0">
          {isSelected ? (
            <CheckCircle2 size={22} className="text-primary-500" />
          ) : (
            <Circle size={22} className="text-dark-500" />
          )}
        </div>
      )}
      <div className={`flex gap-2 max-w-[85%] md:max-w-[70%] ${isMine ? 'flex-row-reverse' : ''}`}>
        {/* Avatar (only for received messages) */}
        {!isMine && showAvatar ? (
          senderAvatar ? (
            <img
              src={`${SERVER_URL}${senderAvatar}`}
              alt={senderName}
              className="w-7 h-7 md:w-8 md:h-8 rounded-full object-cover flex-shrink-0 mt-auto cursor-pointer"
              onClick={() => onViewProfile && onViewProfile(message.sender)}
            />
          ) : (
            <div
              className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] md:text-xs font-bold text-white flex-shrink-0 mt-auto cursor-pointer"
              style={{ backgroundColor: stringToColor(senderName) }}
              onClick={() => onViewProfile && onViewProfile(message.sender)}
            >
              {getInitials(senderName)}
            </div>
          )
        ) : (
          !isMine && <div className="w-7 md:w-8 flex-shrink-0" />
        )}

        {/* Message content */}
        <div className="min-w-0">
          {/* Sender name (group messages) */}
          {!isMine && showAvatar && (
            <p
              className="text-[11px] text-dark-400 mb-1 ml-1 font-medium cursor-pointer hover:text-primary-400 transition-colors"
              onClick={() => onViewProfile && onViewProfile(message.sender)}
            >
              {senderName}
            </p>
          )}

          <div className={`chat-bubble ${isMine ? 'chat-bubble-sent' : 'chat-bubble-received'} relative group`}>
            {/* Context menu button — hidden in select mode */}
            {!selectMode && (
            <div ref={menuRef} className="absolute top-1 right-1 z-10">
              <button
                onClick={handleMenuToggle}
                className="w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/20"
              >
                <MoreVertical size={14} className={isMine ? 'text-primary-200' : 'text-dark-400'} />
              </button>
              {showMenu && (
                <div className={`absolute ${isMine ? 'right-0' : 'left-0'} top-7 bg-dark-700 border border-dark-600 rounded-xl shadow-xl py-1.5 min-w-[140px] z-50 animate-scale-in`}>
                  {/* Reply */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onReply && onReply(message); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                  >
                    <Reply size={14} />
                    Reply
                  </button>
                  {/* React */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowEmojiPicker(true); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                  >
                    <SmilePlus size={14} />
                    React
                  </button>
                  {/* Select */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onEnterSelectMode && onEnterSelectMode(); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                  >
                    <CheckCircle2 size={14} />
                    Select
                  </button>
                  {/* Forward */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onForward && onForward(message); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                  >
                    <Forward size={14} />
                    Forward
                  </button>
                  {/* Pin / Unpin */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onPin && onPin(message); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                  >
                    {message.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    {message.isPinned ? 'Unpin' : 'Pin'}
                  </button>
                  {/* View Profile (only for others' messages) */}
                  {!isMine && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowMenu(false); onViewProfile && onViewProfile(message.sender); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                    >
                      <UserIcon size={14} />
                      View Profile
                    </button>
                  )}
                  {/* Delete (only own messages) */}
                  {isMine && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete && onDelete(message._id); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-dark-600 transition-colors"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Emoji picker popup */}
            {showEmojiPicker && (
              <div ref={emojiRef} className={`absolute ${isMine ? 'right-0' : 'left-0'} -top-12 bg-dark-700 border border-dark-600 rounded-xl shadow-xl px-2 py-1.5 z-50 animate-scale-in`}>
                <div className="flex gap-1">
                  {QUICK_REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(false); onReact && onReact(message._id, emoji); }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-dark-600 transition-colors text-base"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reply-to quoted message */}
            {message.replyTo && (
              <div className={`mb-2 px-2.5 py-1.5 rounded-lg border-l-2 ${isMine ? 'bg-primary-700/30 border-primary-400/60' : 'bg-dark-600/50 border-dark-400/60'}`}>
                <p className={`text-[10px] font-semibold ${isMine ? 'text-primary-300' : 'text-dark-300'}`}>
                  {typeof message.replyTo.sender === 'object' ? message.replyTo.sender.username : 'Unknown'}
                </p>
                <p className={`text-[11px] truncate ${isMine ? 'text-primary-200/70' : 'text-dark-400'}`}>
                  {message.replyTo.type === 'image' ? '📷 Photo' : message.replyTo.type === 'file' ? `📎 ${message.replyTo.fileName || 'File'}` : (message.replyTo.content || 'Message')}
                </p>
              </div>
            )}

            {/* Image attachment */}
            {isImage && (
              <div className="mb-2 -mx-2 -mt-1">
                {!imageLoaded && (
                  <div className="w-full h-40 bg-dark-600/50 rounded-lg animate-pulse flex items-center justify-center">
                    <Loader2 size={20} className="text-dark-400 animate-spin" />
                  </div>
                )}
                <img
                  src={`${SERVER_URL}${message.fileUrl}`}
                  alt={message.fileName || 'Image'}
                  className={`rounded-lg max-w-full h-auto max-h-72 object-cover cursor-pointer transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0 h-0'}`}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onClick={() => setShowPreview(true)}
                />
              </div>
            )}

            {/* Non-image file attachment */}
            {hasFile && !isImage && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl mb-2 text-left cursor-pointer active:opacity-70 transition-all ${
                  isMine ? 'bg-primary-700/40' : 'bg-dark-600/40'
                } ${downloading ? 'opacity-60' : ''}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isMine ? 'bg-primary-700/50' : 'bg-dark-500/50'
                }`}>
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{message.fileName || 'File'}</p>
                  {message.fileSize && (
                    <p className="text-[10px] opacity-60 mt-0.5">{formatFileSize(message.fileSize)}</p>
                  )}
                </div>
                {downloading
                  ? <Loader2 size={16} className="flex-shrink-0 opacity-60 animate-spin" />
                  : <Download size={16} className="flex-shrink-0 opacity-60" />
                }
              </button>
            )}

            {/* Text content */}
            {message.content && (
              <>
                {message.forwardedFrom && (
                  <p className="text-[10px] text-dark-400 italic mb-1 flex items-center gap-1">
                    <Forward size={10} />
                    Forwarded
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words text-[14px] md:text-sm leading-relaxed">{message.content}</p>
              </>
            )}

            {/* Timestamp + Status indicator */}
            <div className={`flex items-center gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-end'}`}>
              {message.isPinned && (
                <Pin size={10} className={`${isMine ? 'text-primary-200/70' : 'text-amber-400/70'}`} />
              )}
              <p className={`text-[10px] ${isMine ? 'text-primary-200/70' : 'text-dark-500'}`}>
                {message.isDeleted ? 'Deleted' : formatMessageTime(message.createdAt)}
              </p>
              {isMine && !message.isDeleted && (
                <MessageStatus status={message.status || (message.read ? 'seen' : 'sent')} size={13} />
              )}
              {message.status === 'failed' && isMine && (
                <button
                  onClick={() => onRetry?.(message)}
                  className="ml-1 text-red-400 hover:text-red-300 transition-colors"
                  title="Retry"
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>

            {/* Reaction display row */}
            {message.reactions && message.reactions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5 -mb-0.5">
                {message.reactions.map((reaction) => {
                  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
                  const iReacted = reaction.users?.includes(currentUser._id);
                  return (
                    <button
                      key={reaction.emoji}
                      onClick={(e) => { e.stopPropagation(); onReact && onReact(message._id, reaction.emoji); }}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                        iReacted
                          ? (isMine ? 'bg-primary-400/30 border border-primary-400/50' : 'bg-primary-500/20 border border-primary-500/40')
                          : (isMine ? 'bg-white/10 border border-white/10 hover:bg-white/20' : 'bg-dark-600/60 border border-dark-500/30 hover:bg-dark-600')
                      }`}
                    >
                      <span className="text-[13px]">{reaction.emoji}</span>
                      {reaction.count > 1 && (
                        <span className={`text-[10px] ${iReacted ? 'text-primary-300' : (isMine ? 'text-primary-200/70' : 'text-dark-400')}`}>
                          {reaction.count}
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* Quick add reaction button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(true); }}
                  className={`w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all ${
                    isMine ? 'hover:bg-white/10' : 'hover:bg-dark-600'
                  }`}
                >
                  <SmilePlus size={12} className={isMine ? 'text-primary-200/60' : 'text-dark-500'} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image preview popup */}
      {showPreview && isImage && (
        <ImagePreview
          imageUrl={message.fileUrl}
          fileName={message.fileName}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
};

export default memo(MessageBubble);
