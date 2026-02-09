import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import FileUpload from '../Common/FileUpload';
import toast from 'react-hot-toast';

const MessageInput = () => {
  const [content, setContent] = useState('');
  const [showFileUpload, setShowFileUpload] = useState(false);
  const { activeChat, sendMessage, emitTyping } = useChatStore();
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [content]);

  const handleTyping = useCallback(() => {
    if (!activeChat) return;

    emitTyping(activeChat.id, activeChat.type, true);

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Stop typing after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(activeChat.id, activeChat.type, false);
    }, 2000);
  }, [activeChat, emitTyping]);

  const handleSend = async () => {
    if (!content.trim() && !showFileUpload) return;
    if (!activeChat) return;

    const messageContent = content.trim();
    setContent('');

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    emitTyping(activeChat.id, activeChat.type, false);

    try {
      await sendMessage(activeChat.id, activeChat.type, messageContent);
    } catch (error) {
      toast.error('Failed to send message');
      setContent(messageContent); // Restore on failure
    }

    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUploaded = async (fileData) => {
    if (!activeChat) return;

    try {
      await sendMessage(activeChat.id, activeChat.type, '', fileData);
      setShowFileUpload(false);
      toast.success('File sent');
    } catch (error) {
      toast.error('Failed to send file');
    }
  };

  if (!activeChat) return null;

  return (
    <div className="border-t border-dark-700 bg-dark-800 p-2.5 md:p-4 safe-bottom">
      {/* File upload area */}
      {showFileUpload && (
        <div className="mb-2.5 p-3 bg-dark-700 rounded-xl relative animate-slide-down">
          <button
            onClick={() => setShowFileUpload(false)}
            className="absolute top-2 right-2 text-dark-400 hover:text-white p-1 rounded-full hover:bg-dark-600"
          >
            <X size={16} />
          </button>
          <FileUpload onUploaded={handleFileUploaded} />
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* Attachment button */}
        <button
          onClick={() => setShowFileUpload(!showFileUpload)}
          className={`btn-icon flex-shrink-0 ${showFileUpload ? 'text-primary-400 bg-primary-500/10' : 'text-dark-400 hover:text-dark-200'}`}
        >
          <Paperclip size={20} />
        </button>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="input-field resize-none py-2.5 md:py-2.5 pr-4 min-h-[44px] max-h-[120px] text-[16px] md:text-sm leading-relaxed"
            style={{ overflow: content.split('\n').length > 3 ? 'auto' : 'hidden' }}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!content.trim()}
          className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all ${
            content.trim()
              ? 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white shadow-lg shadow-primary-500/20'
              : 'bg-dark-700 text-dark-500'
          }`}
        >
          <Send size={18} className={content.trim() ? 'translate-x-0.5' : ''} />
        </button>
      </div>
    </div>
  );
};

export default MessageInput;
