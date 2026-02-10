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
import { Users, LogOut, UserPlus, Crown, Hash, X, Search } from 'lucide-react';
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
  const [memberSearch, setMemberSearch] = useState('');
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
    try {
      const res = await api.post(`/groups/${groupId}/add-member`, { userId });
      if (res.data.success) {
        toast.success('Member added');
        // Re-fetch group data
        const groupRes = await api.get(`/groups/${groupId}`);
        setGroup(groupRes.data.data.group);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add member');
    }
  };

  const isAdmin = group?.admin === user?._id || group?.admin?._id === user?._id;
  const memberIds = group?.members?.map(m => m._id || m) || [];

  const nonMembers = users.filter(u => {
    if (memberIds.includes(u._id)) return false;
    if (memberSearch) {
      return u.username.toLowerCase().includes(memberSearch.toLowerCase()) ||
             u.email?.toLowerCase().includes(memberSearch.toLowerCase());
    }
    return true;
  });

  const isOnline = (userId) => onlineUsers.some(u => u.userId === userId);

  if (isLoading) {
    return (
      <div className="fixed inset-0 md:relative md:inset-auto md:w-80 bg-dark-800 md:border-l border-dark-700 flex items-center justify-center z-30 flex-shrink-0">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="fixed inset-0 md:relative md:inset-auto md:w-80 bg-dark-800 md:border-l border-dark-700 flex flex-col h-full z-30 flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-dark-700 safe-top">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Hash size={16} className="text-primary-400" />
            Group Info
          </h3>
          <button onClick={onClose} className="btn-icon w-10 h-10 text-dark-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <p className="text-lg font-semibold text-white">{group.name}</p>
        {group.description && (
          <p className="text-xs text-dark-400 mt-1">{group.description}</p>
        )}
      </div>

      {/* Members list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-3 flex items-center justify-between">
          <p className="text-xs text-dark-400 uppercase font-medium tracking-wide">
            Members ({group.members?.length || 0})
          </p>
          <button
            onClick={() => { setShowAddMember(!showAddMember); setMemberSearch(''); }}
            className={`btn-icon w-8 h-8 transition-colors ${
              showAddMember ? 'text-primary-300 bg-primary-500/10' : 'text-primary-400 hover:text-primary-300'
            }`}
            title="Add member"
          >
            <UserPlus size={16} />
          </button>
        </div>

        {/* Add member panel */}
        {showAddMember && (
          <div className="px-3 pb-3 animate-slide-down">
            {/* Search input */}
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search users..."
                className="input-field pl-9 py-2 text-xs bg-dark-900"
                autoFocus
              />
            </div>
            <div className="bg-dark-900 rounded-xl max-h-48 overflow-y-auto">
              {nonMembers.length === 0 ? (
                <p className="text-dark-500 text-xs p-3 text-center">
                  {memberSearch ? 'No users found' : 'All users are members'}
                </p>
              ) : (
                nonMembers.map(u => (
                  <button
                    key={u._id}
                    onClick={() => handleAddMember(u._id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-dark-800 active:bg-dark-700 text-left text-sm transition-colors"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: stringToColor(u.username) }}
                    >
                      {getInitials(u.username)}
                    </div>
                    <span className="text-dark-300 truncate flex-1">{u.username}</span>
                    <span className="text-dark-500 text-xs truncate max-w-[80px]">{u.email}</span>
                    <UserPlus size={14} className="ml-1 text-primary-400 flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Member list */}
        <div>
          {(group.members || []).map(member => {
            const memberId = member._id || member;
            const memberName = member.username || 'Unknown';
            const memberIsAdmin = memberId === (group.admin?._id || group.admin);
            const memberOnline = isOnline(memberId);

            return (
              <div key={memberId} className="flex items-center gap-3 px-3 py-3">
                <div className="relative">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: stringToColor(memberName) }}
                  >
                    {getInitials(memberName)}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${
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
      <div className="p-3 border-t border-dark-700 safe-bottom">
        <button
          onClick={handleLeave}
          className="w-full py-3 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={16} />
          Leave Group
        </button>
      </div>
    </div>
  );
};

export default GroupChat;
