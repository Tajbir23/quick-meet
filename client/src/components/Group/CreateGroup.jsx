/**
 * ============================================
 * CreateGroup — Modal to create a new group
 * ============================================
 */

import { useState } from 'react';
import { X, Hash, Users, Plus, Check } from 'lucide-react';
import useGroupStore from '../../store/useGroupStore';
import useChatStore from '../../store/useChatStore';
import { getInitials, stringToColor } from '../../utils/helpers';
import toast from 'react-hot-toast';

const CreateGroup = ({ onClose }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const { createGroup } = useGroupStore();
  const { users } = useChatStore();

  const toggleMember = (userId) => {
    setSelectedMembers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Group name is required');
      return;
    }

    if (name.trim().length < 2) {
      toast.error('Group name must be at least 2 characters');
      return;
    }

    setIsCreating(true);

    const result = await createGroup(name.trim(), description.trim(), selectedMembers);

    if (result.success) {
      toast.success(`Group "${result.group.name}" created!`);
      onClose();
    } else {
      toast.error(result.message);
    }

    setIsCreating(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-dark-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Hash size={20} className="text-primary-400" />
            Create Group
          </h2>
          <button onClick={onClose} className="btn-icon text-dark-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Group name */}
          <div>
            <label className="text-sm text-dark-300 mb-1.5 block">Group Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Project Team"
              className="input-field"
              maxLength={50}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm text-dark-300 mb-1.5 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group about?"
              className="input-field resize-none"
              rows={2}
              maxLength={200}
            />
          </div>

          {/* Member selection */}
          <div>
            <label className="text-sm text-dark-300 mb-1.5 block flex items-center gap-2">
              <Users size={14} />
              Add Members ({selectedMembers.length} selected)
            </label>
            <div className="max-h-48 overflow-y-auto bg-dark-900 rounded-lg divide-y divide-dark-700/50">
              {users.length === 0 ? (
                <p className="text-dark-500 text-sm p-3 text-center">No users available</p>
              ) : (
                users.map(user => {
                  const isSelected = selectedMembers.includes(user._id);
                  return (
                    <button
                      key={user._id}
                      onClick={() => toggleMember(user._id)}
                      className={`w-full flex items-center gap-3 p-3 transition-colors text-left ${
                        isSelected ? 'bg-primary-500/10' : 'hover:bg-dark-800'
                      }`}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: stringToColor(user.username) }}
                      >
                        {getInitials(user.username)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{user.username}</p>
                        <p className="text-xs text-dark-500 truncate">{user.email}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'bg-primary-500 border-primary-500'
                          : 'border-dark-500'
                      }`}>
                        {isSelected && <Check size={12} className="text-white" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-dark-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-dark-600 text-dark-300 hover:text-white hover:border-dark-500 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
            className="flex-1 btn-primary py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isCreating ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Plus size={16} />
                Create
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroup;
