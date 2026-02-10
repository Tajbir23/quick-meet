/**
 * ============================================
 * Owner Dashboard — Admin Control Panel
 * ============================================
 * 
 * Tabs:
 * 1. Overview — System status, quick stats
 * 2. Security Alerts — Hacking attempts, CRITICAL/ALERT events
 * 3. Users — All users, block/unblock
 * 4. Files — All uploaded files, delete/download
 * 5. Logs — Full security log viewer
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, Users, FileText, AlertTriangle, Activity,
  ArrowLeft, Download, Trash2, Ban, CheckCircle,
  Search, RefreshCw, Eye, EyeOff, Clock, Server,
  HardDrive, Cpu, ChevronDown, ChevronUp, X,
  Lock, Unlock, Calendar, Filter, Terminal, Pause, Play
} from 'lucide-react';
import useOwnerStore from '../store/useOwnerStore';
import useAuthStore from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

// ─── Tab Navigation ─────────────────────────────────────
const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'logs', label: 'Logs', icon: Shield },
];

const OwnerDashboard = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Redirect non-owners
  useEffect(() => {
    if (user && user.role !== 'owner') {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  if (!user || user.role !== 'owner') return null;

  return (
    <div className="h-full flex flex-col bg-dark-900 overflow-hidden">
      {/* Header */}
      <div className="h-14 bg-dark-800 border-b border-dark-700 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="btn-icon text-dark-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-amber-400" />
            <h1 className="text-lg font-bold text-white">Owner Dashboard</h1>
          </div>
        </div>
        <OwnerModeToggle />
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-dark-700 bg-dark-800/50 overflow-x-auto flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-medium transition-all relative whitespace-nowrap
              ${activeTab === tab.id
                ? 'text-amber-400'
                : 'text-dark-400 hover:text-dark-200'
              }`}
          >
            <tab.icon size={15} />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-amber-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'alerts' && <AlertsTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'files' && <FilesTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
};

// ─── Owner Mode Toggle ─────────────────────────────────
const OwnerModeToggle = () => {
  const { ownerModeVisible, toggleOwnerVisibility } = useOwnerStore();
  const { user, updateUser } = useAuthStore();

  useEffect(() => {
    if (user?.ownerModeVisible !== undefined) {
      useOwnerStore.getState().setOwnerModeVisible(user.ownerModeVisible);
    }
  }, [user?.ownerModeVisible]);

  const handleToggle = async () => {
    const result = await toggleOwnerVisibility();
    if (result.success) {
      updateUser({ ownerModeVisible: result.visible });
      toast.success(`Owner mode ${result.visible ? 'ON — users can see you are the owner' : 'OFF — you appear as a regular user'}`);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <button
      onClick={handleToggle}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
        ${ownerModeVisible
          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          : 'bg-dark-700 text-dark-400 border border-dark-600 hover:text-dark-200'
        }`}
    >
      {ownerModeVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      Owner Mode {ownerModeVisible ? 'ON' : 'OFF'}
    </button>
  );
};

