/**
 * ============================================
 * ChannelStats — Statistics Dashboard
 * ============================================
 */

import { useEffect } from 'react';
import { Users, Eye, MessageCircle, TrendingUp, BarChart3, Calendar } from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';

const StatCard = ({ icon: Icon, label, value, color, subtext }) => (
  <div className="bg-dark-700/50 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon size={16} className={color} />
      <span className="text-xs text-dark-400">{label}</span>
    </div>
    <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
    {subtext && <p className="text-[10px] text-dark-500 mt-1">{subtext}</p>}
  </div>
);

const ChannelStats = ({ channelId }) => {
  const channelStats = useChannelStore(s => s.channelStats);
  const fetchChannelStats = useChannelStore(s => s.fetchChannelStats);

  useEffect(() => {
    if (channelId) {
      fetchChannelStats(channelId);
    }
  }, [channelId]);

  if (!channelStats) {
    return (
      <div className="p-6 text-center">
        <BarChart3 size={32} className="mx-auto text-dark-600 mb-3 animate-pulse" />
        <p className="text-dark-400 text-sm">Loading statistics...</p>
      </div>
    );
  }

  const stats = channelStats;

  return (
    <div className="p-4 space-y-6">
      {/* Overview grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Users}
          label="Subscribers"
          value={stats.subscriberCount ?? stats.totalMembers ?? 0}
          color="text-indigo-400"
        />
        <StatCard
          icon={MessageCircle}
          label="Total Posts"
          value={stats.totalPosts ?? 0}
          color="text-blue-400"
        />
        <StatCard
          icon={Eye}
          label="Avg. Views"
          value={stats.averageViews ?? stats.avgViewsPerPost ?? '—'}
          color="text-emerald-400"
        />
        <StatCard
          icon={TrendingUp}
          label="Growth Rate"
          value={stats.growthRate ? `${stats.growthRate}%` : '—'}
          color="text-purple-400"
          subtext="Last 30 days"
        />
      </div>

      {/* Detailed stats */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Engagement</h4>
        <div className="bg-dark-700/30 rounded-xl divide-y divide-dark-700/50">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-dark-300">Total reactions</span>
            <span className="text-sm font-medium text-white">{stats.totalReactions ?? 0}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-dark-300">Total comments</span>
            <span className="text-sm font-medium text-white">{stats.totalComments ?? 0}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-dark-300">Pinned posts</span>
            <span className="text-sm font-medium text-white">{stats.pinnedPosts ?? 0}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-dark-300">Admins</span>
            <span className="text-sm font-medium text-white">{stats.adminCount ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Channel age */}
      {stats.createdAt && (
        <div className="flex items-center gap-2 text-xs text-dark-500">
          <Calendar size={12} />
          <span>Created {new Date(stats.createdAt).toLocaleDateString()}</span>
        </div>
      )}
    </div>
  );
};

export default ChannelStats;
