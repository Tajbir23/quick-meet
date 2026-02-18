/**
 * ============================================
 * ChannelDiscover — Discover Public Channels
 * ============================================
 */

import { useState, useEffect } from 'react';
import { X, Search, Radio, Users, Globe, Plus, Loader2, ExternalLink } from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useChatStore from '../../store/useChatStore';
import toast from 'react-hot-toast';

const ChannelDiscover = ({ onClose }) => {
  const discoverChannels = useChannelStore(s => s.discoverChannels);
  const fetchDiscoverChannels = useChannelStore(s => s.fetchDiscoverChannels);
  const subscribeChannel = useChannelStore(s => s.subscribeChannel);
  const joinViaInviteLink = useChannelStore(s => s.joinViaInviteLink);
  const myChannels = useChannelStore(s => s.myChannels);

  const [search, setSearch] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('discover'); // discover | invite

  useEffect(() => {
    fetchDiscoverChannels();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDiscoverChannels(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSubscribe = async (channelId) => {
    setLoading(true);
    try {
      const result = await subscribeChannel(channelId);
      if (result?.success !== false) {
        toast.success('Subscribed!');
      } else {
        toast.error(result?.message || 'Failed to subscribe');
      }
    } catch (err) {
      toast.error('Failed to subscribe');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinViaInvite = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    try {
      // Extract code from full URL if pasted
      let code = inviteCode.trim();
      const match = code.match(/join\/([a-zA-Z0-9]+)$/);
      if (match) code = match[1];

      const result = await joinViaInviteLink(code);
      if (result?.success !== false) {
        toast.success(result?.message || 'Joined!');
        setInviteCode('');
      } else {
        toast.error(result?.message || 'Invalid invite link');
      }
    } catch (err) {
      toast.error('Failed to join');
    } finally {
      setLoading(false);
    }
  };

  const isSubscribed = (channelId) => {
    return myChannels.some(ch => ch._id === channelId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 rounded-2xl border border-dark-700 w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-dark-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Globe size={20} className="text-indigo-400" />
              Discover Channels
            </h2>
            <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
              <X size={20} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setActiveTab('discover')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'discover' ? 'bg-indigo-500 text-white' : 'bg-dark-700 text-dark-400 hover:text-dark-200'
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('invite')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'invite' ? 'bg-indigo-500 text-white' : 'bg-dark-700 text-dark-400 hover:text-dark-200'
              }`}
            >
              Join via Invite
            </button>
          </div>

          {activeTab === 'discover' && (
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search public channels..."
                className="input-field w-full pl-10 py-2.5 text-sm"
              />
            </div>
          )}

          {activeTab === 'invite' && (
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Paste invite link or code..."
                className="input-field flex-1 py-2.5 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleJoinViaInvite()}
              />
              <button
                onClick={handleJoinViaInvite}
                disabled={!inviteCode.trim() || loading}
                className="btn-primary px-4 flex items-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                Join
              </button>
            </div>
          )}
        </div>

        {/* Channel list */}
        {activeTab === 'discover' && (
          <div className="flex-1 overflow-y-auto">
            {discoverChannels.length === 0 ? (
              <div className="p-8 text-center">
                <Radio size={32} className="mx-auto text-dark-600 mb-3" />
                <p className="text-dark-400 text-sm">
                  {search ? 'No channels found' : 'No public channels available'}
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {discoverChannels.map(channel => {
                  const subscribed = isSubscribed(channel._id);
                  return (
                    <div
                      key={channel._id}
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-dark-700/50 transition-colors"
                    >
                      <div className="w-11 h-11 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                        <Radio size={20} className="text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-white truncate">{channel.name}</p>
                          {channel.username && (
                            <span className="text-[10px] text-dark-500">@{channel.username}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-dark-400 flex items-center gap-1">
                            <Users size={11} />
                            {channel.stats?.subscriberCount || channel.members?.length || 0}
                          </span>
                        </div>
                        {channel.description && (
                          <p className="text-xs text-dark-500 truncate mt-0.5">{channel.description}</p>
                        )}
                      </div>
                      {subscribed ? (
                        <span className="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full">
                          Joined
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSubscribe(channel._id)}
                          disabled={loading}
                          className="bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full hover:bg-indigo-600 transition-colors"
                        >
                          Subscribe
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelDiscover;
