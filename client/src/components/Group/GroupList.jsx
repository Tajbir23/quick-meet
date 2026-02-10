/**
 * ============================================
 * GroupList — Sidebar list of user's groups
 * ============================================
 */

import { Hash, Users, Phone } from 'lucide-react';
import useGroupStore from '../../store/useGroupStore';
import useChatStore from '../../store/useChatStore';
import { truncate } from '../../utils/helpers';

const GroupList = ({ searchQuery = '' }) => {
  const { myGroups, activeGroupCalls } = useGroupStore();
  const { setActiveChat, activeChat, unread } = useChatStore();

  const filteredGroups = myGroups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectGroup = (group) => {
    setActiveChat({
      id: group._id,
      type: 'group',
      name: group.name,
      memberCount: group.members?.length || 0,
    });
  };

  if (filteredGroups.length === 0) {
    return (
      <div className="p-8 text-center">
        <Hash size={32} className="mx-auto text-dark-600 mb-3" />
        <p className="text-dark-400 text-sm font-medium">
          {searchQuery ? 'No groups found' : 'No groups yet'}
        </p>
        <p className="text-dark-500 text-xs mt-1">
          {searchQuery ? 'Try a different search' : 'Create or join a group to get started'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {filteredGroups.map(group => {
        const isActive = activeChat?.id === group._id;
        const unreadCount = unread[group._id] || 0;

        return (
          <button
            key={group._id}
            onClick={() => handleSelectGroup(group)}
            className={`sidebar-item w-full text-left ${isActive ? 'bg-dark-700' : ''}`}
          >
            <div className="flex items-center gap-3 w-full">
              {/* Group avatar */}
              <div className="relative w-11 h-11 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                <Hash size={20} className="text-primary-400" />
                {activeGroupCalls[group._id] && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-dark-800">
                    <Phone size={8} className="text-white" />
                  </span>
                )}
              </div>

              {/* Group info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white truncate">
                    {group.name}
                  </p>
                  {unreadCount > 0 && (
                    <span className="ml-2 bg-primary-500 text-white text-xs rounded-full px-2 py-0.5 flex-shrink-0 animate-scale-in">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Users size={12} className="text-dark-500" />
                  <p className="text-xs text-dark-400">
                    {group.members?.length || 0} members
                  </p>
                </div>
                {group.description && (
                  <p className="text-xs text-dark-500 truncate mt-0.5">
                    {truncate(group.description, 40)}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default GroupList;
