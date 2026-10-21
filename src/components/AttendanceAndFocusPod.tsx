import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PenTool,
  BellRing,
  FileSpreadsheet,
  Printer,
  Search,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import type { LivePoll, Participant, RollCallSession, UserRole } from '../types/classroom';
import { generateAttendanceCsvWithBom } from '../utils/classroomRules';

export interface AttendanceAndFocusPodProps {
  roomName: string;
  participants: Participant[];
  localRole: UserRole;
  activePoll: LivePoll | null;
  activeRollCall: RollCallSession | null;
  onTogglePermission: (participantId: string, permission: 'mic' | 'cam' | 'pen') => void;
  onTriggerRollCall: () => void;
  onSimulateStudentTabSwitch?: (participantId: string) => void;
}

export const AttendanceAndFocusPod: React.FC<AttendanceAndFocusPodProps> = ({
  roomName,
  participants,
  localRole,
  activePoll,
  activeRollCall,
  onTogglePermission,
  onTriggerRollCall,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFocus, setFilterFocus] = useState<'all' | 'focused' | 'away'>('all');
  const [exportSuccessText, setExportSuccessText] = useState<string | null>(null);

  const isHostOrAssistant = localRole === 'teacher' || localRole === 'assistant';

  const filteredList = participants.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterFocus === 'focused') return p.focusState === 'focused';
    if (filterFocus === 'away') return p.focusState !== 'focused';
    return true;
  });

  const focusedCount = participants.filter((p) => p.focusState === 'focused').length;
  const focusPercentage =
    participants.length > 0 ? Math.round((focusedCount / participants.length) * 100) : 100;

  // Export UTF-8 BOM CSV for Excel
  const handleDownloadCsv = () => {
    const csvContent = generateAttendanceCsvWithBom(roomName, participants, activePoll);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `B2Connect_Attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setExportSuccessText('CSV with UTF-8 BOM exported');
    setTimeout(() => setExportSuccessText(null), 3500);
  };

  // Generate Printable HTML Report in an inline modal/print frame without window.open
  const handlePrintReport = () => {
    window.print();
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full gap-3">
      {/* Top Focus Telemetry Summary Strip */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        <div className="p-2.5 rounded-xl bg-black/20 border border-[var(--border-specular)]">
          <div className="text-[11px] text-[var(--text-muted)]">Present Roster</div>
          <div className="text-base font-bold font-mono-tabular text-[var(--text-primary)] mt-0.5">
            {participants.length} <span className="text-xs font-normal text-[var(--text-muted)]">/ 30</span>
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-black/20 border border-[var(--border-specular)]">
          <div className="text-[11px] text-[var(--text-muted)]">Focus Radar</div>
          <div className="text-base font-bold font-mono-tabular text-emerald-400 mt-0.5">
            {focusPercentage}% <span className="text-xs font-normal text-[var(--text-muted)]">Active</span>
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-black/20 border border-[var(--border-specular)]">
          <div className="text-[11px] text-[var(--text-muted)]">Avg Class XP</div>
          <div className="text-base font-bold font-mono-tabular text-[#D4A373] mt-0.5">
            {Math.round(
              participants.reduce((acc, p) => acc + p.engagementXp, 0) /
                Math.max(1, participants.length)
            )}{' '}
            <span className="text-xs font-normal">XP</span>
          </div>
        </div>
      </div>

      {/* Host Actions: 30s Roll-Call Trigger & UTF-8 CSV Export */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {isHostOrAssistant && (
          <button
            type="button"
            onClick={onTriggerRollCall}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#D4A373] text-[#0D0A08] hover:bg-[#E6CCB2] transition-colors whitespace-nowrap"
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>30s Roll-Call Check</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleDownloadCsv}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--border-specular)] transition-colors whitespace-nowrap"
          title="Export Excel UTF-8 BOM CSV"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-[#D4A373]" />
          <span>Export CSV</span>
        </button>
        <button
          type="button"
          onClick={handlePrintReport}
          aria-label="Print Attendance Report"
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] border border-[var(--border-specular)] transition-colors"
          title="Print Report"
        >
          <Printer className="w-3.5 h-3.5" />
        </button>
      </div>

      {exportSuccessText && (
        <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{exportSuccessText}</span>
        </div>
      )}

      {activeRollCall && (
        <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-2 shrink-0">
          <span className="font-medium">
            Roll-Call Active: {activeRollCall.verifiedIds.length}/{participants.length} verified
          </span>
          <span className="font-mono-tabular text-[#D4A373]">Live</span>
        </div>
      )}

      {/* Search & Focus Filter Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            dir="auto"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter participant..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-black/25 border border-[var(--border-specular)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
          />
        </div>
        <div className="flex items-center gap-1 bg-black/25 p-1 rounded-lg border border-[var(--border-specular)]">
          {(['all', 'focused', 'away'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterFocus(mode)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium capitalize transition-colors whitespace-nowrap ${
                filterFocus === mode
                  ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Participant & Focus Radar List */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
        {filteredList.map((p) => {
          const isFocused = p.focusState === 'focused';
          const isAway = p.focusState === 'away';

          return (
            <div
              key={p.id}
              className="p-2.5 rounded-xl bg-black/20 hover:bg-black/30 border border-[var(--border-specular)] transition-colors flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      dir="auto"
                      className="text-xs font-semibold text-[var(--text-primary)] truncate"
                    >
                      {p.name}
                    </span>
                    {p.handRaised && (
                      <span className="text-xs text-amber-400 font-medium" title="Hand Raised">
                        ✋
                      </span>
                    )}
                  </div>

                  {/* Unboxed clean metadata line */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)] mt-0.5 font-mono-tabular">
                    <span className="capitalize">{p.role}</span>
                    <span aria-hidden="true">·</span>
                    <span>{p.activeMinutes.toFixed(0)}m</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#D4A373] font-medium">{p.engagementXp} XP</span>
                  </div>
                </div>

                {/* Semantic Focus Radar State with Icon + Text */}
                <div className="flex flex-col items-end shrink-0 text-[11px]">
                  {isFocused ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Focused</span>
                    </span>
                  ) : isAway ? (
                    <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Tab Switched ({p.tabSwitches})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                      <Eye className="w-3.5 h-3.5" />
                      <span>Idle ({p.tabSwitches})</span>
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular mt-0.5">
                    {p.rollCallVerified ? 'Roll-Call: Verified' : 'Roll-Call: Pending'}
                  </span>
                </div>
              </div>

              {/* 1-Click Teacher Elevation Permissions (Mic, Cam, Whiteboard Pen) */}
              {isHostOrAssistant && p.role === 'student' && (
                <div className="flex items-center justify-between pt-1.5 border-t border-white/5">
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Tab switches: <strong className="font-mono-tabular">{p.tabSwitches}</strong>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Toggle Microphone permission for ${p.name}`}
                      onClick={() => onTogglePermission(p.id, 'mic')}
                      className={`px-2 py-1 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors ${
                        p.micGranted
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {p.micGranted ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                      <span>Mic</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Toggle Camera permission for ${p.name}`}
                      onClick={() => onTogglePermission(p.id, 'cam')}
                      className={`px-2 py-1 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors ${
                        p.camGranted
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {p.camGranted ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                      <span>Cam</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Toggle Whiteboard Pen permission for ${p.name}`}
                      onClick={() => onTogglePermission(p.id, 'pen')}
                      className={`px-2 py-1 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors ${
                        p.penGranted
                          ? 'bg-[#D4A373]/25 text-[#D4A373] border border-[#D4A373]/40'
                          : 'bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <PenTool className="w-3 h-3" />
                      <span>Pen</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AttendanceAndFocusPod;
