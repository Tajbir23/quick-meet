/**
 * ============================================
 * ChannelPostInput — Admin Post Composer
 * ============================================
 * 
 * Features:
 * - Text post with Markdown-style support
 * - File/image/video attachment
 * - Poll creation
 * - Scheduled posting
 * - Silent post toggle
 */

import { useState, useRef, useEffect } from 'react';
import {
  Send, Paperclip, X, BarChart3, Clock, BellOff, Bell,
  Image, Plus, Trash2, Check
} from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import FileUpload from '../Common/FileUpload';
import toast from 'react-hot-toast';

const ChannelPostInput = ({ channelId }) => {
  const createPost = useChannelStore(s => s.createPost);

  const [content, setContent] = useState('');
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [isSilent, setIsSilent] = useState(false);
  const [fileData, setFileData] = useState(null);
  const [sending, setSending] = useState(false);

  // Poll state
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollIsAnonymous, setPollIsAnonymous] = useState(true);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [pollIsQuiz, setPollIsQuiz] = useState(false);
  const [pollCorrectOption, setPollCorrectOption] = useState(0);

  // Schedule state
  const [scheduledFor, setScheduledFor] = useState('');

  const inputRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px';
    }
  }, [content]);

  const handleSend = async () => {
    if (sending) return;

    // Validate
    if (!content.trim() && !fileData && !showPollCreator) return;

    if (showPollCreator) {
      if (!pollQuestion.trim()) {
        toast.error('Poll question is required');
        return;
      }
      const validOptions = pollOptions.filter(o => o.trim());
      if (validOptions.length < 2) {
        toast.error('At least 2 poll options required');
        return;
      }
    }

    setSending(true);

    try {
      const postData = {
        content: content.trim(),
        isSilent,
      };

      // Add file data
      if (fileData) {
        postData.fileUrl = fileData.url;
        postData.fileName = fileData.name;
        postData.fileSize = fileData.size;
        postData.fileMimeType = fileData.mimeType;
        postData.type = fileData.mimeType?.startsWith('image/') ? 'image'
          : fileData.mimeType?.startsWith('video/') ? 'video' : 'file';
      }

      // Add poll data
      if (showPollCreator) {
        postData.type = 'poll';
        postData.poll = {
          question: pollQuestion.trim(),
          options: pollOptions.filter(o => o.trim()).map(o => ({ text: o.trim() })),
          isAnonymous: pollIsAnonymous,
          allowMultiple: pollAllowMultiple,
          isQuiz: pollIsQuiz,
          correctOption: pollIsQuiz ? pollCorrectOption : undefined,
        };
      }

      // Add schedule
      if (showScheduler && scheduledFor) {
        postData.scheduledFor = new Date(scheduledFor).toISOString();
      }

      const result = await createPost(channelId, postData);
      if (result?.success !== false) {
        // Reset form
        setContent('');
        setFileData(null);
        setShowFileUpload(false);
        setShowPollCreator(false);
        setShowScheduler(false);
        setIsSilent(false);
        setPollQuestion('');
        setPollOptions(['', '']);
        setScheduledFor('');
        if (showScheduler && scheduledFor) {
          toast.success('Post scheduled!');
        }
      }
    } catch (err) {
      toast.error('Failed to create post');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !showPollCreator) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUploaded = (data) => {
    setFileData(data);
    setShowFileUpload(false);
  };

  const addPollOption = () => {
    if (pollOptions.length >= 10) return;
    setPollOptions([...pollOptions, '']);
  };

  const removePollOption = (index) => {
    if (pollOptions.length <= 2) return;
    setPollOptions(pollOptions.filter((_, i) => i !== index));
  };

  const updatePollOption = (index, value) => {
    const updated = [...pollOptions];
    updated[index] = value;
    setPollOptions(updated);
  };

  return (
    <div className="border-t border-dark-700 bg-dark-800 p-2.5 md:p-4 safe-bottom">
      {/* File upload area */}
      {showFileUpload && (
        <div className="mb-2.5 p-3 bg-dark-700 rounded-xl relative animate-slide-down">
          <button
            onClick={() => { setShowFileUpload(false); setFileData(null); }}
            className="absolute top-2 right-2 text-dark-400 hover:text-white p-1 rounded-full hover:bg-dark-600"
          >
            <X size={16} />
          </button>
          <FileUpload onUploaded={handleFileUploaded} />
        </div>
      )}

      {/* File preview */}
      {fileData && !showFileUpload && (
        <div className="mb-2.5 flex items-center gap-2 bg-dark-700 rounded-xl px-3 py-2">
          <Image size={16} className="text-indigo-400" />
          <span className="text-xs text-dark-200 truncate flex-1">{fileData.fileName}</span>
          <button
            onClick={() => setFileData(null)}
            className="text-dark-400 hover:text-red-400"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Poll creator */}
      {showPollCreator && (
        <div className="mb-3 p-3 bg-dark-700 rounded-xl animate-slide-down">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <BarChart3 size={16} className="text-indigo-400" />
              Create Poll
            </h4>
            <button
              onClick={() => setShowPollCreator(false)}
              className="text-dark-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <input
            type="text"
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
            placeholder="Ask a question..."
            className="input-field w-full text-sm mb-3"
          />

          <div className="space-y-2 mb-3">
            {pollOptions.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                {pollIsQuiz && (
                  <button
                    onClick={() => setPollCorrectOption(i)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      pollCorrectOption === i
                        ? 'border-emerald-400 bg-emerald-400'
                        : 'border-dark-500 hover:border-dark-400'
                    }`}
                  >
                    {pollCorrectOption === i && <Check size={10} className="text-white" />}
                  </button>
                )}
                <input
                  type="text"
                  value={option}
                  onChange={(e) => updatePollOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="input-field flex-1 text-xs py-2"
                />
                {pollOptions.length > 2 && (
                  <button
                    onClick={() => removePollOption(i)}
                    className="text-dark-500 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {pollOptions.length < 10 && (
            <button
              onClick={addPollOption}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mb-3"
            >
              <Plus size={14} /> Add option
            </button>
          )}

          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pollIsAnonymous}
                onChange={(e) => setPollIsAnonymous(e.target.checked)}
                className="rounded border-dark-600 bg-dark-800 text-indigo-500"
              />
              <span className="text-dark-300">Anonymous</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pollAllowMultiple}
                onChange={(e) => setPollAllowMultiple(e.target.checked)}
                className="rounded border-dark-600 bg-dark-800 text-indigo-500"
              />
              <span className="text-dark-300">Multiple answers</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pollIsQuiz}
                onChange={(e) => setPollIsQuiz(e.target.checked)}
                className="rounded border-dark-600 bg-dark-800 text-indigo-500"
              />
              <span className="text-dark-300">Quiz mode</span>
            </label>
          </div>
        </div>
      )}

      {/* Schedule picker */}
      {showScheduler && (
        <div className="mb-2.5 flex items-center gap-2 bg-dark-700 rounded-xl px-3 py-2 animate-slide-down">
          <Clock size={16} className="text-blue-400 flex-shrink-0" />
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="bg-transparent text-xs text-dark-200 flex-1 outline-none"
          />
          <button
            onClick={() => { setShowScheduler(false); setScheduledFor(''); }}
            className="text-dark-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* Toolbar */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowFileUpload(!showFileUpload)}
            className="btn-icon text-dark-400 hover:text-indigo-400 hover:bg-indigo-500/10"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <button
            onClick={() => setShowPollCreator(!showPollCreator)}
            className={`btn-icon hover:bg-indigo-500/10 ${showPollCreator ? 'text-indigo-400' : 'text-dark-400 hover:text-indigo-400'}`}
            title="Create poll"
          >
            <BarChart3 size={18} />
          </button>
          <button
            onClick={() => setShowScheduler(!showScheduler)}
            className={`btn-icon hover:bg-blue-500/10 ${showScheduler ? 'text-blue-400' : 'text-dark-400 hover:text-blue-400'}`}
            title="Schedule post"
          >
            <Clock size={18} />
          </button>
          <button
            onClick={() => setIsSilent(!isSilent)}
            className={`btn-icon ${isSilent ? 'text-amber-400 bg-amber-500/10' : 'text-dark-400 hover:text-dark-200'}`}
            title={isSilent ? 'Silent (no notification)' : 'Normal (with notification)'}
          >
            {isSilent ? <BellOff size={18} /> : <Bell size={18} />}
          </button>
        </div>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={showPollCreator ? 'Add a caption (optional)...' : 'Write a post...'}
            className="input-field w-full py-2.5 px-4 text-sm resize-none min-h-[42px] max-h-[150px] pr-12"
            rows={1}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={sending || (!content.trim() && !fileData && !showPollCreator)}
          className="btn-icon w-10 h-10 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600 disabled:opacity-30 disabled:hover:bg-indigo-500 flex-shrink-0 transition-colors"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default ChannelPostInput;
