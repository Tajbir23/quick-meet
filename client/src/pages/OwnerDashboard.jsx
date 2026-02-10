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

import { useState, useEffect } from 'react';
import {
  Shield, Users, FileText, AlertTriangle, Activity,
  ArrowLeft, Download, Trash2, Ban, CheckCircle,
  Search, RefreshCw, Eye, EyeOff, Clock, Server,
  HardDrive, Cpu, ChevronDown, ChevronUp, X,
  Lock, Unlock, Calendar, Filter
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

// ─── Logs Tab ───────────────────────────────────────────
const LogsTab = () => {
  const { logFiles, logEntries, logTotal, logsLoading, fetchLogFiles, fetchLogsByDate, downloadLogFile } = useOwnerStore();
  const [selectedDate, setSelectedDate] = useState(null);
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchLogFiles();
  }, []);

  const handleSelectDate = (date) => {
    setSelectedDate(date);
    fetchLogsByDate(date, { severity, category, search });
  };

  const handleFilter = () => {
    if (selectedDate) {
      fetchLogsByDate(selectedDate, { severity, category, search });
    }
  };

  useEffect(() => {
    if (selectedDate) handleFilter();
  }, [severity, category]);

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {!selectedDate ? (
        // Log file list
        <>
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Shield size={16} className="text-amber-400" />
            Security Log Files
          </h2>
          {logsLoading ? (
            <LoadingSpinner text="Loading log files..." />
          ) : logFiles.length === 0 ? (
            <div className="text-center py-12">
              <Shield size={40} className="mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400 text-sm">No log files found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logFiles.map(f => (
                <button
                  key={f.name}
                  onClick={() => handleSelectDate(f.date)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl p-3 text-left hover:border-dark-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar size={16} className="text-amber-400" />
                      <div>
                        <p className="text-sm font-medium text-white">{f.date}</p>
                        <p className="text-[10px] text-dark-500">{formatBytes(f.size)}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadLogFile(f.name); }}
                      className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                      title="Download raw log"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        // Log entries viewer
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedDate(null)}
                className="btn-icon text-dark-400 hover:text-white"
              >
                <ArrowLeft size={16} />
              </button>
              <h2 className="text-sm font-semibold text-white">
                Logs — {selectedDate}
                <span className="text-xs text-dark-400 ml-2">({logTotal} entries)</span>
              </h2>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value)}
              className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-xs text-white"
            >
              <option value="">All Severities</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ALERT">ALERT</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-xs text-white"
            >
              <option value="">All Categories</option>
              <option value="AUTH">AUTH</option>
              <option value="SESSION">SESSION</option>
              <option value="SOCKET">SOCKET</option>
              <option value="CALL">CALL</option>
              <option value="FILE">FILE</option>
              <option value="INTRUSION">INTRUSION</option>
              <option value="SYSTEM">SYSTEM</option>
            </select>
            <div className="relative flex-1 min-w-[150px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFilter()}
                placeholder="Search logs..."
                className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white"
              />
            </div>
            <button
              onClick={handleFilter}
              className="px-3 py-1.5 bg-amber-500/20 text-amber-400 text-xs rounded-lg hover:bg-amber-500/30"
            >
              <Filter size={12} />
            </button>
          </div>

          {/* Log entries */}
          {logsLoading ? (
            <LoadingSpinner text="Loading logs..." />
          ) : logEntries.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-dark-400 text-sm">No matching log entries</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {logEntries.map((entry, i) => (
                <LogEntry key={i} entry={entry} />
              ))}
            </div>
          )}
        </>
      )}
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

const LogEntry = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);

  const severityColors = {
    INFO: 'text-blue-400',
    WARN: 'text-yellow-400',
    ALERT: 'text-amber-400',
    CRITICAL: 'text-red-400',
  };

  const time = new Date(entry.timestamp).toLocaleTimeString();

  return (
    <div
      className="bg-dark-800 border border-dark-700 rounded-lg p-2 cursor-pointer hover:border-dark-600 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-dark-500 font-mono w-16 flex-shrink-0">{time}</span>
        <span className={`font-medium w-14 flex-shrink-0 ${severityColors[entry.severity]}`}>{entry.severity}</span>
        <span className="text-dark-400 w-16 flex-shrink-0">{entry.category}</span>
        <span className="text-white flex-1 truncate">{entry.event}</span>
        {entry.data?.ip && <span className="text-dark-500 text-[10px] flex-shrink-0">{entry.data.ip}</span>}
      </div>
      {expanded && entry.data && (
        <pre className="mt-2 text-[10px] text-dark-400 bg-dark-900 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(entry.data, null, 2)}
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
