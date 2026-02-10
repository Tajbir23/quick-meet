/**
 * ============================================
 * UserAvatar — Reusable avatar component
 * ============================================
 */

import { getInitials, stringToColor } from '../../utils/helpers';
import { Shield } from 'lucide-react';

const UserAvatar = ({
  name,
  size = 'md',
  showStatus = false,
  isOnline = false,
  isOwner = false,
  className = '',
}) => {
  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
    xl: 'w-20 h-20 text-2xl',
  };

  const statusSizes = {
    xs: 'w-2 h-2 border',
    sm: 'w-2.5 h-2.5 border-2',
    md: 'w-3 h-3 border-2',
    lg: 'w-3.5 h-3.5 border-2',
    xl: 'w-4 h-4 border-2',
  };

  return (
    <div className={`relative inline-flex ${className}`}>
      <div
        className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold`}
        style={{ backgroundColor: stringToColor(name) }}
      >
        {getInitials(name)}
      </div>
      {showStatus && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-dark-800 ${statusSizes[size]} ${
            isOnline ? 'bg-emerald-400' : 'bg-dark-500'
          }`}
        />
      )}
      {isOwner && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center border border-dark-800">
          <Shield size={8} className="text-dark-900" />
        </span>
      )}
    </div>
  );
};

export default UserAvatar;
