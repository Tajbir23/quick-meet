import { useState } from 'react';
import {
  MessageCircle, Users, Search, LogOut, Plus, Settings, Hash
} from 'lucide-react';
import useAuthStore from '../../store/useAuthStore';
import useChatStore from '../../store/useChatStore';
import useGroupStore from '../../store/useGroupStore';
import ActiveUsers from '../Users/ActiveUsers';
import ChatList from '../Chat/ChatList';
import GroupList from '../Group/GroupList';
import CreateGroup from '../Group/CreateGroup';
import { getInitials, stringToColor } from '../../utils/helpers';

const Sidebar = () => {
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'groups' | 'users'
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const { user, logout } = useAuthStore();
  const { users } = useChatStore();
  const { myGroups } = useGroupStore();

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      logout();
    }
  };

  const tabs = [
    { id: 'chats', icon: MessageCircle, label: 'Chats' },
    { id: 'groups', icon: Hash, label: 'Groups' },
    { id: 'users', icon: Users, label: 'Users' },
  ];

  return (
    <div className="w-80 bg-dark-800 border-r border-dark-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-dark-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: stringToColor(user?.username) }}
            >
              {getInitials(user?.username)}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{user?.username}</p>
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                Online
              </p>
            </div>
          </div>
          <button onClick={handleLogout} className="btn-icon text-dark-400 hover:text-red-400">
            <LogOut size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="input-field pl-9 py-2 text-sm"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-700">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors
              ${activeTab === tab.id
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-dark-400 hover:text-dark-200'
              }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'chats' && (
          <ChatList searchQuery={searchQuery} />
        )}

        {activeTab === 'groups' && (
          <>
            <div className="p-3">
              <button
                onClick={() => setShowCreateGroup(true)}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2 text-sm"
              >
                <Plus size={16} />
                Create Group
              </button>
            </div>
            <GroupList searchQuery={searchQuery} />
          </>
        )}

        {activeTab === 'users' && (
          <ActiveUsers searchQuery={searchQuery} />
        )}
      </div>

      {/* Create Group Modal */}
      {showCreateGroup && (
        <CreateGroup onClose={() => setShowCreateGroup(false)} />
      )}
    </div>
  );
};

export default Sidebar;
