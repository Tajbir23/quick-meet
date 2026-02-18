/**
 * ============================================
 * ChannelInfo — Channel Details & Management
 * ============================================
 * 
 * Full-screen side panel with:
 * - Channel info (name, description, username)
 * - Subscriber list with roles
 * - Role management (owner/admin)
 * - Invite link management
 * - Join requests (private channels)
 * - Ban management
 * - Channel settings
 * - Statistics link
 * - Actions: edit, delete, leave
 */

import { useState, useEffect } from 'react';
import {
  X, Radio, Users, Crown, Shield, Star, User, Search,
  MoreVertical, UserMinus, Ban, Link2, Copy, Trash2,
  Settings, BarChart3, LogOut, Edit3, Check, Plus,
  Eye, Clock, Lock, Unlock, ChevronDown, ChevronUp,
  Bell, BellOff, CheckCircle, XCircle, Globe, UserPlus,
  ArrowRightCircle
} from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useAuthStore from '../../store/useAuthStore';
import ChannelStats from './ChannelStats';
import { getInitials, stringToColor } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';
import toast from 'react-hot-toast';

const RoleBadge = ({ role }) => {
  const styles = {
    owner: { icon: Crown, label: 'Owner', color: 'text-amber-400 bg-amber-400/10' },
    admin: { icon: Shield, label: 'Admin', color: 'text-blue-400 bg-blue-400/10' },
    moderator: { icon: Star, label: 'Mod', color: 'text-purple-400 bg-purple-400/10' },
    subscriber: { icon: null, label: null, color: '' },
  };
  const s = styles[role];
  if (!s?.label) return null;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${s.color}`}>
      <Icon size={9} /> {s.label}
    </span>
  );
};

const MemberActions = ({ member, myRole, channelId, isMe }) => {
  const [open, setOpen] = useState(false);
  const changeMemberRole = useChannelStore(s => s.changeMemberRole);
  const removeMember = useChannelStore(s => s.removeMember);
  const banMember = useChannelStore(s => s.banMember);

  if (isMe) return null;
  const memberRole = member.role;
  const canManage = myRole === 'owner' || (myRole === 'admin' && memberRole !== 'owner' && memberRole !== 'admin');

  if (!canManage) return null;

  const userId = member.user?._id || member.user;

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="btn-icon w-7 h-7 text-dark-500 hover:text-white"
      >
        <MoreVertical size={14} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 bg-dark-900 border border-dark-600 rounded-xl shadow-2xl py-1 w-44 animate-scale-in">
            {myRole === 'owner' && (
              <>
                {memberRole !== 'admin' && (
                  <button
                    onClick={async () => {
                      await changeMemberRole(channelId, userId, 'admin');
                      setOpen(false);
                      toast.success('Role changed to Admin');
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-dark-800 flex items-center gap-2"
                  >
                    <Shield size={12} /> Make Admin
                  </button>
                )}
                {memberRole !== 'moderator' && (
                  <button
                    onClick={async () => {
                      await changeMemberRole(channelId, userId, 'moderator');
                      setOpen(false);
                      toast.success('Role changed to Moderator');
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-purple-400 hover:bg-dark-800 flex items-center gap-2"
                  >
                    <Star size={12} /> Make Moderator
                  </button>
                )}
                {memberRole !== 'subscriber' && (
                  <button
                    onClick={async () => {
                      await changeMemberRole(channelId, userId, 'subscriber');
                      setOpen(false);
                      toast.success('Role changed to Subscriber');
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-dark-300 hover:bg-dark-800 flex items-center gap-2"
                  >
                    <User size={12} /> Make Subscriber
                  </button>
                )}
                <hr className="border-dark-700 my-1" />
              </>
            )}
            <button
              onClick={async () => {
                await banMember(channelId, userId);
                setOpen(false);
                toast.success('Member banned');
              }}
              className="w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-dark-800 flex items-center gap-2"
            >
              <Ban size={12} /> Ban
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('Remove this member?')) return;
                await removeMember(channelId, userId);
                setOpen(false);
                toast.success('Member removed');
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-dark-800 flex items-center gap-2"
            >
              <UserMinus size={12} /> Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const ChannelInfo = ({ channel, onClose, myRole, isOwner }) => {
  const user = useAuthStore(s => s.user);
  const editChannel = useChannelStore(s => s.editChannel);
  const deleteChannel = useChannelStore(s => s.deleteChannel);
  const unsubscribeChannel = useChannelStore(s => s.unsubscribeChannel);
  const toggleMute = useChannelStore(s => s.toggleMute);
  const createInviteLink = useChannelStore(s => s.createInviteLink);
  const getInviteLinks = useChannelStore(s => s.getInviteLinks);
  const revokeInviteLink = useChannelStore(s => s.revokeInviteLink);
  const getJoinRequests = useChannelStore(s => s.getJoinRequests);
  const approveJoinRequest = useChannelStore(s => s.approveJoinRequest);
  const rejectJoinRequest = useChannelStore(s => s.rejectJoinRequest);
  const getBannedMembers = useChannelStore(s => s.getBannedMembers);
  const unbanMember = useChannelStore(s => s.unbanMember);
  const transferOwnership = useChannelStore(s => s.transferOwnership);
  const fetchChannelStats = useChannelStore(s => s.fetchChannelStats);

  const [activeSection, setActiveSection] = useState('info'); // info | members | invites | requests | banned | settings | stats
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(channel?.name || '');
  const [editDesc, setEditDesc] = useState(channel?.description || '');
  const [editUsername, setEditUsername] = useState(channel?.username || '');
  const [inviteLinks, setInviteLinks] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [bannedList, setBannedList] = useState([]);
  const [showStats, setShowStats] = useState(false);

  const members = channel?.members?.filter(m => !m.isBanned) || [];
  const canManageChannel = isOwner || myRole === 'admin';

  useEffect(() => {
    if (activeSection === 'invites' && canManageChannel) {
      loadInviteLinks();
    } else if (activeSection === 'requests' && canManageChannel) {
      loadJoinRequests();
    } else if (activeSection === 'banned' && canManageChannel) {
      loadBannedMembers();
    } else if (activeSection === 'stats' && canManageChannel) {
      fetchChannelStats(channel._id);
    }
  }, [activeSection]);

  const loadInviteLinks = async () => {
    const result = await getInviteLinks(channel._id);
    if (result?.data) setInviteLinks(result.data.inviteLinks || []);
  };

  const loadJoinRequests = async () => {
    const result = await getJoinRequests(channel._id);
    if (result?.data) setJoinRequests(result.data.requests || []);
  };

  const loadBannedMembers = async () => {
    const result = await getBannedMembers(channel._id);
    if (result?.data) setBannedList(result.data.bannedMembers || []);
  };

  const handleSaveEdit = async () => {
    const result = await editChannel(channel._id, {
      name: editName.trim(),
      description: editDesc.trim(),
      username: editUsername.trim(),
    });
    if (result?.success !== false) {
      setIsEditing(false);
      toast.success('Channel updated');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this channel permanently? This cannot be undone.')) return;
    const result = await deleteChannel(channel._id);
    if (result?.success !== false) {
      toast.success('Channel deleted');
      onClose();
    }
  };

  const handleLeave = async () => {
    if (!window.confirm('Leave this channel?')) return;
    await unsubscribeChannel(channel._id);
    toast.success('Left channel');
    onClose();
  };

  const handleCreateInviteLink = async () => {
    const result = await createInviteLink(channel._id, {
      maxUses: 0,
      expiresDays: 7,
    });
    if (result?.success !== false) {
      toast.success('Invite link created');
      loadInviteLinks();
    }
  };

  const handleCopyInviteLink = (code) => {
    const link = `${window.location.origin}/channel/join/${code}`;
    navigator.clipboard.writeText(link);
    toast.success('Link copied!');
  };

  const handleToggleMute = async () => {
    await toggleMute(channel._id);
  };

  const handleTransferOwnership = async (userId) => {
    if (!window.confirm('Transfer channel ownership? This action is irreversible!')) return;
    const result = await transferOwnership(channel._id, userId);
    if (result?.success !== false) {
      toast.success('Ownership transferred');
    }
  };

  const filteredMembers = members.filter(m => {
    const username = m.user?.username || '';
    return username.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (!channel) return null;

  const sections = [
    { id: 'info', label: 'Info', icon: Radio },
    { id: 'members', label: `Members (${members.length})`, icon: Users },
    ...(canManageChannel ? [
      { id: 'invites', label: 'Invite Links', icon: Link2 },
      ...(channel.type === 'private' ? [{ id: 'requests', label: 'Join Requests', icon: UserPlus }] : []),
      { id: 'banned', label: 'Banned', icon: Ban },
      { id: 'stats', label: 'Statistics', icon: BarChart3 },
    ] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-slide-in-right">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-dark-800 border-l border-dark-700 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="h-16 border-b border-dark-700 flex items-center px-4 gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
            <X size={20} />
          </button>
          <h2 className="text-sm font-semibold text-white flex-1">Channel Info</h2>
          {canManageChannel && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowStats(true)}
                className="btn-icon text-dark-400 hover:text-indigo-400"
                title="Statistics"
              >
                <BarChart3 size={18} />
              </button>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="btn-icon text-dark-400 hover:text-indigo-400"
                title="Edit"
              >
                <Edit3 size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-dark-700 overflow-x-auto">
          {sections.map(sec => (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium whitespace-nowrap transition-colors relative ${
                activeSection === sec.id ? 'text-indigo-400' : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <sec.icon size={14} />
              {sec.label}
              {activeSection === sec.id && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-400 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* ─── INFO SECTION ─── */}
          {activeSection === 'info' && (
            <div className="p-4">
              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Channel Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="input-field w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Username</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500">@</span>
                      <input
                        type="text"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                        className="input-field w-full pl-8"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Description</label>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="input-field w-full min-h-[80px] resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} className="btn-primary text-sm px-4 py-2">Save</button>
                    <button onClick={() => setIsEditing(false)} className="btn-secondary text-sm px-4 py-2">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Channel card */}
                  <div className="text-center mb-6">
                    <div className="w-20 h-20 rounded-full bg-indigo-500/20 flex items-center justify-center mx-auto mb-3">
                      <Radio size={36} className="text-indigo-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-white">{channel.name}</h3>
                    {channel.username && (
                      <p className="text-sm text-dark-400">@{channel.username}</p>
                    )}
                    <div className="flex items-center justify-center gap-3 mt-2">
                      <span className="text-xs text-dark-500 flex items-center gap-1">
                        {channel.type === 'private' ? <Lock size={12} /> : <Globe size={12} />}
                        {channel.type === 'private' ? 'Private' : 'Public'}
                      </span>
                      <span className="text-xs text-dark-500 flex items-center gap-1">
                        <Users size={12} />
                        {members.length} subscribers
                      </span>
                    </div>
                  </div>

                  {channel.description && (
                    <div className="mb-4">
                      <h4 className="text-xs text-dark-500 font-medium mb-1">Description</h4>
                      <p className="text-sm text-dark-200 whitespace-pre-wrap">{channel.description}</p>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="space-y-2">
                    <button
                      onClick={handleToggleMute}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-dark-700 transition-colors text-left"
                    >
                      <BellOff size={18} className="text-dark-400" />
                      <span className="text-sm text-dark-200">Mute / Unmute</span>
                    </button>

                    {!isOwner && (
                      <button
                        onClick={handleLeave}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-dark-700 transition-colors text-left"
                      >
                        <LogOut size={18} className="text-red-400" />
                        <span className="text-sm text-red-400">Leave Channel</span>
                      </button>
                    )}

                    {isOwner && (
                      <button
                        onClick={handleDelete}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-dark-700 transition-colors text-left"
                      >
                        <Trash2 size={18} className="text-red-400" />
                        <span className="text-sm text-red-400">Delete Channel</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── MEMBERS SECTION ─── */}
          {activeSection === 'members' && (
            <div className="p-4">
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search members..."
                  className="input-field w-full pl-9 py-2 text-xs"
                />
              </div>

              <div className="space-y-1">
                {filteredMembers.map(member => {
                  const memberId = member.user?._id || member.user;
                  const username = member.user?.username || 'Unknown';
                  const avatar = member.user?.avatar;
                  const isMe = memberId === user?._id;

                  return (
                    <div
                      key={memberId}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-dark-700/50 transition-colors"
                    >
                      {avatar ? (
                        <img
                          src={`${SERVER_URL}${avatar}`}
                          alt={username}
                          className="w-9 h-9 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: stringToColor(username) }}
                        >
                          {getInitials(username)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-white truncate">{username}</span>
                          {isMe && (
                            <span className="text-[10px] text-dark-500">you</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <RoleBadge role={member.role} />
                          {member.customTitle && (
                            <span className="text-[10px] text-dark-500">{member.customTitle}</span>
                          )}
                        </div>
                      </div>
                      <MemberActions
                        member={member}
                        myRole={myRole}
                        channelId={channel._id}
                        isMe={isMe}
                      />
                      {isOwner && !isMe && member.role === 'admin' && (
                        <button
                          onClick={() => handleTransferOwnership(memberId)}
                          className="btn-icon w-7 h-7 text-dark-500 hover:text-amber-400"
                          title="Transfer ownership"
                        >
                          <ArrowRightCircle size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── INVITE LINKS SECTION ─── */}
          {activeSection === 'invites' && (
            <div className="p-4">
              <button
                onClick={handleCreateInviteLink}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm mb-4"
              >
                <Plus size={16} /> Create Invite Link
              </button>

              {/* Default invite code */}
              {channel.defaultInviteCode && (
                <div className="bg-dark-700 rounded-xl p-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-dark-400 mb-1">Default Invite Link</p>
                      <p className="text-sm text-indigo-400 font-mono">
                        .../join/{channel.defaultInviteCode}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCopyInviteLink(channel.defaultInviteCode)}
                      className="btn-icon text-dark-400 hover:text-indigo-400"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Custom invite links */}
              <div className="space-y-2">
                {inviteLinks.map((link, i) => (
                  <div key={i} className="bg-dark-700 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-indigo-400 font-mono truncate flex-1">
                        .../{link.code}
                      </p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleCopyInviteLink(link.code)}
                          className="btn-icon w-7 h-7 text-dark-400 hover:text-indigo-400"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={async () => {
                            await revokeInviteLink(channel._id, link.code);
                            loadInviteLinks();
                            toast.success('Link revoked');
                          }}
                          className="btn-icon w-7 h-7 text-dark-400 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-dark-500">
                      <span>Uses: {link.uses || 0}{link.maxUses > 0 ? `/${link.maxUses}` : ''}</span>
                      {link.expiresAt && (
                        <span>Expires: {new Date(link.expiresAt).toLocaleDateString()}</span>
                      )}
                      {link.requiresApproval && <span className="text-amber-400">Requires approval</span>}
                    </div>
                  </div>
                ))}
                {inviteLinks.length === 0 && (
                  <p className="text-xs text-dark-500 text-center py-4">No custom invite links</p>
                )}
              </div>
            </div>
          )}

          {/* ─── JOIN REQUESTS SECTION ─── */}
          {activeSection === 'requests' && (
            <div className="p-4">
              {joinRequests.length === 0 ? (
                <p className="text-xs text-dark-500 text-center py-8">No pending join requests</p>
              ) : (
                <div className="space-y-2">
                  {joinRequests.map((req, i) => (
                    <div key={i} className="bg-dark-700 rounded-xl p-3 flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: stringToColor(req.user?.username || '') }}
                      >
                        {getInitials(req.user?.username || '')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{req.user?.username}</p>
                        <p className="text-[10px] text-dark-500">
                          {new Date(req.requestedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async () => {
                            const userId = req.user?._id || req.user;
                            await approveJoinRequest(channel._id, userId);
                            loadJoinRequests();
                            toast.success('Request approved');
                          }}
                          className="btn-icon w-8 h-8 text-emerald-400 hover:bg-emerald-500/10"
                        >
                          <CheckCircle size={18} />
                        </button>
                        <button
                          onClick={async () => {
                            const userId = req.user?._id || req.user;
                            await rejectJoinRequest(channel._id, userId);
                            loadJoinRequests();
                            toast.success('Request rejected');
                          }}
                          className="btn-icon w-8 h-8 text-red-400 hover:bg-red-500/10"
                        >
                          <XCircle size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── BANNED MEMBERS SECTION ─── */}
          {activeSection === 'banned' && (
            <div className="p-4">
              {bannedList.length === 0 ? (
                <p className="text-xs text-dark-500 text-center py-8">No banned members</p>
              ) : (
                <div className="space-y-2">
                  {bannedList.map((banned, i) => (
                    <div key={i} className="bg-dark-700 rounded-xl p-3 flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white opacity-50"
                        style={{ backgroundColor: stringToColor(banned.user?.username || '') }}
                      >
                        {getInitials(banned.user?.username || '')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-dark-300 truncate">{banned.user?.username}</p>
                        {banned.banReason && (
                          <p className="text-[10px] text-dark-500">{banned.banReason}</p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          const userId = banned.user?._id || banned.user;
                          await unbanMember(channel._id, userId);
                          loadBannedMembers();
                          toast.success('Member unbanned');
                        }}
                        className="btn-icon text-dark-400 hover:text-emerald-400 text-xs"
                      >
                        <Unlock size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── STATISTICS SECTION ─── */}
          {activeSection === 'stats' && (
            <ChannelStats channelId={channel._id} />
          )}
        </div>
      </div>

      {/* Full stats modal */}
      {showStats && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowStats(false)} />
          <div className="relative bg-dark-800 rounded-2xl border border-dark-700 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-dark-700">
              <h3 className="text-sm font-semibold text-white">Channel Statistics</h3>
              <button onClick={() => setShowStats(false)} className="btn-icon text-dark-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <ChannelStats channelId={channel._id} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ChannelInfo;
