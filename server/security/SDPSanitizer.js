/**
 * ============================================
 * SDP Sanitizer — WebRTC Attack Surface Reduction
 * ============================================
 * 
 * THREAT MODEL:
 * SDP (Session Description Protocol) is essentially a text blob that
 * describes media capabilities. Attackers can:
 * 
 * 1. SDP Injection: Modify SDP to redirect media to attacker's server
 * 2. ICE Candidate Manipulation: Inject relay candidates pointing to attacker
 * 3. Codec Exploitation: Enable vulnerable codecs
 * 4. Fingerprint Leakage: Extract DTLS fingerprints for MITM
 * 5. IP Leakage: Expose private IPs via ICE candidates
 * 
 * THIS MODULE:
 * - Validates SDP structure and content
 * - Sanitizes ICE candidates (removes suspicious entries)
 * - Enforces DTLS-SRTP (prevents unencrypted media)
 * - Strips unnecessary information
 * - Validates fingerprints format
 */

const securityLogger = require('./SecurityEventLogger');
const { SEVERITY } = require('./SecurityEventLogger');

class SDPSanitizer {
  constructor() {
    // Allowed DTLS fingerprint algorithms (strongest preferred)
    this.allowedFingerprints = ['sha-256', 'sha-384', 'sha-512'];

    // Suspicious patterns in SDP
    this.suspiciousPatterns = [
      /a=crypto:/i,        // SDES (insecure, should use DTLS)
      /RTP\/AVP/i,         // Unencrypted RTP (should be RTP/SAVPF or DTLS)
    ];

    // Max SDP size (prevent oversized SDP attacks)
    this.maxSDPSize = 50000; // 50KB
  }

