/**
 * ============================================
 * ChannelList — Sidebar list of user's channels
 * ============================================
 */

import { Radio, Users, Eye, Volume2, VolumeX, Zap } from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useChatStore from '../../store/useChatStore';
import { truncate } from '../../utils/helpers';

const ChannelList = ({ searchQuery = '' }) => {
  const { myChannels } = useChannelStore();
  const { setActiveChat, activeChat } = useChatStore();

  const filtered = myChannels.filter(ch =>
    ch.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectChannel = (channel) => {
    setActiveChat({
      id: channel._id,
      type: 'channel',
      name: channel.name,
      username: channel.username,
      subscriberCount: channel.subscriberCount || channel.members?.length || 0,
      channelType: channel.type,
      isLive: channel.liveStream?.isLive,
    });
    useChannelStore.getState().setActiveChannel(channel);
  };

  if (filtered.length === 0) {
    return (
      <div className="p-8 text-center">
        <Radio size={32} className="mx-auto text-dark-600 mb-3" />
        <p className="text-dark-400 text-sm font-medium">
          {searchQuery ? 'No channels found' : 'No channels yet'}
        </p>
        <p className="text-dark-500 text-xs mt-1">
          {searchQuery ? 'Try a different search' : 'Create or subscribe to a channel'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {filtered.map(channel => {
        const isActive = activeChat?.id === channel._id;
        const subscriberCount = channel.subscriberCount || channel.members?.filter(m => !m.isBanned)?.length || 0;
        const myMember = channel.members?.find(m => {
          const uid = m.user?._id || m.user;
          return uid === channel.owner?._id || uid === channel.owner;
        });
        const isLive = channel.liveStream?.isLive;
        const isMuted = channel.members?.find(m => {
          const uid = m.user?._id || m.user;
          return uid; // Approximate — actual mute check needs current user id
        })?.isMuted;

        return (
          <button
            key={channel._id}
            onClick={() => handleSelectChannel(channel)}
            className={`sidebar-item w-full text-left ${isActive ? 'bg-dark-700' : ''}`}
          >
            <div className="flex items-center gap-3 w-full">
              {/* Channel avatar */}
              <div className="relative w-11 h-11 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <Radio size={20} className="text-indigo-400" />
                {isLive && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center border-2 border-dark-800 animate-pulse">
                    <Zap size={8} className="text-white" />
                  </span>
                )}
              </div>

              {/* Channel info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {channel.name}
                    </p>
                    {channel.type === 'private' && (
                      <span className="text-[9px] bg-dark-600 text-dark-300 px-1.5 py-0.5 rounded-full">
                        Private
                      </span>
                    )}
                  </div>
                  {isLive && (
                    <span className="ml-2 bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5 flex-shrink-0 animate-pulse">
                      LIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex items-center gap-1">
                    <Eye size={11} className="text-dark-500" />
                    <p className="text-xs text-dark-400">
                      {subscriberCount} subscribers
                    </p>
                  </div>
                </div>
                {channel.description && (
                  <p className="text-xs text-dark-500 truncate mt-0.5">
                    {truncate(channel.description, 40)}
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

export default ChannelList;
