import { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { getInitials, stringToColor, formatMessageTime, isImageFile, formatFileSize } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';

const MessageBubble = ({ message, isMine, showAvatar }) => {
  const [downloading, setDownloading] = useState(false);
  const isSystem = message.type === 'system';
  const hasFile = message.fileUrl;
  const isImage = hasFile && isImageFile(message.fileMimeType);

  /**
   * Download file — opens the public download URL in a new tab.
   * If that fails, falls back to fetch+blob with auth headers.
   */
  const handleDownload = async (e) => {
    e.preventDefault();
    if (downloading) return;

    const filename = message.fileUrl.split('/').pop();
    const downloadUrl = `${SERVER_URL}/api/files/download/${filename}`;

    // Try direct link first (works because download route is now public)
    try {
      setDownloading(true);

      // Use fetch+blob so browser triggers a real Save-As download
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = message.fileName || filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: open URL directly
      window.open(downloadUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  // System message (user joined/left, etc.)
  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-dark-500 bg-dark-800 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  const senderName = typeof message.sender === 'object'
    ? message.sender.username
    : 'Unknown';

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1 animate-fade-in`}>
      <div className={`flex gap-2 max-w-[70%] ${isMine ? 'flex-row-reverse' : ''}`}>
        {/* Avatar (only for received messages) */}
        {!isMine && showAvatar ? (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-auto"
            style={{ backgroundColor: stringToColor(senderName) }}
          >
            {getInitials(senderName)}
          </div>
        ) : (
          !isMine && <div className="w-8 flex-shrink-0" />
        )}

        {/* Message content */}
        <div>
          {/* Sender name (group messages) */}
          {!isMine && showAvatar && (
            <p className="text-xs text-dark-400 mb-1 ml-1">{senderName}</p>
          )}

          <div className={`chat-bubble ${isMine ? 'chat-bubble-sent' : 'chat-bubble-received'}`}>
            {/* Image attachment */}
            {isImage && (
              <div className="mb-2 -mx-2 -mt-1">
                <img
                  src={`${SERVER_URL}${message.fileUrl}`}
                  alt={message.fileName || 'Image'}
                  className="rounded-lg max-w-full h-auto max-h-64 object-cover cursor-pointer"
                  loading="lazy"
                  onClick={() => window.open(`${SERVER_URL}${message.fileUrl}`, '_blank')}
                />
              </div>
            )}

            {/* Non-image file attachment */}
            {hasFile && !isImage && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className={`w-full flex items-center gap-2 p-2 rounded-lg mb-2 text-left cursor-pointer hover:opacity-80 transition-opacity ${
                  isMine ? 'bg-primary-700/50' : 'bg-dark-600/50'
                } ${downloading ? 'opacity-60' : ''}`}
              >
                <FileText size={20} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{message.fileName || 'File'}</p>
                  {message.fileSize && (
                    <p className="text-xs opacity-60">{formatFileSize(message.fileSize)}</p>
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
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}

            {/* Timestamp — always in user's local timezone */}
            <p className={`text-[10px] mt-1 ${isMine ? 'text-primary-200' : 'text-dark-500'} text-right`}>
              {formatMessageTime(message.createdAt)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
