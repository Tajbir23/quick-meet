/**
 * ============================================
 * CreateChannel — Modal for creating channels
 * ============================================
 */

import { useState } from 'react';
import { X, Radio, Globe, Lock, Info } from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import toast from 'react-hot-toast';

const CreateChannel = ({ onClose }) => {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('public');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { createChannel } = useChannelStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Channel name is required');
      return;
    }

    setIsSubmitting(true);
    const result = await createChannel({
      name: name.trim(),
      username: username.trim() || undefined,
      description: description.trim(),
      type,
    });

    if (result.success) {
      toast.success('Channel created!');
      onClose();
    } else {
      toast.error(result.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-800 rounded-2xl border border-dark-700 w-full max-w-md shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
              <Radio size={20} className="text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">New Channel</h3>
              <p className="text-xs text-dark-400">Create a broadcast channel</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Channel name */}
          <div>
            <label className="block text-xs font-medium text-dark-300 mb-1.5">
              Channel Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Channel"
              className="input-field"
              maxLength={128}
              autoFocus
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-medium text-dark-300 mb-1.5">
              Public Link (optional)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500 text-sm">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())}
                placeholder="channelname"
                className="input-field pl-8"
                maxLength={32}
              />
            </div>
            <p className="text-[10px] text-dark-500 mt-1">
              4-32 chars. Letters, numbers, underscores only.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-dark-300 mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this channel about?"
              className="input-field resize-none h-20"
              maxLength={1000}
            />
          </div>

          {/* Channel Type */}
          <div>
            <label className="block text-xs font-medium text-dark-300 mb-2">
              Channel Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('public')}
                className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                  type === 'public'
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                    : 'border-dark-600 text-dark-400 hover:border-dark-500'
                }`}
              >
                <Globe size={16} />
                <div className="text-left">
                  <p className="text-xs font-medium">Public</p>
                  <p className="text-[10px] opacity-60">Anyone can find & join</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setType('private')}
                className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                  type === 'private'
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                    : 'border-dark-600 text-dark-400 hover:border-dark-500'
                }`}
              >
                <Lock size={16} />
                <div className="text-left">
                  <p className="text-xs font-medium">Private</p>
                  <p className="text-[10px] opacity-60">Invite link only</p>
                </div>
              </button>
            </div>
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 bg-dark-900/50 rounded-lg p-3">
            <Info size={14} className="text-dark-500 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-dark-400 leading-relaxed">
              Channels are for broadcasting messages to large audiences. 
              Only admins can post. Subscribers can react, comment, and vote on polls.
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm text-dark-300 bg-dark-700 rounded-xl hover:bg-dark-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateChannel;
