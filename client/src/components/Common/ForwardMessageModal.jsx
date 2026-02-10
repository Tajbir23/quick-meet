/**
 * ============================================
 * ForwardMessageModal — Forward a message to another user/group
 * ============================================
 */

import { useState } from 'react';
import {
  X, Search, Forward, Loader2, Users, Check
} from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useGroupStore from '../../store/useGroupStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor, truncate } from '../../utils/helpers';
import toast from 'react-hot-toast';

const ForwardMessageModal = ({ message, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [forwarding, setForwarding] = useState(null); // id of target being forwarded to
  const [forwarded, setForwarded] = useState([]); // list of already forwarded target ids
  const users = useChatStore(s => s.users);
  const sendMessage = useChatStore(s => s.sendMessage);
  const currentUser = useAuthStore(s => s.user);
  const { myGroups } = useGroupStore();

  const filteredUsers = users.filter(u => {
    if (u._id === currentUser?._id) return false;
    if (searchQuery) {
      return u.username.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const filteredGroups = (myGroups || []).filter(g => {
    if (searchQuery) {
      return g.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const handleForward = async (targetId, targetType, targetName) => {
    if (forwarding || forwarded.includes(targetId)) return;
    setForwarding(targetId);

    try {
      // Build forwarded content
      const content = message.content || '';
      const forwardPrefix = `↪ Forwarded message`;
      const fullContent = content ? `${forwardPrefix}\n${content}` : forwardPrefix;

      // If message has a file, forward with file data
      const fileData = message.fileUrl ? {
        type: message.type || 'file',
        url: message.fileUrl,
        name: message.fileName,
        size: message.fileSize,
        mimeType: message.fileMimeType,
      } : null;

      await sendMessage(targetId, targetType, fullContent, fileData);
      setForwarded(prev => [...prev, targetId]);
      toast.success(`Forwarded to ${targetName}`);
    } catch (err) {
      toast.error('Failed to forward message');
    } finally {
      setForwarding(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-800 rounded-2xl w-full max-w-sm max-h-[80vh] overflow-hidden shadow-2xl border border-dark-700" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-dark-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Forward size={18} />
              Forward Message
            </h2>
            <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
              <X size={20} />
            </button>
          </div>

          {/* Message preview */}
          <div className="p-2.5 bg-dark-700/50 rounded-xl text-xs text-dark-300 line-clamp-2">
            {message.content || (message.fileName ? `📎 ${message.fileName}` : 'File')}
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users & groups..."
              className="input-field pl-10 py-2 text-sm bg-dark-900/50"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto max-h-[50vh] py-1">
          {/* Groups */}
          {filteredGroups.length > 0 && (
            <>
              <p className="text-[11px] text-dark-500 font-medium px-4 py-2 uppercase">Groups</p>
              {filteredGroups.map(group => (
                <button
                  key={group._id}
                  onClick={() => handleForward(group._id, 'group', group.name)}
                  disabled={forwarding === group._id || forwarded.includes(group._id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-700 transition-colors disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                    <Users size={16} className="text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-white truncate">{group.name}</p>
                    <p className="text-[11px] text-dark-400">{group.members?.length || 0} members</p>
                  </div>
                  {forwarding === group._id && <Loader2 size={16} className="text-primary-400 animate-spin flex-shrink-0" />}
                  {forwarded.includes(group._id) && <Check size={16} className="text-emerald-400 flex-shrink-0" />}
                </button>
              ))}
            </>
          )}

          {/* Users */}
          {filteredUsers.length > 0 && (
            <>
              <p className="text-[11px] text-dark-500 font-medium px-4 py-2 uppercase">Users</p>
              {filteredUsers.map(user => (
                <button
                  key={user._id}
                  onClick={() => handleForward(user._id, 'user', user.username)}
                  disabled={forwarding === user._id || forwarded.includes(user._id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-700 transition-colors disabled:opacity-60"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: stringToColor(user.username) }}
                  >
                    {getInitials(user.username)}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-white truncate">{user.username}</p>
                  </div>
                  {forwarding === user._id && <Loader2 size={16} className="text-primary-400 animate-spin flex-shrink-0" />}
                  {forwarded.includes(user._id) && <Check size={16} className="text-emerald-400 flex-shrink-0" />}
                </button>
              ))}
            </>
          )}

          {filteredUsers.length === 0 && filteredGroups.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-dark-400 text-sm">No users or groups found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForwardMessageModal;