// ─── Overview Tab ───────────────────────────────────────
const OverviewTab = () => {
  const { systemStatus, statusLoading, fetchSystemStatus, alerts, fetchAlerts } = useOwnerStore();

  useEffect(() => {
    fetchSystemStatus();
    fetchAlerts(1); // Last 24h alerts
  }, []);

  if (statusLoading || !systemStatus) {
    return <LoadingSpinner text="Loading system status..." />;
  }

  const { users, files, server, ids } = systemStatus;
  const recentAlerts = alerts.slice(0, 5);

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Total Users" value={users.total} color="text-blue-400" bg="bg-blue-500/10" />
        <StatCard icon={Activity} label="Online Now" value={users.online} color="text-emerald-400" bg="bg-emerald-500/10" />
        <StatCard icon={Ban} label="Blocked" value={users.blocked} color="text-red-400" bg="bg-red-500/10" />
        <StatCard icon={FileText} label="Files" value={files.total} color="text-purple-400" bg="bg-purple-500/10" />
      </div>

      {/* Server Info */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Server size={16} className="text-amber-400" />
          Server Status
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-dark-500">Uptime</p>
            <p className="text-white font-medium">{server.uptimeFormatted}</p>
          </div>
          <div>
            <p className="text-dark-500">Node.js</p>
            <p className="text-white font-medium">{server.nodeVersion}</p>
          </div>
          <div>
            <p className="text-dark-500">Memory (RSS)</p>
            <p className="text-white font-medium">{formatBytes(server.memory.rss)}</p>
          </div>
          <div>
            <p className="text-dark-500">Heap Used</p>
            <p className="text-white font-medium">{formatBytes(server.memory.heapUsed)}</p>
          </div>
        </div>
      </div>

      {/* IDS Status */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Shield size={16} className="text-amber-400" />
          Intrusion Detection
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-dark-500">Banned IPs</p>
            <p className="text-white font-medium">{ids?.bannedIPs || 0}</p>
          </div>
          <div>
            <p className="text-dark-500">Tracked IPs</p>
            <p className="text-white font-medium">{ids?.trackedIPs || 0}</p>
          </div>
          <div>
            <p className="text-dark-500">Active Sessions</p>
            <p className="text-white font-medium">{ids?.activeSessions || 0}</p>
          </div>
        </div>
      </div>

      {/* Recent Alerts */}
      {recentAlerts.length > 0 && (
        <div className="bg-dark-800 border border-red-500/20 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-400" />
            Recent Alerts (24h)
          </h3>
          <div className="space-y-2">
            {recentAlerts.map((alert, i) => (
              <AlertEntry key={i} alert={alert} compact />
            ))}
          </div>
        </div>
      )}

      {/* Refresh */}
      <button
        onClick={fetchSystemStatus}
        className="flex items-center gap-2 text-xs text-dark-400 hover:text-white transition-colors"
      >
        <RefreshCw size={12} />
        Refresh
      </button>
    </div>
  );
};

// ─── Alerts Tab ─────────────────────────────────────────
const AlertsTab = () => {
  const { alerts, alertsTotal, alertsLoading, fetchAlerts } = useOwnerStore();
  const [days, setDays] = useState(7);

  useEffect(() => {
    fetchAlerts(days);
  }, [days]);

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-400" />
          Security Alerts — Hacking Attempts
          <span className="text-xs text-dark-400">({alertsTotal} total)</span>
        </h2>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-xs text-white"
        >
          <option value={1}>Last 24h</option>
          <option value={3}>Last 3 days</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {alertsLoading ? (
        <LoadingSpinner text="Loading alerts..." />
      ) : alerts.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle size={40} className="mx-auto text-emerald-400 mb-3" />
          <p className="text-dark-400 text-sm">No security alerts in the last {days} days</p>
          <p className="text-dark-500 text-xs mt-1">Your system is secure ✓</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <AlertEntry key={i} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Users Tab ──────────────────────────────────────────
const UsersTab = () => {
  const { allUsers, usersLoading, fetchAllUsers, blockUser, unblockUser } = useOwnerStore();
  const [search, setSearch] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockingUserId, setBlockingUserId] = useState(null);
  const { user: currentUser } = useAuthStore();

  useEffect(() => {
    fetchAllUsers();
  }, []);

  const filteredUsers = allUsers.filter(u =>
    u.username?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleBlock = async (userId) => {
    if (!blockReason.trim()) {
      toast.error('Please provide a reason for blocking');
      return;
    }
    const result = await blockUser(userId, blockReason);
    if (result.success) {
      toast.success(result.message);
      setBlockingUserId(null);
      setBlockReason('');
    } else {
      toast.error(result.message);
    }
  };

  const handleUnblock = async (userId) => {
    const result = await unblockUser(userId);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Users size={16} className="text-blue-400" />
          All Users
          <span className="text-xs text-dark-400">({allUsers.length})</span>
        </h2>
        <button onClick={fetchAllUsers} className="btn-icon text-dark-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search users..."
          className="input-field pl-9 py-2 text-xs bg-dark-800"
        />
      </div>

      {usersLoading ? (
        <LoadingSpinner text="Loading users..." />
      ) : (
        <div className="space-y-2">
          {filteredUsers.map(u => (
            <div key={u._id} className="bg-dark-800 border border-dark-700 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Status dot */}
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${u.isOnline ? 'bg-emerald-400' : 'bg-dark-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{u.username}</p>
                      {u.role === 'owner' && (
                        <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] rounded-full font-medium">
                          OWNER
                        </span>
                      )}
                      {u.isBlocked && (
                        <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full font-medium">
                          BLOCKED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-dark-500 truncate">{u.email}</p>
                    <p className="text-[10px] text-dark-600">
                      Joined {new Date(u.createdAt).toLocaleDateString()} · Last seen {new Date(u.lastSeen).toLocaleString()}
                    </p>
                    {u.isBlocked && u.blockedReason && (
                      <p className="text-[10px] text-red-400 mt-1">Reason: {u.blockedReason}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {u._id !== currentUser._id && u.role !== 'owner' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {u.isBlocked ? (
                      <button
                        onClick={() => handleUnblock(u._id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-lg hover:bg-emerald-500/20 transition-colors"
                      >
                        <Unlock size={12} />
                        Unblock
                      </button>
                    ) : blockingUserId === u._id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={blockReason}
                          onChange={e => setBlockReason(e.target.value)}
                          placeholder="Reason..."
                          className="bg-dark-900 border border-dark-600 rounded-lg px-2 py-1 text-xs text-white w-32"
                          autoFocus
                        />
                        <button
                          onClick={() => handleBlock(u._id)}
                          className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-lg hover:bg-red-500/30"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => { setBlockingUserId(null); setBlockReason(''); }}
                          className="text-dark-400 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setBlockingUserId(u._id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 text-red-400 text-xs rounded-lg hover:bg-red-500/20 transition-colors"
                      >
                        <Ban size={12} />
                        Block
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Files Tab ──────────────────────────────────────────
const FilesTab = () => {
  const { allFiles, filesTotal, filesLoading, fetchAllFiles, deleteFile, downloadFile } = useOwnerStore();
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    fetchAllFiles();
  }, []);

  const filteredFiles = allFiles.filter(f =>
    f.originalName?.toLowerCase().includes(search.toLowerCase()) ||
    f.storedName?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (filename) => {
    const result = await deleteFile(filename);
    if (result.success) {
      toast.success('File deleted');
      setConfirmDelete(null);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText size={16} className="text-purple-400" />
          All Files
          <span className="text-xs text-dark-400">({filesTotal})</span>
        </h2>
        <button onClick={fetchAllFiles} className="btn-icon text-dark-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search files..."
          className="input-field pl-9 py-2 text-xs bg-dark-800"
        />
      </div>

      {filesLoading ? (
        <LoadingSpinner text="Loading files..." />
      ) : filteredFiles.length === 0 ? (
        <div className="text-center py-12">
          <FileText size={40} className="mx-auto text-dark-600 mb-3" />
          <p className="text-dark-400 text-sm">No files found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredFiles.map((f, i) => (
            <div key={i} className="bg-dark-800 border border-dark-700 rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{f.originalName}</p>
                  <p className="text-[10px] text-dark-500 truncate">Stored: {f.storedName}</p>
                  <div className="flex items-center gap-3 text-[10px] text-dark-500 mt-1">
                    <span>{formatBytes(f.size)}</span>
                    <span>{new Date(f.created).toLocaleString()}</span>
                    {f.uploadedBy && <span>by {f.uploadedBy.username}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => downloadFile(f.storedName, f.originalName)}
                    className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  {confirmDelete === f.storedName ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(f.storedName)}
                        className="px-2 py-1 bg-red-500/20 text-red-400 text-[10px] rounded-lg hover:bg-red-500/30"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-dark-400 hover:text-white"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(f.storedName)}
                      className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Logs Tab — Terminal-Style Viewer ───────────────────
const LogsTab = () => {
  const { logEntries, logTotal, logsLoading, fetchRecentLogs } = useOwnerStore();
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [limit, setLimit] = useState(300);
  const terminalRef = useRef(null);
  const searchInputRef = useRef(null);
  const autoRefreshRef = useRef(null);

  // Fetch logs
  const loadLogs = useCallback(() => {
    fetchRecentLogs({ limit, severity, category, search: search.trim() || undefined });
  }, [limit, severity, category, search, fetchRecentLogs]);

  useEffect(() => {
    loadLogs();
  }, [severity, category, limit]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(loadLogs, 5000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, loadLogs]);

  // Auto-scroll to top (newest) on new data
  useEffect(() => {
    if (terminalRef.current && autoRefresh) {
      terminalRef.current.scrollTop = 0;
    }
  }, [logEntries, autoRefresh]);

  // Keyboard shortcut: Ctrl+F focuses search, Enter triggers search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = () => {
    loadLogs();
  };

  // Severity color map for terminal
  const getSeverityColor = (sev) => {
    switch (sev) {
      case 'CRITICAL': return 'text-red-400';
      case 'ALERT': return 'text-amber-400';
      case 'WARN': return 'text-yellow-300';
      case 'INFO': return 'text-green-400';
      default: return 'text-gray-400';
    }
  };

  const getSeverityBg = (sev) => {
    switch (sev) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-300';
      case 'ALERT': return 'bg-amber-500/20 text-amber-300';
      case 'WARN': return 'bg-yellow-500/15 text-yellow-300';
      case 'INFO': return 'bg-green-500/15 text-green-300';
      default: return 'bg-gray-500/15 text-gray-400';
    }
  };

  const getCategoryColor = (cat) => {
    switch (cat) {
      case 'AUTH': return 'text-cyan-400';
      case 'INTRUSION': return 'text-red-300';
      case 'SOCKET': return 'text-blue-400';
      case 'CALL': return 'text-purple-400';
      case 'FILE': return 'text-teal-400';
      case 'SESSION': return 'text-indigo-400';
      case 'SYSTEM': return 'text-amber-300';
      default: return 'text-gray-400';
    }
  };

  // Format timestamp for terminal display
  const formatTerminalTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString([], {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  };

  // Highlight search term in text
  const highlightText = (text, query) => {
    if (!query || !text) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = String(text).split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} className="bg-amber-400/30 text-amber-200 rounded px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-7.5rem)]">
      {/* Terminal Header Bar */}
      <div className="bg-[#1a1a2e] border-b border-[#2a2a4a] px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-green-400" />
            <h2 className="text-sm font-bold text-green-400 font-mono tracking-wide">
              SECURITY LOGS
            </h2>
            <span className="text-[10px] text-gray-500 font-mono">
              [{logTotal} entries]
            </span>
            {logsLoading && (
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono transition-all ${
                autoRefresh
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-[#2a2a4a] text-gray-500 border border-[#3a3a5a] hover:text-gray-300'
              }`}
              title={autoRefresh ? 'Pause auto-refresh' : 'Start auto-refresh (5s)'}
            >
              {autoRefresh ? <Pause size={10} /> : <Play size={10} />}
              {autoRefresh ? 'LIVE' : 'AUTO'}
            </button>
            {/* Manual refresh */}
            <button
              onClick={loadLogs}
              disabled={logsLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono bg-[#2a2a4a] text-gray-400 border border-[#3a3a5a] hover:text-white transition-all disabled:opacity-50"
            >
              <RefreshCw size={10} className={logsLoading ? 'animate-spin' : ''} />
              REFRESH
            </button>
            {/* Limit selector */}
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="bg-[#2a2a4a] border border-[#3a3a5a] rounded-md px-2 py-1 text-[10px] text-gray-400 font-mono"
            >
              <option value={100}>100</option>
              <option value={300}>300</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search logs... (Ctrl+F)"
              className="w-full bg-[#0d0d1a] border border-[#2a2a4a] rounded-md pl-8 pr-8 py-1.5 text-xs text-green-300 font-mono placeholder-gray-600 focus:border-green-500/50 focus:outline-none focus:ring-1 focus:ring-green-500/20 transition-all"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setTimeout(loadLogs, 0); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {/* Severity filter */}
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value)}
            className="bg-[#0d0d1a] border border-[#2a2a4a] rounded-md px-2.5 py-1.5 text-[11px] text-gray-400 font-mono focus:border-green-500/50 focus:outline-none"
          >
            <option value="">ALL SEVERITY</option>
            <option value="INFO">● INFO</option>
            <option value="WARN">● WARN</option>
            <option value="ALERT">● ALERT</option>
            <option value="CRITICAL">● CRITICAL</option>
          </select>
          {/* Category filter */}
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="bg-[#0d0d1a] border border-[#2a2a4a] rounded-md px-2.5 py-1.5 text-[11px] text-gray-400 font-mono focus:border-green-500/50 focus:outline-none"
          >
            <option value="">ALL CATEGORY</option>
            <option value="AUTH">AUTH</option>
            <option value="SESSION">SESSION</option>
            <option value="SOCKET">SOCKET</option>
            <option value="CALL">CALL</option>
            <option value="FILE">FILE</option>
            <option value="INTRUSION">INTRUSION</option>
            <option value="SYSTEM">SYSTEM</option>
          </select>
          {/* Search button */}
          <button
            onClick={handleSearch}
            className="px-3 py-1.5 bg-green-500/15 text-green-400 text-[11px] font-mono rounded-md border border-green-500/30 hover:bg-green-500/25 transition-all"
          >
            SEARCH
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto bg-[#0a0a14] font-mono text-[11px] leading-[1.7] selection:bg-green-500/30"
        style={{ scrollBehavior: 'smooth' }}
      >
        {logsLoading && logEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="inline-block w-5 h-5 border-2 border-green-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-green-500/60 text-xs font-mono">Loading logs...</p>
            </div>
          </div>
        ) : logEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Terminal size={32} className="mx-auto text-gray-700 mb-3" />
              <p className="text-gray-600 text-xs font-mono">No matching log entries</p>
              <p className="text-gray-700 text-[10px] font-mono mt-1">Try adjusting your filters</p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {/* Terminal top line */}
            <div className="px-3 py-1 text-gray-600 border-b border-[#1a1a2e] select-none">
              ═══ Showing {logEntries.length} of {logTotal} entries {severity && `│ severity=${severity}`} {category && `│ category=${category}`} {search && `│ search="${search}"`} ═══
            </div>

            {logEntries.map((entry, i) => (
              <div key={entry.id || i}>
                <div
                  className={`px-3 py-[3px] flex items-start gap-0 cursor-pointer transition-colors hover:bg-[#12122a] border-l-2 ${
                    entry.severity === 'CRITICAL' ? 'border-l-red-500/60 bg-red-500/[0.03]'
                    : entry.severity === 'ALERT' ? 'border-l-amber-500/50 bg-amber-500/[0.02]'
                    : entry.severity === 'WARN' ? 'border-l-yellow-500/30'
                    : 'border-l-transparent'
                  }`}
                  onClick={() => setExpandedId(expandedId === (entry.id || i) ? null : (entry.id || i))}
                >
                  {/* Line number */}
                  <span className="text-gray-700 w-8 flex-shrink-0 text-right mr-3 select-none">
                    {i + 1}
                  </span>
                  {/* Timestamp */}
                  <span className="text-gray-500 flex-shrink-0 mr-2">
                    {formatTerminalTime(entry.timestamp)}
                  </span>
                  {/* Severity badge */}
                  <span className={`${getSeverityBg(entry.severity)} px-1.5 rounded text-[10px] font-bold flex-shrink-0 mr-2 inline-block min-w-[58px] text-center`}>
                    {entry.severity}
                  </span>
                  {/* Category */}
                  <span className={`${getCategoryColor(entry.category)} flex-shrink-0 mr-2 min-w-[70px]`}>
                    [{entry.category}]
                  </span>
                  {/* Event */}
                  <span className="text-gray-300 mr-2 flex-shrink-0">
                    {highlightText(entry.event, search)}
                  </span>
                  {/* Brief data preview */}
                  <span className="text-gray-600 truncate flex-1">
                    {entry.data?.message
                      ? `— ${highlightText(String(entry.data.message), search)}`
                      : entry.data?.ip
                        ? `— ip:${entry.data.ip}`
                        : entry.data?.userId
                          ? `— user:${entry.data.userId}`
                          : ''
                    }
                  </span>
                  {/* Expand indicator */}
                  {entry.data && Object.keys(entry.data).length > 0 && (
                    <span className="text-gray-700 flex-shrink-0 ml-1">
                      {expandedId === (entry.id || i) ? '▼' : '▶'}
                    </span>
                  )}
                </div>

                {/* Expanded data panel */}
                {expandedId === (entry.id || i) && entry.data && (
                  <div className="ml-11 mr-3 mb-1 bg-[#0d0d20] border border-[#1a1a3a] rounded-md overflow-hidden">
                    <div className="px-3 py-1.5 bg-[#12122a] text-gray-500 text-[10px] flex items-center justify-between border-b border-[#1a1a3a]">
                      <span>Event Data</span>
                      <span className="text-gray-700">{entry.chainHash ? `chain:${entry.chainHash.substring(0, 12)}...` : ''}</span>
                    </div>
                    <pre className="px-3 py-2 text-[10px] overflow-x-auto whitespace-pre-wrap">
                      {Object.entries(entry.data).map(([key, value]) => (
                        <div key={key} className="flex">
                          <span className="text-cyan-500 mr-2 flex-shrink-0">{key}:</span>
                          <span className={
                            key === 'ip' ? 'text-amber-300'
                            : key === 'userId' || key === 'username' ? 'text-blue-300'
                            : typeof value === 'boolean' ? (value ? 'text-green-400' : 'text-red-400')
                            : typeof value === 'number' ? 'text-purple-300'
                            : 'text-gray-400'
                          }>
                            {highlightText(typeof value === 'object' ? JSON.stringify(value) : String(value), search)}
                          </span>
                        </div>
                      ))}
                    </pre>
                  </div>
                )}
              </div>
            ))}

            {/* Terminal bottom line */}
            <div className="px-3 py-1 text-gray-700 border-t border-[#1a1a2e] select-none">
              ═══ END {autoRefresh && '│ 🟢 Auto-refreshing every 5s'} ═══
            </div>
          </div>
        )}
      </div>

      {/* Terminal Status Bar */}
      <div className="bg-[#1a1a2e] border-t border-[#2a2a4a] px-3 py-1 flex items-center justify-between text-[10px] font-mono text-gray-600 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span>{logTotal} total</span>
          <span>│</span>
          <span className="text-green-500">● {logEntries.filter(e => e.severity === 'INFO').length} INFO</span>
          <span className="text-yellow-400">● {logEntries.filter(e => e.severity === 'WARN').length} WARN</span>
          <span className="text-amber-400">● {logEntries.filter(e => e.severity === 'ALERT').length} ALERT</span>
          <span className="text-red-400">● {logEntries.filter(e => e.severity === 'CRITICAL').length} CRIT</span>
        </div>
        <div className="flex items-center gap-2">
          {autoRefresh && <span className="text-green-400 animate-pulse">● LIVE</span>}
          <span>Ctrl+F to search</span>
        </div>
      </div>
    </div>
  );
};

// ─── Reusable Components ────────────────────────────────

const StatCard = ({ icon: Icon, label, value, color, bg }) => (
  <div className={`${bg} border border-dark-700 rounded-xl p-3`}>
    <div className="flex items-center gap-2 mb-2">
      <Icon size={16} className={color} />
      <span className="text-xs text-dark-400">{label}</span>
    </div>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
  </div>
);

const AlertEntry = ({ alert, compact = false }) => {
  const [expanded, setExpanded] = useState(false);

  const severityColors = {
    CRITICAL: 'border-red-500/30 bg-red-500/5',
    ALERT: 'border-amber-500/30 bg-amber-500/5',
  };

  const severityBadge = {
    CRITICAL: 'bg-red-500/20 text-red-400',
    ALERT: 'bg-amber-500/20 text-amber-400',
  };

  return (
    <div
      className={`border rounded-xl p-3 cursor-pointer transition-colors ${severityColors[alert.severity] || 'border-dark-700 bg-dark-800'}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${severityBadge[alert.severity]}`}>
              {alert.severity}
            </span>
            <span className="text-xs text-dark-400">{alert.category}</span>
            <span className="text-xs text-white font-medium">{alert.event}</span>
          </div>
          {alert.data?.message && (
            <p className="text-xs text-dark-400 mt-1 truncate">{alert.data.message}</p>
          )}
          {alert.data?.ip && (
            <p className="text-[10px] text-dark-500 mt-0.5">IP: {alert.data.ip}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-dark-500">{new Date(alert.timestamp).toLocaleString()}</span>
          {expanded ? <ChevronUp size={12} className="text-dark-500" /> : <ChevronDown size={12} className="text-dark-500" />}
        </div>
      </div>
      {expanded && (
        <pre className="mt-2 text-[10px] text-dark-400 bg-dark-900 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(alert.data, null, 2)}
        </pre>
      )}
    </div>
  );
};

const LoadingSpinner = ({ text }) => (
  <div className="flex flex-col items-center justify-center py-12">
    <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
    <p className="text-dark-400 text-xs">{text}</p>
  </div>
);

// ─── Helpers ────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default OwnerDashboard;
