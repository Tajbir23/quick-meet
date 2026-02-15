/**
 * ============================================
 * UserSettings — Profile settings modal
 * ============================================
 * 
 * Allows user to:
 * - Change profile image (avatar)
 * - Change username
 * - Change email
 * - Change password
 * - Toggle profile visibility (hide from search)
 * - Toggle email visibility
 * - View app info (About)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X, Camera, User, Mail, Lock, Eye, EyeOff,
  Shield, Save, Loader2, AlertCircle, Check,
  Info, Download, RefreshCw, Smartphone, Monitor, Globe, Calendar, Hash
} from 'lucide-react';
import useAuthStore from '../../store/useAuthStore';
import api from '../../services/api';
import { SERVER_URL, APP_VERSION, APP_BUILD_DATE } from '../../utils/constants';
import { getInitials, stringToColor } from '../../utils/helpers';
import toast from 'react-hot-toast';

const UserSettings = ({ onClose }) => {
  const user = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);

  const [activeTab, setActiveTab] = useState('profile'); // profile | security | privacy
  const [saving, setSaving] = useState(false);

  // Profile fields
  const [username, setUsername] = useState(user?.username || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);

  // Security fields
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // Privacy fields
  const [profileHidden, setProfileHidden] = useState(user?.profileHidden || false);
  const [emailHidden, setEmailHidden] = useState(user?.emailHidden || false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Handle avatar file selection
  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB');
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // Save profile (username + avatar)
  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      let avatarUrl = user?.avatar || '';

      // Upload avatar if changed
      if (avatarFile) {
        const formData = new FormData();
        formData.append('file', avatarFile);
        const uploadRes = await api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        avatarUrl = uploadRes.data.data.file.url;
      }

      const payload = {};
      if (username.trim()) payload.username = username.trim();
      if (avatarUrl !== (user?.avatar || '')) payload.avatar = avatarUrl;
      // If nothing changed, still send avatar if file was uploaded
      if (avatarFile) payload.avatar = avatarUrl;

      if (Object.keys(payload).length === 0) {
        toast('No changes to save');
        setSaving(false);
        return;
      }

      const res = await api.put('/users/profile', payload);
      const updatedUser = res.data.data.user;

      updateUser(updatedUser);
      // Also update localStorage so refresh doesn't lose changes
      const stored = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...stored, ...updatedUser }));
      toast.success('Profile updated!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  // Save email + password
  const handleSaveSecurity = async () => {
    if (newPassword && newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if ((newPassword || email !== user?.email) && !currentPassword) {
      toast.error('Current password is required to make changes');
      return;
    }

    setSaving(true);
    try {
      const payload = { currentPassword };
      if (email !== user?.email) payload.email = email.trim();
      if (newPassword) payload.newPassword = newPassword;

      const res = await api.put('/users/security', payload);
      updateUser(res.data.data.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Security settings updated!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update security settings');
    } finally {
      setSaving(false);
    }
  };

  // Save privacy settings
  const handleSavePrivacy = async () => {
    setSaving(true);
    try {
      const res = await api.put('/users/privacy', {
        profileHidden,
        emailHidden,
      });
      updateUser(res.data.data.user);
      toast.success('Privacy settings updated!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update privacy settings');
    } finally {
      setSaving(false);
    }
  };

  const avatarDisplay = avatarPreview || (user?.avatar ? `${SERVER_URL}${user.avatar}` : null);

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'privacy', label: 'Privacy', icon: Shield },
    { id: 'about', label: 'About', icon: Info },
  ];

  return (
    <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-dark-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden shadow-2xl border border-dark-700" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-700 bg-dark-800/80">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-all relative ${
                activeTab === tab.id ? 'text-primary-400' : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary-400 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="overflow-y-auto p-5 max-h-[60vh]">
          {/* ─── PROFILE TAB ─── */}
          {activeTab === 'profile' && (
            <div className="space-y-5">
              {/* Avatar */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  {avatarDisplay ? (
                    <img
                      src={avatarDisplay}
                      alt="Avatar"
                      className="w-24 h-24 rounded-full object-cover border-3 border-dark-600"
                    />
                  ) : (
                    <div
                      className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold text-white border-3 border-dark-600"
                      style={{ backgroundColor: stringToColor(user?.username) }}
                    >
                      {getInitials(user?.username)}
                    </div>
                  )}
                  <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary-500 hover:bg-primary-600 flex items-center justify-center cursor-pointer transition-colors border-2 border-dark-800">
                    <Camera size={14} className="text-white" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-dark-400">Click camera icon to change photo</p>
              </div>

              {/* Username */}
              <div>
                <label className="block text-xs font-medium text-dark-300 mb-1.5">Username</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="input-field pl-10 text-sm"
                    placeholder="Enter username"
                  />
                </div>
              </div>

              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Profile
              </button>
            </div>
          )}

          {/* ─── SECURITY TAB ─── */}
          {activeTab === 'security' && (
            <div className="space-y-5">
              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-dark-300 mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="input-field pl-10 text-sm"
                    placeholder="Enter email"
                  />
                </div>
              </div>

              <div className="border-t border-dark-700 pt-4">
                <p className="text-xs font-medium text-dark-300 mb-3">Change Password</p>
                
                {/* Current password */}
                <div className="mb-3">
                  <label className="block text-[11px] text-dark-400 mb-1">Current Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                    <input
                      type={showCurrentPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      className="input-field pl-10 pr-10 text-sm"
                      placeholder="Current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPw(!showCurrentPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200"
                    >
                      {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* New password */}
                <div className="mb-3">
                  <label className="block text-[11px] text-dark-400 mb-1">New Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="input-field pl-10 pr-10 text-sm"
                      placeholder="New password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(!showNewPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200"
                    >
                      {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
                <div className="mb-3">
                  <label className="block text-[11px] text-dark-400 mb-1">Confirm New Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="input-field pl-10 text-sm"
                      placeholder="Confirm new password"
                    />
                    {confirmPassword && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        {newPassword === confirmPassword
                          ? <Check size={16} className="text-emerald-400" />
                          : <AlertCircle size={16} className="text-red-400" />
                        }
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={handleSaveSecurity}
                disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Security Settings
              </button>
            </div>
          )}

          {/* ─── PRIVACY TAB ─── */}
          {activeTab === 'privacy' && (
            <div className="space-y-5">
              <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                <p className="text-xs text-dark-300 mb-3">Control who can find and see your information</p>

                {/* Hide profile from search */}
                <div className="flex items-center justify-between py-3 border-b border-dark-600">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-dark-600 flex items-center justify-center">
                      <EyeOff size={16} className="text-dark-300" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Hide Profile</p>
                      <p className="text-[11px] text-dark-400">Others can't find you via search</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setProfileHidden(!profileHidden)}
                    className={`w-12 h-7 rounded-full transition-colors duration-200 relative flex-shrink-0 ${
                      profileHidden ? 'bg-primary-500' : 'bg-dark-600'
                    }`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow-md absolute top-1 transition-all duration-200 ${
                      profileHidden ? 'left-6' : 'left-1'
                    }`} />
                  </button>
                </div>

                {/* Hide email */}
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-dark-600 flex items-center justify-center">
                      <Mail size={16} className="text-dark-300" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Hide Email</p>
                      <p className="text-[11px] text-dark-400">Email won't be visible to others</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEmailHidden(!emailHidden)}
                    className={`w-12 h-7 rounded-full transition-colors duration-200 relative flex-shrink-0 ${
                      emailHidden ? 'bg-primary-500' : 'bg-dark-600'
                    }`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow-md absolute top-1 transition-all duration-200 ${
                      emailHidden ? 'left-6' : 'left-1'
                    }`} />
                  </button>
                </div>
              </div>

              <button
                onClick={handleSavePrivacy}
                disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Privacy Settings
              </button>
            </div>
          )}

          {/* ─── ABOUT TAB ─── */}
          {activeTab === 'about' && (
            <AboutTab />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── About Tab Component ───
function getPlatformInfo() {
  if (window.electronAPI?.isElectron) return { name: 'Desktop (Windows)', icon: Monitor };
  if (window.Capacitor?.isNativePlatform?.()) return { name: 'Mobile (Android)', icon: Smartphone };
  return { name: 'Web Browser', icon: Globe };
}

const AboutTab = () => {
  const [serverVersions, setServerVersions] = useState(null);
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);

  const platform = getPlatformInfo();
  const PlatformIcon = platform.icon;

  // Fetch server version info on mount
  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const res = await api.get('/updates/versions');
        if (res.data.success) {
          setServerVersions(res.data.versions);
        }
      } catch (e) {
        // Silent fail
      }
    };
    fetchVersions();
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    setUpdateResult(null);
    try {
      let platformKey = 'web';
      if (window.electronAPI?.isElectron) platformKey = 'desktop';
      else if (window.Capacitor?.isNativePlatform?.()) platformKey = 'android';

      const res = await api.get(`/updates/check?platform=${platformKey}&version=${APP_VERSION}`);
      const data = res.data;

      if (data.success) {
        if (data.hasUpdate) {
          setUpdateResult({
            type: 'update',
            version: data.latestVersion,
            notes: data.releaseNotes,
            url: data.downloadUrl,
            mustUpdate: data.mustUpdate,
          });
        } else {
          setUpdateResult({ type: 'up-to-date' });
        }
      }
    } catch (e) {
      setUpdateResult({ type: 'error', message: 'Could not check for updates' });
    } finally {
      setChecking(false);
    }
  }, []);

  // Get latest update date from server
  const serverPlatformKey = window.electronAPI?.isElectron ? 'desktop'
    : window.Capacitor?.isNativePlatform?.() ? 'android' : 'web';
  const lastUpdated = serverVersions?.[serverPlatformKey]?.lastUpdated;
  const latestVersion = serverVersions?.[serverPlatformKey]?.version;

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-4">
      {/* App Logo & Name */}
      <div className="flex flex-col items-center gap-2 py-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg">
          <span className="text-white text-3xl font-bold">Q</span>
        </div>
        <h3 className="text-lg font-bold text-white">Quick Meet</h3>
        <p className="text-xs text-dark-400">Real-time Communication Platform</p>
      </div>

      {/* Version Info Card */}
      <div className="bg-dark-700/50 rounded-xl border border-dark-600 divide-y divide-dark-600">
        {/* Current Version */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-500/15 flex items-center justify-center">
              <Hash size={15} className="text-primary-400" />
            </div>
            <div>
              <p className="text-xs text-dark-400">Current Version</p>
              <p className="text-sm font-semibold text-white">v{APP_VERSION}</p>
            </div>
          </div>
          {latestVersion && latestVersion !== APP_VERSION && (
            <span className="px-2 py-0.5 bg-amber-500/15 text-amber-400 text-[10px] font-medium rounded-full">
              v{latestVersion} available
            </span>
          )}
        </div>

        {/* Last Updated */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <Calendar size={15} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-dark-400">Last Updated</p>
            <p className="text-sm font-medium text-white">{formatDate(lastUpdated || APP_BUILD_DATE)}</p>
          </div>
        </div>

        {/* Platform */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
            <PlatformIcon size={15} className="text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-dark-400">Platform</p>
            <p className="text-sm font-medium text-white">{platform.name}</p>
          </div>
        </div>

        {/* Build Date */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <Info size={15} className="text-purple-400" />
          </div>
          <div>
            <p className="text-xs text-dark-400">Build Date</p>
            <p className="text-sm font-medium text-white">{formatDate(APP_BUILD_DATE)}</p>
          </div>
        </div>
      </div>

      {/* Check for Updates Button */}
      <button
        onClick={handleCheckUpdate}
        disabled={checking}
        className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
      >
        {checking ? (
          <><Loader2 size={16} className="animate-spin" /> Checking...</>
        ) : (
          <><RefreshCw size={16} /> Check for Updates</>
        )}
      </button>

      {/* Update Result */}
      {updateResult && (
        <div className={`rounded-xl p-3 border ${
          updateResult.type === 'up-to-date'
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : updateResult.type === 'update'
            ? 'bg-amber-500/10 border-amber-500/20'
            : 'bg-red-500/10 border-red-500/20'
        }`}>
          {updateResult.type === 'up-to-date' && (
            <div className="flex items-center gap-2">
              <Check size={16} className="text-emerald-400" />
              <span className="text-sm text-emerald-300">You're on the latest version!</span>
            </div>
          )}
          {updateResult.type === 'update' && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Download size={16} className="text-amber-400" />
                <span className="text-sm font-medium text-amber-300">
                  v{updateResult.version} available
                  {updateResult.mustUpdate && ' (Required)'}
                </span>
              </div>
              {updateResult.notes && (
                <p className="text-xs text-dark-300 mb-3">{updateResult.notes}</p>
              )}
              <button
                onClick={() => {
                  // Platform-specific install action
                  const platformKey = window.electronAPI?.isElectron ? 'desktop'
                    : window.Capacitor?.isNativePlatform?.() ? 'android' : 'web';
                  
                  if (platformKey === 'web') {
                    // Clear caches and reload
                    if ('caches' in window) {
                      caches.keys().then(names => names.forEach(name => caches.delete(name)));
                    }
                    window.location.reload(true);
                  } else if (platformKey === 'desktop') {
                    // Trigger electron-updater download
                    if (window.electronAPI?.checkForUpdate) {
                      window.electronAPI.checkForUpdate();
                    } else if (updateResult.url) {
                      window.open(updateResult.url, '_blank');
                    }
                  } else if (platformKey === 'android' && updateResult.url) {
                    // Open download URL — UpdateNotification handles proper APK install
                    window.open(updateResult.url, '_system');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <Download size={12} />
                {window.electronAPI?.isElectron ? 'Download & Install'
                  : window.Capacitor?.isNativePlatform?.() ? 'Download & Install'
                  : 'Reload to Update'}
              </button>
            </div>
          )}
          {updateResult.type === 'error' && (
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-red-400" />
              <span className="text-sm text-red-300">{updateResult.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-center pt-2">
        <p className="text-[11px] text-dark-500">
          © 2026 Quick Meet • Built with ❤️
        </p>
      </div>
    </div>
  );
};

export default UserSettings;
