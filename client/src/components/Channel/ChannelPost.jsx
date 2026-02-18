/**
 * ============================================
 * ChannelPost — Individual Post Component
 * ============================================
 * 
 * Renders a single channel post with:
 * - Author signature, timestamp, edit indicator
 * - Text content, media (image/video/file)
 * - Poll (inline)
 * - Forwarded post indicator
 * - Reactions bar
 * - Comment section (expandable)
 * - View count, pin badge
 * - Admin actions (edit, delete, pin)
 */

import { useState, useRef, useEffect, memo } from 'react';
import {
  Eye, MessageCircle, Pin, MoreVertical, Trash2, Edit3,
  PinOff, Forward, Download, FileText, Loader2, Share2,
  Clock, Smile, ChevronDown, ChevronUp, Send, X, Image,
  Film, Volume2
} from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useAuthStore from '../../store/useAuthStore';
import ChannelPoll from './ChannelPoll';
import { SERVER_URL } from '../../utils/constants';
import { formatMessageTime, isImageFile, formatFileSize } from '../../utils/helpers';

const ChannelPost = memo(({ post, canManage, isOwner, myRole, channelId }) => {
  const user = useAuthStore(s => s.user);
  const toggleReaction = useChannelStore(s => s.toggleReaction);
  const addComment = useChannelStore(s => s.addComment);
  const deleteComment = useChannelStore(s => s.deleteComment);
  const deletePost = useChannelStore(s => s.deletePost);
  const togglePinPost = useChannelStore(s => s.togglePinPost);
  const editPost = useChannelStore(s => s.editPost);
  const forwardPost = useChannelStore(s => s.forwardPost);

  const [showMenu, setShowMenu] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.content || '');
  const [downloading, setDownloading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const menuRef = useRef(null);

  const isScheduled = post.isScheduled;
  const isForwarded = !!post.forwardedFrom;
  const hasFile = post.fileUrl;
  const isImage = hasFile && isImageFile(post.fileMimeType);
  const isVideo = hasFile && post.fileMimeType?.startsWith('video/');
  const isAudio = hasFile && post.fileMimeType?.startsWith('audio/');

  const defaultReactions = ['👍', '❤️', '🔥', '🎉', '😮', '😂', '👎'];

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const handleReaction = async (emoji) => {
    await toggleReaction(channelId, post._id, emoji);
    setShowReactionPicker(false);
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    await addComment(channelId, post._id, commentText.trim());
    setCommentText('');
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Delete this comment?')) return;
    await deleteComment(channelId, post._id, commentId);
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this post?')) return;
    setShowMenu(false);
    await deletePost(channelId, post._id);
  };

  const handleTogglePin = async () => {
    setShowMenu(false);
    await togglePinPost(channelId, post._id);
  };

  const handleEdit = async () => {
    if (!editText.trim()) return;
    await editPost(channelId, post._id, editText.trim());
    setIsEditing(false);
  };

  const handleDownload = async (e) => {
    e.preventDefault();
    if (downloading) return;
    const filename = post.fileUrl.split('/').pop();
    const downloadUrl = `${SERVER_URL}/api/files/download/${filename}`;
    try {
      setDownloading(true);
      if (window.electronAPI?.downloadFile) {
        await window.electronAPI.downloadFile(downloadUrl, post.fileName || filename);
        return;
      }
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = post.fileName || filename;
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

  // ─── TOTAL REACTIONS ───
  const totalReactions = (post.reactions || []).reduce((sum, r) => sum + (r.count || r.users?.length || 0), 0);
  const commentCount = (post.comments || []).filter(c => !c.isDeleted).length;

  return (
    <div
      data-post-id={post._id}
      className={`bg-dark-800 rounded-2xl border transition-colors ${
        post.isPinned ? 'border-amber-500/30' : 'border-dark-700'
      }`}
    >
      {/* Pinned indicator */}
      {post.isPinned && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-amber-400">
          <Pin size={12} />
          <span className="text-[11px] font-medium">Pinned Post</span>
        </div>
      )}

      {/* Forwarded indicator */}
      {isForwarded && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-dark-400">
          <Forward size={12} />
          <span className="text-[11px]">Forwarded from {post.forwardedFrom?.channelName || 'channel'}</span>
        </div>
      )}

      {/* Scheduled indicator */}
      {isScheduled && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-blue-400">
          <Clock size={12} />
          <span className="text-[11px] font-medium">
            Scheduled for {new Date(post.scheduledFor).toLocaleString()}
          </span>
        </div>
      )}

      {/* Post content */}
      <div className="p-4">
        {/* Header: author + time + menu */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {post.authorSignature && (
              <span className="text-xs font-medium text-indigo-400">
                {post.authorSignature}
              </span>
            )}
            <span className="text-[11px] text-dark-500">
              {formatMessageTime(post.createdAt)}
            </span>
            {post.editHistory?.length > 0 && (
              <span className="text-[10px] text-dark-500 italic">edited</span>
            )}
          </div>

          {canManage && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                className="btn-icon w-7 h-7 text-dark-500 hover:text-white"
              >
                <MoreVertical size={14} />
              </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-8 z-50 bg-dark-900 border border-dark-600 rounded-xl shadow-2xl py-1 w-44 animate-scale-in">
                    <button
                      onClick={() => { setIsEditing(true); setEditText(post.content || ''); setShowMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-dark-300 hover:bg-dark-800 flex items-center gap-2"
                    >
                      <Edit3 size={12} /> Edit Post
                    </button>
                    <button
                      onClick={handleTogglePin}
                      className="w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-dark-800 flex items-center gap-2"
                    >
                      {post.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                      {post.isPinned ? 'Unpin' : 'Pin Post'}
                    </button>
                    <button
                      onClick={handleDelete}
                      className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-dark-800 flex items-center gap-2"
                    >
                      <Trash2 size={12} /> Delete Post
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Text content or edit mode */}
        {isEditing ? (
          <div className="mb-3">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="input-field w-full text-sm min-h-[60px] resize-none"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleEdit} className="btn-primary text-xs px-3 py-1.5">Save</button>
              <button onClick={() => setIsEditing(false)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
            </div>
          </div>
        ) : (
          post.content && (
            <p className="text-sm text-dark-100 whitespace-pre-wrap break-words mb-3 leading-relaxed">
              {post.content}
            </p>
          )
        )}

        {/* Media: Image */}
        {isImage && (
          <div className="mb-3 rounded-xl overflow-hidden bg-dark-700">
            {!imageLoaded && (
              <div className="w-full h-48 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-dark-500" />
              </div>
            )}
            <img
              src={`${SERVER_URL}${post.fileUrl}`}
              alt={post.fileName}
              className={`w-full max-h-[500px] object-contain cursor-pointer ${imageLoaded ? '' : 'hidden'}`}
              onLoad={() => setImageLoaded(true)}
            />
          </div>
        )}

        {/* Media: Video */}
        {isVideo && (
          <div className="mb-3 rounded-xl overflow-hidden bg-dark-700">
            <video
              src={`${SERVER_URL}${post.fileUrl}`}
              controls
              className="w-full max-h-[400px]"
              preload="metadata"
            />
          </div>
        )}

        {/* Media: Audio */}
        {isAudio && (
          <div className="mb-3 rounded-xl overflow-hidden bg-dark-700 p-3">
            <div className="flex items-center gap-3">
              <Volume2 size={18} className="text-indigo-400" />
              <audio
                src={`${SERVER_URL}${post.fileUrl}`}
                controls
                className="flex-1"
                preload="metadata"
              />
            </div>
          </div>
        )}

        {/* Media: Other file */}
        {hasFile && !isImage && !isVideo && !isAudio && (
          <button
            onClick={handleDownload}
            className="mb-3 flex items-center gap-3 bg-dark-700 rounded-xl p-3 hover:bg-dark-600 transition-colors w-full text-left"
          >
            <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
              {downloading ? (
                <Loader2 size={18} className="animate-spin text-indigo-400" />
              ) : (
                <FileText size={18} className="text-indigo-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-dark-200 truncate">{post.fileName || 'File'}</p>
              {post.fileSize && (
                <p className="text-xs text-dark-500">{formatFileSize(post.fileSize)}</p>
              )}
            </div>
            <Download size={16} className="text-dark-400 flex-shrink-0" />
          </button>
        )}

        {/* Poll */}
        {post.type === 'poll' && post.poll && (
          <ChannelPoll
            poll={post.poll}
            postId={post._id}
            channelId={channelId}
          />
        )}

        {/* Footer: views, reactions, comments */}
        <div className="flex items-center justify-between pt-2 border-t border-dark-700/50 mt-1">
          <div className="flex items-center gap-3">
            {/* View count */}
            <div className="flex items-center gap-1 text-dark-500">
              <Eye size={13} />
              <span className="text-[11px]">{post.views || 0}</span>
            </div>

            {/* Reactions summary */}
            {totalReactions > 0 && (
              <div className="flex items-center gap-1">
                {(post.reactions || []).slice(0, 3).map((r, i) => (
                  <span key={i} className="text-sm">{r.emoji}</span>
                ))}
                <span className="text-[11px] text-dark-400 ml-0.5">{totalReactions}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* React button */}
            <div className="relative">
              <button
                onClick={() => setShowReactionPicker(!showReactionPicker)}
                className="btn-icon w-7 h-7 text-dark-500 hover:text-dark-200"
              >
                <Smile size={14} />
              </button>
              {showReactionPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowReactionPicker(false)} />
                  <div className="absolute bottom-9 right-0 z-50 bg-dark-900 border border-dark-600 rounded-xl shadow-2xl p-2 flex gap-1 animate-scale-in">
                    {defaultReactions.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(emoji)}
                        className="text-lg hover:scale-125 transition-transform p-1"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Comments toggle */}
            <button
              onClick={() => setShowComments(!showComments)}
              className="btn-icon w-7 h-7 text-dark-500 hover:text-dark-200 flex items-center gap-1"
            >
              <MessageCircle size={14} />
              {commentCount > 0 && (
                <span className="text-[11px]">{commentCount}</span>
              )}
            </button>
          </div>
        </div>

        {/* Reactions detail bar */}
        {(post.reactions || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {post.reactions.map((reaction, i) => {
              const hasReacted = reaction.users?.includes(user?._id);
              return (
                <button
                  key={i}
                  onClick={() => handleReaction(reaction.emoji)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
                    hasReacted
                      ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-300'
                      : 'bg-dark-700 border border-dark-600 text-dark-300 hover:bg-dark-600'
                  }`}
                >
                  <span>{reaction.emoji}</span>
                  <span>{reaction.count || reaction.users?.length || 0}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Comments section */}
        {showComments && (
          <div className="mt-3 pt-3 border-t border-dark-700/50">
            {/* Comments list */}
            <div className="space-y-2 max-h-60 overflow-y-auto mb-3">
              {(post.comments || []).filter(c => !c.isDeleted).length === 0 && (
                <p className="text-xs text-dark-500 text-center py-2">No comments yet</p>
              )}
              {(post.comments || []).filter(c => !c.isDeleted).map((comment) => (
                <div key={comment._id} className="flex gap-2 group">
                  <div className="flex-1 bg-dark-700/50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-indigo-400">
                        {comment.sender?.username || 'User'}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-dark-500">
                          {formatMessageTime(comment.createdAt)}
                        </span>
                        {(comment.sender?._id === user?._id || canManage) && (
                          <button
                            onClick={() => handleDeleteComment(comment._id)}
                            className="opacity-0 group-hover:opacity-100 text-dark-500 hover:text-red-400 transition-all"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-dark-200 mt-0.5">{comment.content}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Comment input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                placeholder="Write a comment..."
                className="input-field flex-1 text-xs py-2"
              />
              <button
                onClick={handleAddComment}
                disabled={!commentText.trim()}
                className="btn-icon w-8 h-8 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-30"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ChannelPost.displayName = 'ChannelPost';

export default ChannelPost;
