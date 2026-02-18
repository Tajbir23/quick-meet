/**
 * ============================================
 * UserProfileModal — View other user's profile
 * ============================================
 * 
 * Shows: avatar, username, email (if visible), online status, join date
 * Action: Start chat
 */

import { useState, useEffect } from 'react';
import {
  X, MessageCircle, Mail, Calendar, Clock, Shield, Loader2
} from 'lucide-react';
import api from '../../services/api';
import { SERVER_URL } from '../../utils/constants';
import { getInitials, stringToColor, formatLastSeen } from '../../utils/helpers';
import useChatStore from '../../store/useChatStore';

const UserProfileModal = ({ userId, onClose }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const setActiveChat = useChatStore(s => s.setActiveChat);
  const isUserOnline = useChatStore(s => s.isUserOnline);
  const userLastSeen = useChatStore(s => s.userLastSeen);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const id = typeof userId === 'object' ? (userId._id || userId.id) : userId;
        const res = await api.get(`/users/${id}`);
        setProfile(res.data.data.user);
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [userId]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleStartChat = () => {
    if (!profile) return;
    setActiveChat({
      id: profile._id,
      type: 'user',
      name: profile.username,
      avatar: profile.avatar,
      role: profile.role,
    });
    onClose();
  };

  const online = profile ? isUserOnline(profile._id) : false;
  const avatarUrl = profile?.avatar ? `${SERVER_URL}${profile.avatar}` : null;

  return (
    <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-dark-700" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
          <h2 className="text-base font-bold text-white">User Profile</h2>
          <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="text-primary-400 animate-spin" />
          </div>
        ) : profile ? (
          <div className="p-5">
            {/* Avatar & name */}
            <div className="flex flex-col items-center mb-5">
              <div className="relative mb-3">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={profile.username}
                    className="w-24 h-24 rounded-full object-cover border-3 border-dark-600"
                  />
                ) : (
                  <div
                    className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold text-white border-3 border-dark-600"
                    style={{ backgroundColor: stringToColor(profile.username) }}
                  >
                    {getInitials(profile.username)}
                  </div>
                )}
                <span className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-3 border-dark-800 ${
                  online ? 'bg-emerald-400' : 'bg-dark-500'
                }`} />
              </div>

              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {profile.username}
                {profile.role === 'owner' && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] rounded-full font-medium">
                    <Shield size={9} />
                    OWNER
                  </span>
                )}
              </h3>
              <p className={`text-xs mt-1 ${online ? 'text-emerald-400' : 'text-dark-400'}`}>
                {online ? 'Online' : formatLastSeen(userLastSeen[profile._id] || profile.lastSeen) || 'Offline'}
              </p>
            </div>

            {/* Info items */}
            <div className="space-y-3 mb-5">
              {profile.email && !profile.emailHidden && (
                <div className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl">
                  <Mail size={16} className="text-dark-400 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] text-dark-500">Email</p>
                    <p className="text-sm text-dark-200">{profile.email}</p>
                  </div>
                </div>
              )}

              {profile.createdAt && (
                <div className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl">
                  <Calendar size={16} className="text-dark-400 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] text-dark-500">Joined</p>
                    <p className="text-sm text-dark-200">
                      {new Date(profile.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'long', day: 'numeric'
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Start chat button */}
            <button
              onClick={handleStartChat}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
            >
              <MessageCircle size={16} />
              Send Message
            </button>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-dark-400 text-sm">User not found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileModal;
