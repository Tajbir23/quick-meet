/**
 * ============================================
 * GroupChat — Role-Based Group Management Panel
 * ============================================
 * 
 * Extension component for group-specific features:
 * - Member list with roles (Admin / Moderator / Member)
 * - Role change (admin only)
 * - Add member (admin & moderator)
 * - Remove member (admin removes anyone, moderator removes members)
 * - Leave group
 * 
 * The actual message display is handled by ChatWindow + MessageBubble.
 */

import { useState, useEffect } from 'react';
import {
  Users, LogOut, UserPlus, Crown, Hash, X, Search,
  Shield, UserMinus, ChevronDown, MoreVertical
} from 'lucide-react';
import useGroupStore from '../../store/useGroupStore';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor } from '../../utils/helpers';
import toast from 'react-hot-toast';
import api from '../../services/api';

/**
 * Role badge component
 */
const RoleBadge = ({ role }) => {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full">
        <Crown size={9} /> Admin
      </span>
    );
  }
  if (role === 'moderator') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">
        <Shield size={9} /> Mod
      </span>
    );
  }
  return null; // regular members don't need a badge
};

/**
 * Member action menu (dropdown)
 */
const MemberActions = ({ memberId, memberRole, myRole, onRemove, onChangeRole, isMe }) => {
  const [open, setOpen] = useState(false);

  if (isMe) return null;

  // Determine what actions are available
  const canRemove =
    (myRole === 'admin') ||
    (myRole === 'moderator' && memberRole === 'member');

  const canChangeRole = myRole === 'admin';

  if (!canRemove && !canChangeRole) return null;

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="btn-icon w-7 h-7 text-dark-500 hover:text-white transition-colors"
      >
        <MoreVertical size={14} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Menu */}
          <div className="absolute right-0 top-8 z-50 bg-dark-900 border border-dark-600 rounded-xl shadow-2xl py-1 w-44 animate-scale-in">
            {canChangeRole && (
              <>
                {memberRole !== 'moderator' && (
                  <button
                    onClick={() => { onChangeRole(memberId, 'moderator'); setOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-dark-800 flex items-center gap-2 transition-colors"
                  >
                    <Shield size={12} />
                    Make Moderator
                  </button>
                )}
                {memberRole !== 'member' && (
                  <button
                    onClick={() => { onChangeRole(memberId, 'member'); setOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-dark-300 hover:bg-dark-800 flex items-center gap-2 transition-colors"
                  >
                    <Users size={12} />
                    Make Member
                  </button>
                )}
                {memberRole !== 'admin' && (
                  <button
                    onClick={() => {
                      if (window.confirm('Transfer admin to this user? You will become a moderator.')) {
                        onChangeRole(memberId, 'admin');
                      }
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-yellow-400 hover:bg-dark-800 flex items-center gap-2 transition-colors"
                  >
                    <Crown size={12} />
                    Make Admin
                  </button>
                )}
                <div className="border-t border-dark-700 my-1" />
              </>
            )}
            {canRemove && (
              <button
                onClick={() => {
                  if (window.confirm('Remove this member from the group?')) {
                    onRemove(memberId);
                  }
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-dark-800 flex items-center gap-2 transition-colors"
              >
                <UserMinus size={12} />
                Remove from Group
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const GroupChat = ({ groupId, onClose }) => {
  const [group, setGroup] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const { leaveGroup } = useGroupStore();
  const { users, onlineUsers, clearActiveChat } = useChatStore();
  const { user } = useAuthStore();

  const fetchGroupData = async () => {
    try {
      const res = await api.get(`/groups/${groupId}`);
      setGroup(res.data.data.group);
    } catch (err) {
      console.error('Failed to fetch group:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (groupId) fetchGroupData();
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
        fetchGroupData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add member');
    }
  };

  const handleRemoveMember = async (userId) => {
    try {
      const res = await api.post(`/groups/${groupId}/remove-member`, { userId });
      if (res.data.success) {
        toast.success('Member removed');
        fetchGroupData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove member');
    }
  };

  const handleChangeRole = async (userId, role) => {
    try {
      const res = await api.put(`/groups/${groupId}/change-role`, { userId, role });
      if (res.data.success) {
        toast.success(`Role changed to ${role}`);
        fetchGroupData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change role');
    }
  };

  // Determine current user's role in this group
  const getMyRole = () => {
    if (!group || !user) return null;
    const me = group.members?.find(m => {
      const id = m.user?._id || m.user || m._id || m;
      return id === user._id;
    });
    return me?.role || null;
  };

  const myRole = getMyRole();
  const canInvite = myRole === 'admin' || myRole === 'moderator';

  // Build member IDs for filtering non-members
  const memberIds = (group?.members || []).map(m => {
    const u = m.user;
    return u?._id || u || m._id || m;
  });

  const nonMembers = users.filter(u => {
    if (memberIds.includes(u._id)) return false;
    if (memberSearch) {
      return u.username.toLowerCase().includes(memberSearch.toLowerCase()) ||
             u.email?.toLowerCase().includes(memberSearch.toLowerCase());
    }
    return true;
  });

  const isOnline = (userId) => onlineUsers.some(u => u.userId === userId);

  // Sort members: admin first, then moderators, then members
  const sortedMembers = [...(group?.members || [])].sort((a, b) => {
    const order = { admin: 0, moderator: 1, member: 2 };
    return (order[a.role] ?? 2) - (order[b.role] ?? 2);
  });

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
        {/* Your role indicator */}
        {myRole && (
          <div className="mt-2">
            <RoleBadge role={myRole} />
          </div>
        )}
      </div>

      {/* Members list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-3 flex items-center justify-between">
          <p className="text-xs text-dark-400 uppercase font-medium tracking-wide">
            Members ({group.members?.length || 0})
          </p>
          {canInvite && (
            <button
              onClick={() => { setShowAddMember(!showAddMember); setMemberSearch(''); }}
              className={`btn-icon w-8 h-8 transition-colors ${
                showAddMember ? 'text-primary-300 bg-primary-500/10' : 'text-primary-400 hover:text-primary-300'
              }`}
              title="Add member"
            >
              <UserPlus size={16} />
            </button>
          )}
        </div>

        {/* Add member panel — only for admin & moderator */}
        {showAddMember && canInvite && (
          <div className="px-3 pb-3 animate-slide-down">
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

        {/* Member list with roles */}
        <div>
          {sortedMembers.map(member => {
            const memberUser = member.user || {};
            const memberId = memberUser._id || memberUser;
            const memberName = memberUser.username || 'Unknown';
            const memberRole = member.role || 'member';
            const memberOnline = isOnline(memberId);
            const isMe = memberId === user?._id;

            return (
              <div key={memberId} className="flex items-center gap-3 px-3 py-3 hover:bg-dark-700/30 transition-colors group/member">
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
                    {isMe && (
                      <span className="text-xs text-dark-500">(you)</span>
                    )}
                  </p>
                  <RoleBadge role={memberRole} />
                </div>

                {/* Action menu — visible on hover or always on mobile */}
                <div className="opacity-0 group-hover/member:opacity-100 transition-opacity md:opacity-0 max-md:opacity-100">
                  <MemberActions
                    memberId={memberId}
                    memberRole={memberRole}
                    myRole={myRole}
                    isMe={isMe}
                    onRemove={handleRemoveMember}
                    onChangeRole={handleChangeRole}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Permission info + Leave group */}
      <div className="p-3 border-t border-dark-700 safe-bottom space-y-2">
        {/* Role permissions hint */}
        {!canInvite && (
          <p className="text-[10px] text-dark-500 text-center px-2">
            Only admin & moderators can add or remove members
          </p>
        )}
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
