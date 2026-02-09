import { useState, useRef, useCallback } from 'react';
import { Send, Paperclip, Smile, X } from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import FileUpload from '../Common/FileUpload';
import toast from 'react-hot-toast';

const MessageInput = () => {
  const [content, setContent] = useState('');
  const [showFileUpload, setShowFileUpload] = useState(false);
  const { activeChat, sendMessage, emitTyping } = useChatStore();
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);

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
    <div className="border-t border-dark-700 bg-dark-800 p-4">
      {/* File upload area */}
      {showFileUpload && (
        <div className="mb-3 p-3 bg-dark-700 rounded-lg relative">
          <button
            onClick={() => setShowFileUpload(false)}
            className="absolute top-2 right-2 text-dark-400 hover:text-white"
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
          className={`btn-icon flex-shrink-0 mb-0.5 ${showFileUpload ? 'text-primary-400' : 'text-dark-400 hover:text-dark-200'}`}
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
            className="input-field resize-none py-2.5 pr-12 min-h-[42px] max-h-32"
            style={{ height: 'auto', overflowY: content.split('\n').length > 3 ? 'auto' : 'hidden' }}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!content.trim()}
          className="btn-primary flex-shrink-0 p-2.5 rounded-full disabled:opacity-30"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default MessageInput;
