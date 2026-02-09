/**
 * ============================================
 * GroupChat — Group-specific chat window additions
 * ============================================
 * 
 * Extension component for group-specific features:
 * - Member list panel
 * - Group info header
 * - Join/leave actions
 * 
 * The actual message display is handled by ChatWindow + MessageBubble.
 * This component provides the group management overlay panel.
 */

import { useState, useEffect } from 'react';
import { Users, LogOut, UserPlus, Crown, Hash, X } from 'lucide-react';
import useGroupStore from '../../store/useGroupStore';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor } from '../../utils/helpers';
import toast from 'react-hot-toast';
import api from '../../services/api';

const GroupChat = ({ groupId, onClose }) => {
  const [group, setGroup] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const { leaveGroup } = useGroupStore();
  const { users, onlineUsers, clearActiveChat } = useChatStore();
  const { user } = useAuthStore();

  useEffect(() => {
    const fetchGroup = async () => {
      try {
        const res = await api.get(`/groups/${groupId}`);
        setGroup(res.data.data.group);
      } catch (err) {
        console.error('Failed to fetch group:', err);
      } finally {
        setIsLoading(false);
      }
    };
    if (groupId) fetchGroup();
  }, [groupId]);

  const handleLeave = async () => {
    if (!window.confirm('Are you sure you want to leave this group?')) return;

    const result = await leaveGroup(groupId);
    if (result.success) {
      toast.success('Left the group');
      clearActiveChat();
      onClose?.();
    } else {
      toast.error(result.message);
    }
  };

  const handleAddMember = async (userId) => {
    const { addMember } = useGroupStore.getState();
    const result = await addMember(groupId, userId);
    if (result.success) {
      toast.success('Member added');
      // Re-fetch group data
      const res = await api.get(`/groups/${groupId}`);
      setGroup(res.data.data.group);
    } else {
      toast.error(result.message);
    }
  };

  const isAdmin = group?.admin === user?._id || group?.admin?._id === user?._id;
  const memberIds = group?.members?.map(m => m._id || m) || [];

  const nonMembers = users.filter(u => !memberIds.includes(u._id));

  const isOnline = (userId) => onlineUsers.some(u => u.userId === userId);

  if (isLoading) {
    return (
      <div className="w-72 bg-dark-800 border-l border-dark-700 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="w-72 bg-dark-800 border-l border-dark-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-dark-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Hash size={16} className="text-primary-400" />
            Group Info
          </h3>
          <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <p className="text-lg font-medium text-white">{group.name}</p>
        {group.description && (
          <p className="text-xs text-dark-400 mt-1">{group.description}</p>
        )}
      </div>

      {/* Members list */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 flex items-center justify-between">
          <p className="text-xs text-dark-400 uppercase font-medium">
            Members ({group.members?.length || 0})
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowAddMember(!showAddMember)}
              className="text-primary-400 hover:text-primary-300"
              title="Add member"
            >
              <UserPlus size={14} />
            </button>
          )}
        </div>

        {/* Add member panel */}
        {showAddMember && isAdmin && (
          <div className="px-3 pb-3">
            <div className="bg-dark-900 rounded-lg max-h-32 overflow-y-auto">
              {nonMembers.length === 0 ? (
                <p className="text-dark-500 text-xs p-2 text-center">All users are members</p>
              ) : (
                nonMembers.map(u => (
                  <button
                    key={u._id}
                    onClick={() => handleAddMember(u._id)}
                    className="w-full flex items-center gap-2 p-2 hover:bg-dark-800 text-left text-sm"
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: stringToColor(u.username) }}
                    >
                      {getInitials(u.username)}
                    </div>
                    <span className="text-dark-300 truncate">{u.username}</span>
                    <UserPlus size={12} className="ml-auto text-primary-400" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Member list */}
        <div className="divide-y divide-dark-700/30">
          {(group.members || []).map(member => {
            const memberId = member._id || member;
            const memberName = member.username || 'Unknown';
            const memberIsAdmin = memberId === (group.admin?._id || group.admin);
            const memberOnline = isOnline(memberId);

            return (
              <div key={memberId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="relative">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: stringToColor(memberName) }}
                  >
                    {getInitials(memberName)}
                  </div>
                  <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${
                    memberOnline ? 'bg-emerald-400' : 'bg-dark-500'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate flex items-center gap-1.5">
                    {memberName}
                    {memberId === user?._id && (
                      <span className="text-xs text-dark-500">(you)</span>
                    )}
                  </p>
                  {memberIsAdmin && (
                    <p className="text-xs text-yellow-400 flex items-center gap-1">
                      <Crown size={10} /> Admin
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Leave group */}
      <div className="p-3 border-t border-dark-700">
        <button
          onClick={handleLeave}
          className="w-full py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={14} />
          Leave Group
        </button>
      </div>
    </div>
  );
};

export default GroupChat;
