/**
 * ============================================
 * TitleBar — Custom frameless window controls
 * ============================================
 * 
 * Telegram-style minimal titlebar for Electron desktop app.
 * Only rendered when running inside Electron (frameless window).
 * 
 * Features:
 * - Draggable title area
 * - Minimal minimize / maximize / close buttons
 * - Maximized state tracking for restore icon toggle
 */

import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { isElectron } from '../../utils/platform';

const TitleBar = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;

    // Listen for maximize/unmaximize to toggle icon
    const checkMaximized = () => {
      // Electron doesn't expose this easily via IPC, so we poll on resize
      // A simple heuristic: if window fills screen, it's maximized
    };

    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, []);

  if (!isElectron()) return null;

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => {
    window.electronAPI?.maximize();
    setIsMaximized(prev => !prev);
  };
  const handleClose = () => window.electronAPI?.close();

  return (
    <div
      className="h-[32px] bg-dark-900 flex items-center justify-between select-none flex-shrink-0"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* App title — left side */}
      <div className="flex items-center gap-2 px-3">
        <div className="w-4 h-4 rounded bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
          <span className="text-white text-[8px] font-bold leading-none">Q</span>
        </div>
        <span className="text-[11px] text-dark-400 font-medium tracking-wide">Quick Meet</span>
      </div>

      {/* Window controls — right side */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' }}>
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          className="w-[46px] h-full flex items-center justify-center text-dark-400 hover:bg-dark-700/60 hover:text-dark-200 transition-colors duration-150"
          title="Minimize"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={handleMaximize}
          className="w-[46px] h-full flex items-center justify-center text-dark-400 hover:bg-dark-700/60 hover:text-dark-200 transition-colors duration-150"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <Copy size={12} strokeWidth={1.5} className="rotate-0" />
          ) : (
            <Square size={12} strokeWidth={1.5} />
          )}
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          className="w-[46px] h-full flex items-center justify-center text-dark-400 hover:bg-red-500 hover:text-white transition-colors duration-150"
          title="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
