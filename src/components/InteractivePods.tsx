import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Lock,
  Unlock,
  Hand,
  Check,
  BarChart3,
  PlusCircle,
  Eye,
  FolderOpen,
  Upload,
  Download,
  FileText,
  Pin,
} from 'lucide-react';
import type {
  ChatMessage,
  LivePoll,
  Participant,
  SharedFileItem,
  UserRole,
} from '../types/classroom';
import { computePollBreakdown } from '../utils/classroomRules';

const REACTION_EMOJIS = ['👏', '🔥', '💡', '❓', '❤️', '🎯'];

// ============================================================================
// 1. Moderated Multi-Tab BiDi Chat Pod (Public, Ask Host Privately, Pinned)
// ============================================================================
export interface ChatPodProps {
  messages: ChatMessage[];
  chatLocked: boolean;
  localParticipantId: string;
  localParticipantName: string;
  localRole: UserRole;
  onSendMessage: (channel: 'public' | 'private_host' | 'pinned', text: string) => void;
  onToggleChatLock: () => void;
  onSendReaction: (emoji: string) => void;
}

export const ChatPod: React.FC<ChatPodProps> = ({
  messages,
  chatLocked,
  localRole,
  onSendMessage,
  onToggleChatLock,
  onSendReaction,
}) => {
  const [activeChannel, setActiveChannel] = useState<'public' | 'private_host' | 'pinned'>('public');
  const [draft, setDraft] = useState('');
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const isHostOrAssistant = localRole === 'teacher' || localRole === 'assistant';

  const visibleMessages = messages.filter((m) => {
    if (activeChannel === 'pinned') return m.channel === 'pinned' || m.pinned;
    return m.channel === activeChannel;
  });

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length, activeChannel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (chatLocked && localRole === 'student' && activeChannel === 'public') return;
    onSendMessage(activeChannel, draft);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full gap-2.5">
      {/* Channel Selector Tabs + Host Chat Lock Toggle */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 bg-black/25 p-1 rounded-xl border border-[var(--border-specular)]">
          {(
            [
              { id: 'public', label: 'Public' },
              { id: 'private_host', label: 'Ask Host' },
              { id: 'pinned', label: 'Pinned' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveChannel(tab.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                activeChannel === tab.id
                  ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isHostOrAssistant && (
          <button
            type="button"
            onClick={onToggleChatLock}
            aria-label={chatLocked ? 'Unlock Public Chat' : 'Lock Public Chat'}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1 border transition-colors whitespace-nowrap ${
              chatLocked
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-specular)]'
            }`}
          >
            {chatLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>{chatLocked ? 'Locked' : 'Open'}</span>
          </button>
        )}
      </div>

      {/* Scrollable BiDi Message Feed */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {visibleMessages.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-xs text-[var(--text-muted)]">
            No messages in this channel yet.
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <div
              key={msg.id}
              className={`p-2.5 rounded-xl border ${
                msg.channel === 'pinned'
                  ? 'bg-[#D4A373]/10 border-[#D4A373]/35'
                  : 'bg-black/20 border-[var(--border-specular)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] mb-1">
                <span className="font-semibold text-[var(--text-primary)] truncate">
                  {msg.senderName}
                </span>
                <span className="font-mono-tabular shrink-0">
                  {msg.channel === 'pinned' && <Pin className="w-3 h-3 inline mr-1 text-[#D4A373]" />}
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p
                dir="auto"
                className="text-xs leading-relaxed text-[var(--text-primary)] break-words"
              >
                {msg.text}
              </p>
            </div>
          ))
        )}
        <div ref={listEndRef} />
      </div>

      {/* Live Floating Emoji Reaction Strip */}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-xl bg-black/20 border border-[var(--border-specular)] shrink-0">
        <span className="text-[11px] text-[var(--text-muted)] pl-1">React:</span>
        <div className="flex items-center gap-1">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Send reaction ${emoji}`}
              onClick={() => onSendReaction(emoji)}
              className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-sm transition-transform active:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Composer Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 shrink-0">
        <input
          type="text"
          dir="auto"
          disabled={chatLocked && localRole === 'student' && activeChannel === 'public'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            chatLocked && localRole === 'student' && activeChannel === 'public'
              ? 'Public chat locked by Host (Use Ask Host)...'
              : 'Type a message or formula...'
          }
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-black/30 border border-[var(--border-specular)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
        />
        <button
          type="submit"
          aria-label="Send chat message"
          disabled={!draft.trim()}
          className="px-3.5 py-2 rounded-xl bg-[#D4A373] text-[#0D0A08] font-semibold text-xs hover:bg-[#E6CCB2] disabled:opacity-40 transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
};

// ============================================================================
// 2. Chronological Raise-Hand Queue Pod
// ============================================================================
export interface RaiseHandQueuePodProps {
  participants: Participant[];
  localParticipantId: string;
  localRole: UserRole;
  onToggleHandRaise: (participantId: string) => void;
  onApproveStudentSpeaking: (participantId: string) => void;
}

export const RaiseHandQueuePod: React.FC<RaiseHandQueuePodProps> = ({
  participants,
  localParticipantId,
  localRole,
  onToggleHandRaise,
  onApproveStudentSpeaking,
}) => {
  const raisedList = participants
    .filter((p) => p.handRaised)
    .sort((a, b) => (a.handRaisedAt || 0) - (b.handRaisedAt || 0));

  const localUser = participants.find((p) => p.id === localParticipantId);
  const isHostOrAssistant = localRole === 'teacher' || localRole === 'assistant';

  return (
    <div className="flex flex-col h-full min-h-0 w-full gap-3">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="text-xs text-[var(--text-secondary)]">
          Waiting in Queue: <strong className="font-mono-tabular text-[#D4A373]">{raisedList.length}</strong>
        </div>
        <button
          type="button"
          onClick={() => onToggleHandRaise(localParticipantId)}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            localUser?.handRaised
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-[#D4A373] text-[#0D0A08]'
          }`}
        >
          <Hand className="w-3.5 h-3.5" />
          <span>{localUser?.handRaised ? 'Lower Hand' : 'Raise Hand'}</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {raisedList.length === 0 ? (
          <div className="h-36 flex flex-col items-center justify-center text-center p-4 rounded-xl bg-black/15 border border-[var(--border-specular)]">
            <Hand className="w-6 h-6 text-[#D4A373]/60 mb-2" />
            <p className="text-xs text-[var(--text-secondary)] font-medium">
              No hands currently raised
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Students who raise their hand appear in chronological order for 1-click Mic &amp; Pen elevation.
            </p>
          </div>
        ) : (
          raisedList.map((student, index) => {
            const waitedSec = Math.max(
              1,
              Math.round((Date.now() - (student.handRaisedAt || Date.now())) / 1000)
            );
            return (
              <div
                key={student.id}
                className="p-3 rounded-xl bg-black/25 border border-[var(--border-specular)] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono-tabular font-bold text-[#D4A373]">
                      #{index + 1}
                    </span>
                    <span
                      dir="auto"
                      className="text-xs font-semibold text-[var(--text-primary)] truncate"
                    >
                      {student.name}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5">
                    Waiting {waitedSec}s · {student.engagementXp} XP
                  </div>
                </div>

                {isHostOrAssistant && (
                  <button
                    type="button"
                    onClick={() => onApproveStudentSpeaking(student.id)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Grant Mic &amp; Pen</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 3. Live Timed Poll & Instant Quiz Pod
// ============================================================================
export interface PollPodProps {
  activePoll: LivePoll | null;
  localParticipantId: string;
  localRole: UserRole;
  onVotePoll: (optionIndex: number) => void;
  onStartNewPoll: (poll: LivePoll) => void;
  onToggleRevealAnswer: () => void;
}

export const PollPod: React.FC<PollPodProps> = ({
  activePoll,
  localParticipantId,
  localRole,
  onVotePoll,
  onStartNewPoll,
  onToggleRevealAnswer,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [questionDraft, setQuestionDraft] = useState('');
  const [optionsDraft, setOptionsDraft] = useState(['', '', '']);
  const [correctIdxDraft, setCorrectIdxDraft] = useState<number>(0);

  const isHostOrAssistant = localRole === 'teacher' || localRole === 'assistant';
  const breakdown = activePoll
    ? computePollBreakdown(activePoll)
    : { totalVotes: 0, counts: [], percentages: [] };
  const myVote = activePoll?.votes?.[localParticipantId];

  const handleLaunchPoll = (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = optionsDraft.map((o) => o.trim()).filter((o) => o.length > 0);
    if (!questionDraft.trim() || validOptions.length < 2) return;
    const newPoll: LivePoll = {
      id: `poll-${Date.now()}`,
      question: questionDraft.trim(),
      options: validOptions.map((text, idx) => ({ id: `opt-${idx}`, text })),
      correctOptionIndex: correctIdxDraft < validOptions.length ? correctIdxDraft : 0,
      revealAnswer: false,
      isActive: true,
      durationSeconds: 60,
      createdAt: Date.now(),
      votes: {},
    };
    onStartNewPoll(newPoll);
    setQuestionDraft('');
    setOptionsDraft(['', '', '']);
    setIsCreating(false);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full gap-3">
      {isHostOrAssistant && (
        <div className="flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsCreating((v) => !v)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#D4A373] text-[#0D0A08] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{isCreating ? 'Cancel' : 'New Quiz Question'}</span>
          </button>
          {activePoll && !isCreating && (
            <button
              type="button"
              onClick={onToggleRevealAnswer}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--border-specular)] inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5 text-[#D4A373]" />
              <span>{activePoll.revealAnswer ? 'Hide Key' : 'Reveal Key'}</span>
            </button>
          )}
        </div>
      )}

      {isCreating ? (
        <form onSubmit={handleLaunchPoll} className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">
              Question
            </label>
            <textarea
              dir="auto"
              rows={2}
              required
              placeholder="Enter quiz or poll question..."
              value={questionDraft}
              onChange={(e) => setQuestionDraft(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-black/30 border border-[var(--border-specular)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
            />
          </div>
          {optionsDraft.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="radio"
                name="correctOpt"
                checked={correctIdxDraft === idx}
                onChange={() => setCorrectIdxDraft(idx)}
                className="accent-[#D4A373]"
                title="Mark as correct answer"
              />
              <input
                type="text"
                dir="auto"
                placeholder={`Option ${idx + 1}`}
                value={opt}
                onChange={(e) => {
                  const copy = [...optionsDraft];
                  copy[idx] = e.target.value;
                  setOptionsDraft(copy);
                }}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/30 border border-[var(--border-specular)] text-xs text-[var(--text-primary)]"
              />
            </div>
          ))}
          <button
            type="submit"
            className="w-full py-2 rounded-xl bg-[#D4A373] text-[#0D0A08] font-semibold text-xs hover:bg-[#E6CCB2] transition-colors"
          >
            Broadcast Live Quiz
          </button>
        </form>
      ) : activePoll ? (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          <div className="p-3 rounded-xl bg-black/25 border border-[var(--border-specular)]">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono-tabular mb-1.5">
              <span className="inline-flex items-center gap-1 text-[#D4A373]">
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Live Assessment</span>
              </span>
              <span>{breakdown.totalVotes} Responses</span>
            </div>
            <p dir="auto" className="text-xs font-semibold text-[var(--text-primary)] leading-relaxed">
              {activePoll.question}
            </p>
          </div>

          <div className="space-y-2">
            {activePoll.options.map((option, idx) => {
              const pct = breakdown.percentages[idx] || 0;
              const count = breakdown.counts[idx] || 0;
              const isSelected = myVote === idx;
              const isCorrect = activePoll.revealAnswer && activePoll.correctOptionIndex === idx;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onVotePoll(idx)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all relative overflow-hidden ${
                    isCorrect
                      ? 'border-emerald-500/60 bg-emerald-500/10'
                      : isSelected
                      ? 'border-[#D4A373] bg-[#D4A373]/15'
                      : 'border-[var(--border-specular)] bg-black/20 hover:bg-black/30'
                  }`}
                >
                  {/* Animated progress fill bar */}
                  <div
                    className={`absolute inset-y-0 left-0 transition-all duration-300 pointer-events-none ${
                      isCorrect ? 'bg-emerald-500/20' : 'bg-[#D4A373]/15'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-2">
                    <span dir="auto" className="text-xs text-[var(--text-primary)] font-medium">
                      {option.text}
                    </span>
                    <span className="text-xs font-mono-tabular font-semibold text-[#D4A373] shrink-0">
                      {pct}% ({count})
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4 rounded-xl bg-black/15 border border-[var(--border-specular)]">
          <BarChart3 className="w-6 h-6 text-[#D4A373]/60 mb-2" />
          <p className="text-xs text-[var(--text-secondary)] font-medium">
            No active poll in this room
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {isHostOrAssistant
              ? 'Click "New Quiz Question" above to launch a live poll.'
              : 'When the instructor launches a poll, it will appear here.'}
          </p>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 4. Cloud File Vault Pod (R2 Integrated)
// ============================================================================
export interface FileVaultPodProps {
  files: SharedFileItem[];
  localParticipantName: string;
  onUploadFile: (file: SharedFileItem) => void;
  onDownloadFile: (file: SharedFileItem) => void;
}

export const FileVaultPod: React.FC<FileVaultPodProps> = ({
  files,
  localParticipantName,
  onUploadFile,
  onDownloadFile,
}) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const newItem: SharedFileItem = {
        id: `file-${Date.now()}`,
        fileName: f.name,
        fileSize: f.size,
        mimeType: f.type || 'application/octet-stream',
        r2Key: `rooms/${f.name}`,
        uploadedBy: localParticipantName,
        downloads: 0,
        uploadedAt: Date.now(),
        dataUrl: typeof reader.result === 'string' ? reader.result : undefined,
      };
      onUploadFile(newItem);
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full gap-3">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs text-[var(--text-secondary)]">
          Shared Files · <strong className="font-mono-tabular">{files.length}</strong>
        </span>
        <label className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#D4A373] text-[#0D0A08] hover:bg-[#E6CCB2] cursor-pointer inline-flex items-center gap-1.5 transition-colors whitespace-nowrap">
          <Upload className="w-3.5 h-3.5" />
          <span>Upload File</span>
          <input type="file" onChange={handleFileChange} className="hidden" />
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {files.length === 0 ? (
          <div className="h-36 flex flex-col items-center justify-center text-center p-4 rounded-xl bg-black/15 border border-[var(--border-specular)]">
            <FolderOpen className="w-6 h-6 text-[#D4A373]/60 mb-2" />
            <p className="text-xs text-[var(--text-secondary)] font-medium">
              No files uploaded yet
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Upload a PDF, image, or worksheet to share it with connected participants.
            </p>
          </div>
        ) : (
          files.map((item) => (
            <div
              key={item.id}
              className="p-2.5 rounded-xl bg-black/20 border border-[var(--border-specular)] flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#D4A373]/15 border border-[#D4A373]/30 flex items-center justify-center shrink-0 text-[#D4A373]">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {item.fileName}
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                    {(item.fileSize / 1024).toFixed(1)} KB · {item.downloads} downloads
                  </div>
                </div>
              </div>

              <button
                type="button"
                aria-label={`Download ${item.fileName}`}
                onClick={() => onDownloadFile(item)}
                className="p-2 rounded-lg bg-white/5 hover:bg-[#D4A373]/20 text-[#D4A373] border border-[var(--border-specular)] transition-colors shrink-0"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
