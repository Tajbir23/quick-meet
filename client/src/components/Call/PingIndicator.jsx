/**
 * ============================================
 * PingIndicator — Shows network latency
 * ============================================
 * 
 * Displays server and/or peer RTT with color coding:
 *   Green  < 80ms  (excellent)
 *   Yellow < 200ms (acceptable)
 *   Red    ≥ 200ms (poor)
 *
 * Compact mode: just the ping value (for StatusBar)
 * Full mode: server + peer with labels (for call screens)
 */

import { Wifi } from 'lucide-react';
import useCallStore from '../../store/useCallStore';

const getPingColor = (ms) => {
  if (ms == null) return 'text-dark-500';
  if (ms < 80) return 'text-emerald-400';
  if (ms < 200) return 'text-yellow-400';
  return 'text-red-400';
};

const getPingDotColor = (ms) => {
  if (ms == null) return 'bg-dark-500';
  if (ms < 80) return 'bg-emerald-400';
  if (ms < 200) return 'bg-yellow-400';
  return 'bg-red-400';
};

/**
 * @param {'compact' | 'full' | 'inline'} variant
 *   - compact: single-line for StatusBar (12ms)
 *   - inline:  fits next to ICE state bubble (S:12 P:8)
 *   - full:    detailed block for call screens
 */
const PingIndicator = ({ variant = 'inline' }) => {
  const networkPing = useCallStore(s => s.networkPing);

  if (!networkPing) return null;

  const { server, peer } = networkPing;
  // Pick the best available value for primary display
  const primaryPing = peer ?? server;

  if (variant === 'compact') {
    return (
      <span className={`text-[11px] font-mono tabular-nums flex items-center gap-1 ${getPingColor(primaryPing)}`}>
        <Wifi size={11} />
        {primaryPing != null ? `${primaryPing}ms` : '--'}
      </span>
    );
  }

  if (variant === 'inline') {
    return (
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${getPingDotColor(primaryPing)}`} />
        {server != null && (
          <span className={`text-[10px] font-mono tabular-nums ${getPingColor(server)}`}>
            S:{server}
          </span>
        )}
        {peer != null && (
          <span className={`text-[10px] font-mono tabular-nums ${getPingColor(peer)}`}>
            P:{peer}
          </span>
        )}
        {server == null && peer == null && (
          <span className="text-[10px] text-dark-500 font-mono">--</span>
        )}
        <span className="text-[10px] text-dark-500">ms</span>
      </span>
    );
  }

  // full variant
  return (
    <div className="flex items-center gap-3 bg-dark-800/50 rounded-full px-3 py-1.5 backdrop-blur-sm">
      <Wifi size={13} className={getPingColor(primaryPing)} />
      <div className="flex items-center gap-2">
        {server != null && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${getPingDotColor(server)}`} />
            <span className={`text-[10px] font-mono tabular-nums ${getPingColor(server)}`}>
              Server: {server}ms
            </span>
          </span>
        )}
        {peer != null && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${getPingDotColor(peer)}`} />
            <span className={`text-[10px] font-mono tabular-nums ${getPingColor(peer)}`}>
              Peer: {peer}ms
            </span>
          </span>
        )}
      </div>
    </div>
  );
};

export default PingIndicator;
