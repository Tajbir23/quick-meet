/**
 * ============================================
 * ChannelPoll — Poll Display & Voting
 * ============================================
 */

import { useState } from 'react';
import { BarChart3, Check, Users, Lock, Timer } from 'lucide-react';
import useChannelStore from '../../store/useChannelStore';
import useAuthStore from '../../store/useAuthStore';

const ChannelPoll = ({ poll, postId, channelId }) => {
  const user = useAuthStore(s => s.user);
  const votePoll = useChannelStore(s => s.votePoll);
  const closePoll = useChannelStore(s => s.closePoll);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [voting, setVoting] = useState(false);

  if (!poll) return null;

  // Calculate total votes
  const totalVotes = poll.options.reduce((sum, opt) => sum + (opt.voters?.length || 0), 0);

  // Check if user has voted
  const hasVoted = poll.options.some(opt =>
    opt.voters?.some(v => {
      const voterId = typeof v === 'object' ? v._id : v;
      return voterId === user?._id;
    })
  );

  // Check if poll is closed
  const isClosed = poll.closesAt && new Date(poll.closesAt) < new Date();

  const handleOptionClick = (optionIndex) => {
    if (hasVoted || isClosed) return;

    if (poll.allowMultiple) {
      setSelectedOptions(prev =>
        prev.includes(optionIndex)
          ? prev.filter(i => i !== optionIndex)
          : [...prev, optionIndex]
      );
    } else {
      // Single vote — immediately submit
      handleVote([optionIndex]);
    }
  };

  const handleVote = async (optionIndices = selectedOptions) => {
    if (voting || optionIndices.length === 0) return;
    setVoting(true);
    try {
      for (const optIdx of optionIndices) {
        await votePoll(channelId, postId, optIdx);
      }
      setSelectedOptions([]);
    } catch (err) {
      console.error('Vote failed:', err);
    } finally {
      setVoting(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm('Close this poll? No more votes will be accepted.')) return;
    await closePoll(channelId, postId);
  };

  return (
    <div className="mb-3 bg-dark-700/50 rounded-xl p-4">
      {/* Poll header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-indigo-400" />
          <h4 className="text-sm font-semibold text-white">{poll.question}</h4>
        </div>
        <div className="flex items-center gap-1">
          {poll.isAnonymous && (
            <span className="text-[10px] text-dark-500 flex items-center gap-0.5">
              <Lock size={10} /> Anonymous
            </span>
          )}
          {poll.isQuiz && (
            <span className="text-[10px] text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded-full">
              Quiz
            </span>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {poll.options.map((option, index) => {
          const voterCount = option.voters?.length || 0;
          const percentage = totalVotes > 0 ? Math.round((voterCount / totalVotes) * 100) : 0;
          const isSelected = selectedOptions.includes(index);
          const showCorrect = poll.isQuiz && hasVoted && index === poll.correctOption;
          const userVotedThis = option.voters?.some(v => {
            const voterId = typeof v === 'object' ? v._id : v;
            return voterId === user?._id;
          });

          return (
            <button
              key={index}
              onClick={() => handleOptionClick(index)}
              disabled={hasVoted || isClosed}
              className={`w-full text-left rounded-lg p-3 transition-all relative overflow-hidden ${
                isSelected
                  ? 'bg-indigo-500/20 border border-indigo-500/50'
                  : hasVoted || isClosed
                    ? 'bg-dark-600/50 border border-dark-600'
                    : 'bg-dark-600 border border-dark-600 hover:border-dark-500 hover:bg-dark-600/80'
              }`}
            >
              {/* Progress bar background */}
              {(hasVoted || isClosed) && (
                <div
                  className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                    showCorrect ? 'bg-emerald-500/20' : userVotedThis ? 'bg-indigo-500/15' : 'bg-dark-500/20'
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              )}

              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Checkbox/Radio for unvoted */}
                  {!hasVoted && !isClosed && (
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected ? 'border-indigo-400 bg-indigo-400' : 'border-dark-400'
                    }`}>
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>
                  )}

                  {/* Check mark for voted option */}
                  {userVotedThis && (
                    <div className="w-4 h-4 rounded-full bg-indigo-400 flex items-center justify-center flex-shrink-0">
                      <Check size={10} className="text-white" />
                    </div>
                  )}

                  {/* Correct indicator for quiz */}
                  {showCorrect && !userVotedThis && (
                    <div className="w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center flex-shrink-0">
                      <Check size={10} className="text-white" />
                    </div>
                  )}

                  <span className={`text-sm ${userVotedThis ? 'text-white font-medium' : 'text-dark-200'}`}>
                    {option.text}
                  </span>
                </div>

                {(hasVoted || isClosed) && (
                  <span className="text-xs text-dark-400 flex-shrink-0 ml-2">
                    {percentage}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Multi-select vote button */}
      {poll.allowMultiple && !hasVoted && !isClosed && selectedOptions.length > 0 && (
        <button
          onClick={() => handleVote()}
          disabled={voting}
          className="mt-3 btn-primary w-full text-sm py-2"
        >
          {voting ? 'Voting...' : `Vote (${selectedOptions.length} selected)`}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-dark-600/50">
        <div className="flex items-center gap-1 text-dark-500">
          <Users size={12} />
          <span className="text-[11px]">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {poll.closesAt && !isClosed && (
            <span className="text-[10px] text-dark-500 flex items-center gap-1">
              <Timer size={10} />
              Closes {new Date(poll.closesAt).toLocaleDateString()}
            </span>
          )}
          {isClosed && (
            <span className="text-[10px] text-red-400">Poll closed</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChannelPoll;