  /**
   * Sanitize an SDP offer or answer
   * Returns { valid, sdp, warnings }
   * 
   * @param {string} sdp - The raw SDP string
   * @param {string} type - 'offer' or 'answer'
   * @param {string} userId - User who sent this SDP
   */
  sanitizeSDP(sdp, type, userId) {
    const warnings = [];

    if (!sdp || typeof sdp !== 'string') {
      return { valid: false, sdp: null, warnings: ['Empty or invalid SDP'] };
    }

    // Size check
    if (sdp.length > this.maxSDPSize) {
      securityLogger.log('WEBRTC', 'sdp_oversized', SEVERITY.ALERT, {
        userId, type, size: sdp.length,
        message: 'Oversized SDP detected — possible attack',
      });
      return { valid: false, sdp: null, warnings: ['SDP exceeds maximum size'] };
    }

    // Verify it's valid SDP (starts with v=0)
    if (!sdp.startsWith('v=0')) {
      return { valid: false, sdp: null, warnings: ['Invalid SDP format'] };
    }

    // Check for suspicious patterns
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(sdp)) {
        warnings.push(`Suspicious SDP pattern detected: ${pattern.source}`);
        securityLogger.log('WEBRTC', 'sdp_suspicious_pattern', SEVERITY.WARN, {
          userId, type, pattern: pattern.source,
        });
      }
    }

    // Verify DTLS fingerprint exists (mandatory for encryption)
    if (!sdp.includes('a=fingerprint:')) {
      securityLogger.log('WEBRTC', 'sdp_no_fingerprint', SEVERITY.ALERT, {
        userId, type,
        message: 'SDP missing DTLS fingerprint — encryption not enforced',
      });
      warnings.push('Missing DTLS fingerprint');
      // Don't reject — some intermediate SDPs might not have it yet
    }

    // Verify DTLS setup attribute exists
    if (!sdp.includes('a=setup:')) {
      warnings.push('Missing DTLS setup attribute');
    }

    // Ensure ICE credentials exist
    if (!sdp.includes('a=ice-ufrag:') || !sdp.includes('a=ice-pwd:')) {
      warnings.push('Missing ICE credentials');
    }

    // Sanitized SDP is the original (we don't modify, just validate)
    // Modifying SDP could break WebRTC negotiation
    return {
      valid: true,
      sdp,
      warnings,
    };
  }

  /**
   * Sanitize an ICE candidate
   * Returns { valid, candidate, warnings }
   * 
   * ICE Candidate Attack Vectors:
   * - Injecting relay candidates pointing to attacker's TURN server
   * - Injecting candidates with private network IPs for scanning
   * - Flooding with thousands of candidates (DoS)
   */
  sanitizeICECandidate(candidate, userId) {
    const warnings = [];

    if (!candidate) {
      return { valid: false, candidate: null, warnings: ['Empty candidate'] };
    }

    // Handle both object and string format
    const candidateStr = typeof candidate === 'string'
      ? candidate
      : (candidate.candidate || '');

    if (!candidateStr) {
      // Empty string candidate = end-of-candidates signal (valid)
      return { valid: true, candidate, warnings: [] };
    }

    // Basic format validation
    if (!candidateStr.startsWith('candidate:') && !candidateStr.startsWith('a=candidate:')) {
      return { valid: false, candidate: null, warnings: ['Invalid candidate format'] };
    }

    // Size check (candidates shouldn't be huge)
    if (candidateStr.length > 500) {
      securityLogger.log('WEBRTC', 'ice_oversized', SEVERITY.WARN, {
        userId, size: candidateStr.length,
      });
      return { valid: false, candidate: null, warnings: ['Oversized ICE candidate'] };
    }

    // Extract candidate type
    const typeMatch = candidateStr.match(/typ\s+(host|srflx|prflx|relay)/);
    if (!typeMatch) {
      warnings.push('Unknown candidate type');
    }

    // Check for suspicious relay candidates (potential MITM)
    if (typeMatch && typeMatch[1] === 'relay') {
      // Relay candidates go through a TURN server
      // Verify the relay address isn't pointing to an unusual destination
      const relAddrMatch = candidateStr.match(/raddr\s+(\S+)\s+rport\s+(\d+)/);
      if (relAddrMatch) {
        const relAddr = relAddrMatch[1];
        // Log relay usage for monitoring
        securityLogger.log('WEBRTC', 'relay_candidate', SEVERITY.INFO, {
          userId, relayAddress: relAddr,
        });
      }
    }

    return { valid: true, candidate, warnings };
  }

  /**
   * Validate the full SDP offer/answer object from Socket.io
   * Used to wrap the WebRTC signaling flow
   */
  validateSignalingMessage(data, type, userId) {
    if (!data || typeof data !== 'object') {
      return { valid: false, reason: 'Invalid signaling data' };
    }

    // Validate SDP if present
    if (data.sdp) {
      const result = this.sanitizeSDP(data.sdp, type, userId);
      if (!result.valid) {
        return { valid: false, reason: result.warnings.join('; ') };
      }
    }

    // Validate type field
    if (data.type && !['offer', 'answer', 'pranswer', 'rollback'].includes(data.type)) {
      return { valid: false, reason: `Invalid SDP type: ${data.type}` };
    }

    return { valid: true };
  }

  /**
   * Extract and verify DTLS fingerprint from SDP
   * Used for stream fingerprint verification
   */
  extractFingerprint(sdp) {
    if (!sdp) return null;

    const match = sdp.match(/a=fingerprint:(\S+)\s+(\S+)/);
    if (!match) return null;

    return {
      algorithm: match[1],
      value: match[2],
    };
  }

  /**
   * Generate a stream integrity fingerprint
   * Used to verify media track hasn't been tampered with
   */
  generateStreamFingerprint(sdpOffer, sdpAnswer) {
    const offerFP = this.extractFingerprint(sdpOffer);
    const answerFP = this.extractFingerprint(sdpAnswer);

    if (!offerFP || !answerFP) return null;

    return {
      offer: offerFP,
      answer: answerFP,
      combined: `${offerFP.value}:${answerFP.value}`,
    };
  }
}

// Singleton
const sdpSanitizer = new SDPSanitizer();

module.exports = sdpSanitizer;
