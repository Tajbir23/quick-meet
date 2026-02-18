import { useState, useEffect } from 'react';
import {
  MessageCircle, Users, Search, LogOut, Plus, Hash, X,
  Shield, Eye, EyeOff, Settings, HardDrive, Radio
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/useAuthStore';
import useChatStore from '../../store/useChatStore';
import useGroupStore from '../../store/useGroupStore';
import useOwnerStore from '../../store/useOwnerStore';
import useChannelStore from '../../store/useChannelStore';
import { SERVER_URL } from '../../utils/constants';
import ActiveUsers from '../Users/ActiveUsers';
import ChatList from '../Chat/ChatList';
import GroupList from '../Group/GroupList';
import CreateGroup from '../Group/CreateGroup';
import ChannelList from '../Channel/ChannelList';
import CreateChannel from '../Channel/CreateChannel';
import ChannelDiscover from '../Channel/ChannelDiscover';
import UserSettings from '../Common/UserSettings';
import SearchResults from '../Common/SearchResults';
import { getInitials, stringToColor } from '../../utils/helpers';
import toast from 'react-hot-toast';

const Sidebar = () => {
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'groups' | 'channels' | 'users'
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showDiscoverChannels, setShowDiscoverChannels] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const isOwner = useAuthStore(s => s.isOwner);
  const users = useChatStore(s => s.users);
  const { myGroups } = useGroupStore();
  const { ownerModeVisible, toggleOwnerVisibility } = useOwnerStore();
  const navigate = useNavigate();

  // Sync ownerModeVisible from user data on mount
  useEffect(() => {
    if (isOwner && user?.ownerModeVisible !== undefined) {
      useOwnerStore.getState().setOwnerModeVisible(user.ownerModeVisible);
    }
  }, [isOwner, user?.ownerModeVisible]);

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      logout();
    }
  };

  const handleToggleOwnerMode = async () => {
    const result = await toggleOwnerVisibility();
    if (result.success) {
      useAuthStore.getState().updateUser({ ownerModeVisible: result.visible });
      toast.success(`Owner mode ${result.visible ? 'ON' : 'OFF'}`);
    }
  };

  const tabs = [
    { id: 'chats', icon: MessageCircle, label: 'Chats' },
    { id: 'groups', icon: Hash, label: 'Groups' },
    { id: 'channels', icon: Radio, label: 'Channels' },
    { id: 'users', icon: Users, label: 'Users' },
    { id: 'transfer', icon: HardDrive, label: 'Transfer' },
  ];

  return (
    <div className="w-full bg-dark-800 border-r border-dark-700 flex flex-col h-full safe-top">
      {/* Header */}
      <div className="p-4 border-b border-dark-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {user?.avatar ? (
              <img
                src={`${SERVER_URL}${user.avatar}`}
                alt={user?.username}
                className="w-11 h-11 rounded-full object-cover shadow-lg"
              />
            ) : (
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-lg"
                style={{ backgroundColor: stringToColor(user?.username) }}
              >
                {getInitials(user?.username)}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-white">{user?.username}</p>
              <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                Online
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {isOwner && (
              <>
                <button
                  onClick={() => navigate('/owner')}
                  className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-all active:scale-90"
                  title="Owner Dashboard"
                >
                  <Shield size={16} />
                </button>
                <button
                  onClick={handleToggleOwnerMode}
                  className={`p-1.5 rounded-lg transition-all active:scale-90 ${
                    ownerModeVisible
                      ? 'text-amber-400 bg-amber-500/10'
                      : 'text-dark-400 hover:text-dark-200'
                  }`}
                  title={ownerModeVisible ? 'Owner Mode ON — click to hide' : 'Owner Mode OFF — click to show'}
                >
                  {ownerModeVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-lg text-dark-400 hover:text-primary-400 hover:bg-primary-500/10 transition-all active:scale-90"
              title="Settings"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-90"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users, chats, groups..."
            className="input-field pl-10 py-2.5 text-sm bg-dark-900/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200 p-1"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-700 bg-dark-800/50">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === 'transfer') {
                navigate('/transfer');
                return;
              }
              setActiveTab(tab.id);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-xs font-medium transition-all relative
              ${activeTab === tab.id
                ? 'text-primary-400'
                : 'text-dark-400 hover:text-dark-200 active:text-dark-100'
              }`}
          >
            <tab.icon size={16} />
            <span className="hidden xs:inline">{tab.label}</span>
            {/* Active indicator */}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {searchQuery.trim() ? (
          /* Unified search results — replaces tabs when searching */
          <SearchResults searchQuery={searchQuery} onSelect={() => setSearchQuery('')} />
        ) : (
          <>
            {activeTab === 'chats' && (
              <ChatList searchQuery="" />
            )}

            {activeTab === 'groups' && (
              <>
                <div className="p-3">
                  <button
                    onClick={() => setShowCreateGroup(true)}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm"
                  >
                    <Plus size={16} />
                    Create Group
                  </button>
                </div>
                <GroupList searchQuery="" />
              </>
            )}

            {activeTab === 'channels' && (
              <>
                <div className="p-3 space-y-2">
                  <button
                    onClick={() => setShowCreateChannel(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors"
                  >
                    <Plus size={16} />
                    Create Channel
                  </button>
                  <button
                    onClick={() => setShowDiscoverChannels(true)}
                    className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5 text-sm"
                  >
                    <Search size={16} />
                    Discover Channels
                  </button>
                </div>
                <ChannelList searchQuery="" />
              </>
            )}

            {activeTab === 'users' && (
              <ActiveUsers searchQuery="" />
            )}
          </>
        )}
      </div>

      {/* Create Group Modal */}
      {showCreateGroup && (
        <CreateGroup onClose={() => setShowCreateGroup(false)} />
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <CreateChannel onClose={() => setShowCreateChannel(false)} />
      )}

      {/* Discover Channels Modal */}
      {showDiscoverChannels && (
        <ChannelDiscover onClose={() => setShowDiscoverChannels(false)} />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <UserSettings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
};

export default Sidebar;
