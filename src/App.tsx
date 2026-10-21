import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  CircleDot,
  CloudRain,
  Volume2,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  Users,
  MessageSquare,
  BarChart3,
  Hand,
  FolderOpen,
  LayoutGrid,
  ShieldAlert,
  LogOut,
  Copy,
  Plus,
  Sparkles,
  X,
  Sliders,
  Lock,
  Trash2,
} from 'lucide-react';
import BrandLogo from './components/BrandLogo';
import WhiteboardPod from './components/WhiteboardPod';
import AttendanceAndFocusPod from './components/AttendanceAndFocusPod';
import {
  ChatPod,
  RaiseHandQueuePod,
  PollPod,
  FileVaultPod,
} from './components/InteractivePods';
import {
  roomEngine,
  fetchRoomsDirectory,
  createRoomOnServer,
  deleteRoomOnServer,
} from './services/roomEngine';
import { rainAudioEngine, RainBackdropCanvas } from './utils/rainAudioEngine';
import { updateDynamicFavicon } from './utils/faviconManager';
import type {
  ClassroomSummary,
  ConnectionState,
  EmojiReactionEvent,
  LaserPointerPosition,
  PodLayoutMode,
  RainIntensity,
  RoomStateSnapshot,
  ThemeMode,
  UserRole,
} from './types/classroom';

type ActiveSidebarTab = 'attendance' | 'chat' | 'polls' | 'hands' | 'files';

export default function App() {
  const urlParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialAutostart = urlParams?.get('autostart') === '1';
  const initialRoleParam = (urlParams?.get('role') as UserRole) || 'teacher';
  const initialRoomParam = urlParams?.get('room') || '';
  const initialNameParam = urlParams?.get('name') || '';

  const [inClassroom, setInClassroom] = useState<boolean>(initialAutostart);
  const [showAdminCenter, setShowAdminCenter] = useState<boolean>(false);
  const [showAtmospherePopover, setShowAtmospherePopover] = useState<boolean>(false);

  // Real User Identity & Session Configuration
  const [userName, setUserName] = useState<string>(initialNameParam);
  const [roomTitleInput, setRoomTitleInput] = useState<string>('');
  const [roomSubjectInput, setRoomSubjectInput] = useState<string>('');
  const [userRole, setUserRole] = useState<UserRole>(initialRoleParam);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(initialRoomParam);
  const [formError, setFormError] = useState<string | null>(null);

  // Theme & Rain Atmosphere State
  const [theme, setTheme] = useState<ThemeMode>('espresso');
  const [rainIntensity, setRainIntensity] = useState<RainIntensity>('drizzle');
  const [rainVolume, setRainVolume] = useState<number>(0);

  // Real Server-Backed Rooms Directory (Starts empty until rooms are created)
  const [roomsDirectory, setRoomsDirectory] = useState<ClassroomSummary[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState<boolean>(true);
  const [adminSearch, setAdminSearch] = useState<string>('');
  const [newRoomTitle, setNewRoomTitle] = useState<string>('');
  const [newRoomSubject, setNewRoomSubject] = useState<string>('');

  // Synchronized Classroom Engine State
  const [roomState, setRoomState] = useState<RoomStateSnapshot>(() => roomEngine.getState());
  const [connState, setConnState] = useState<ConnectionState>(() =>
    roomEngine.getConnectionState()
  );
  const [remoteLaser, setRemoteLaser] = useState<LaserPointerPosition | null>(null);
  const [floatingReactions, setFloatingReactions] = useState<EmojiReactionEvent[]>([]);

  // Workspace Layout & Responsive State
  const [activeTab, setActiveTab] = useState<ActiveSidebarTab>('attendance');
  const [mobileSheetTab, setMobileSheetTab] = useState<ActiveSidebarTab | null>(null);
  const [zenMode, setZenMode] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Synced Class Timer State (Starts paused until started by user)
  const [timerSeconds, setTimerSeconds] = useState<number>(1500);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);

  // Mobile Floating PiP Video Card State
  const [pipMinimized, setPipMinimized] = useState<boolean>(false);
  const [pipCorner, setPipCorner] = useState<'top-right' | 'bottom-right' | 'top-left'>('top-right');

  // Refs for Media & Canvas Recording
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const whiteboardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const participantIdRef = useRef<string>(
    `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  );

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3800);
  };

  const refreshRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    const list = await fetchRoomsDirectory();
    setRoomsDirectory(list);
    setIsLoadingRooms(false);
  }, []);

  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  // Sync theme attribute on document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Subscribe to B2RoomEngine updates
  useEffect(() => {
    const unsubRoom = roomEngine.subscribe((next) => setRoomState({ ...next }));
    const unsubConn = roomEngine.subscribeConnection((c) => setConnState(c));
    const unsubLaser = roomEngine.subscribeLaser((l) => setRemoteLaser(l));
    const unsubReact = roomEngine.subscribeReactions((reaction) => {
      setFloatingReactions((prev) => [...prev.slice(-10), reaction]);
      window.setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 2800);
    });

    return () => {
      unsubRoom();
      unsubConn();
      unsubLaser();
      unsubReact();
    };
  }, []);

  // Connect to room when inClassroom becomes true
  useEffect(() => {
    if (!inClassroom) return;
    const existingRoom = roomsDirectory.find((r) => r.id === selectedRoomId);
    const activeRoomId = selectedRoomId || 'room-live';
    const activeRoomName =
      existingRoom?.name || roomTitleInput.trim() || `Room ${activeRoomId.toUpperCase()}`;
    const activeSubject = existingRoom?.subject || roomSubjectInput.trim() || 'Live Session';
    const activeUserName = userName.trim() || 'Host';

    roomEngine.connectToRoom({
      roomId: activeRoomId,
      roomName: activeRoomName,
      subject: activeSubject,
      participantId: participantIdRef.current,
      participantName: activeUserName,
      role: userRole,
    });

    return () => {
      roomEngine.disconnect();
    };
  }, [
    inClassroom,
    selectedRoomId,
    roomTitleInput,
    roomSubjectInput,
    userName,
    userRole,
    roomsDirectory,
  ]);

  // Anti-Cheat Focus Radar: Detect Tab Switch (`visibilitychange`) and Window Blur
  useEffect(() => {
    if (!inClassroom) return;
    const pid = roomEngine.getLocalParticipantId();

    const handleVisibility = () => {
      if (document.hidden) {
        roomEngine.updateFocusState(pid, 'away');
      } else {
        roomEngine.updateFocusState(pid, 'focused');
      }
    };

    const handleWindowBlur = () => {
      roomEngine.updateFocusState(pid, 'away');
    };

    const handleWindowFocus = () => {
      roomEngine.updateFocusState(pid, 'focused');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [inClassroom]);

  // Dynamic Canvas Favicon Status Sync
  useEffect(() => {
    const participantsList = Object.values(roomState.participants);
    const anyHandRaised = participantsList.some((p) => p.handRaised);
    if (!inClassroom) {
      updateDynamicFavicon('idle');
    } else if (isRecording) {
      updateDynamicFavicon('recording');
    } else if (roomState.activeRollCall || anyHandRaised) {
      updateDynamicFavicon('attention');
    } else {
      updateDynamicFavicon('connected');
    }
  }, [inClassroom, isRecording, roomState.activeRollCall, roomState.participants]);

  // Synced Class Countdown Timer
  useEffect(() => {
    if (!inClassroom || !timerRunning) return;
    const interval = window.setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          rainAudioEngine.playChime('timer');
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [inClassroom, timerRunning]);

  // Clean up local camera/screen tracks on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      rainAudioEngine.stopRain();
    };
  }, []);

  const handleJoinClassroom = async (
    roomOverride?: ClassroomSummary,
    roleOverride?: UserRole
  ) => {
    setFormError(null);
    const trimmedName = userName.trim();
    if (!trimmedName) {
      setFormError('Please enter your display name before entering a classroom.');
      return;
    }

    const chosenRole = roleOverride || userRole;
    if (roomOverride) {
      setSelectedRoomId(roomOverride.id);
      setRoomTitleInput(roomOverride.name);
      setRoomSubjectInput(roomOverride.subject);
      setUserRole(chosenRole);
      setShowAdminCenter(false);
      setInClassroom(true);
      if (rainVolume > 0 && rainIntensity !== 'off') {
        rainAudioEngine.setRainConfig(rainIntensity, rainVolume);
      }
      return;
    }

    // Check if an existing room is selected
    const existing = roomsDirectory.find((r) => r.id === selectedRoomId);
    if (existing) {
      setRoomTitleInput(existing.name);
      setRoomSubjectInput(existing.subject);
      setUserRole(chosenRole);
      setShowAdminCenter(false);
      setInClassroom(true);
      if (rainVolume > 0 && rainIntensity !== 'off') {
        rainAudioEngine.setRainConfig(rainIntensity, rainVolume);
      }
      return;
    }

    // Otherwise create a new room on the server from roomTitleInput
    const trimmedRoomTitle = roomTitleInput.trim();
    if (!trimmedRoomTitle) {
      setFormError('Please enter a classroom name or select an existing classroom.');
      return;
    }

    const created = await createRoomOnServer({
      name: trimmedRoomTitle,
      subject: roomSubjectInput.trim() || 'General Session',
      instructorName: trimmedName,
      capacity: 30,
    });

    if (created) {
      await refreshRooms();
      setSelectedRoomId(created.id);
    } else {
      setSelectedRoomId(`rm-${Date.now().toString(36)}`);
    }

    setUserRole(chosenRole);
    setShowAdminCenter(false);
    setInClassroom(true);

    if (rainVolume > 0 && rainIntensity !== 'off') {
      rainAudioEngine.setRainConfig(rainIntensity, rainVolume);
    }
  };

  // Screen Share with Mobile Compatibility Guard
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setIsScreenSharing(false);
      showToast('Screen share ended.');
      return;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      showToast(
        'Screen sharing is not supported on mobile browsers. Use Slide Image Upload or the 16:9 Vector Whiteboard instead.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setIsScreenSharing(true);
      stream.getVideoTracks()[0].onended = () => {
        setIsScreenSharing(false);
      };
      showToast('Broadcasting live screen share to classroom.');
    } catch {
      showToast('Screen share cancelled or blocked by browser permissions.');
    }
  };

  // Zero-Cost Local Class `.webm` Recorder
  const handleToggleRecording = () => {
    if (isRecording) {
      roomEngine.stopCanvasRecording();
      setIsRecording(false);
      showToast('Class recording saved as .webm video file.');
    } else {
      const started = roomEngine.startCanvasRecording(whiteboardCanvasRef.current);
      if (started) {
        setIsRecording(true);
        showToast('Recording live 16:9 Whiteboard & Class session locally...');
      } else {
        setIsRecording(true);
        showToast('Recording indicator active.');
      }
    }
  };

  const handleCreateAdminRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomTitle.trim()) return;
    const created = await createRoomOnServer({
      name: newRoomTitle.trim(),
      subject: newRoomSubject.trim() || 'General Session',
      instructorName: userName.trim() || 'Instructor',
      capacity: 30,
    });
    if (created) {
      setNewRoomTitle('');
      setNewRoomSubject('');
      await refreshRooms();
      setSelectedRoomId(created.id);
      showToast(`Created room "${created.name}" (${created.code})`);
    }
  };

  const handleDeleteAdminRoom = async (roomId: string, roomName: string) => {
    const ok = await deleteRoomOnServer(roomId);
    if (ok) {
      if (selectedRoomId === roomId) setSelectedRoomId('');
      await refreshRooms();
      showToast(`Deleted room "${roomName}"`);
    }
  };

  const handleCopyInviteLink = (room: ClassroomSummary, role: UserRole) => {
    const link = `${window.location.origin}/?room=${encodeURIComponent(
      room.id
    )}&role=${encodeURIComponent(role)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    showToast(`Copied ${role.toUpperCase()} invite link for ${room.code}`);
  };

  const participantsArray = Object.values(roomState.participants);
  const localParticipantId = roomEngine.getLocalParticipantId();
  const localParticipant = roomState.participants[localParticipantId];
  const hostParticipant =
    participantsArray.find((p) => p.role === 'teacher') || localParticipant;
  const raisedHandsCount = participantsArray.filter((p) => p.handRaised).length;
  const canDrawOnBoard =
    userRole === 'teacher' ||
    userRole === 'assistant' ||
    Boolean(localParticipant?.penGranted);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ============================================================================
  // VIEW 1: BRANDED LOBBY & REAL ROOM COMMAND CENTER
  // ============================================================================
  if (!inClassroom) {
    const currentSelectedRoom = roomsDirectory.find((r) => r.id === selectedRoomId) || null;

    return (
      <div className="relative h-[100dvh] max-h-[100dvh] w-screen overflow-y-auto overflow-x-hidden flex flex-col justify-between p-4 sm:p-6 lg:p-8 select-none">
        <RainBackdropCanvas intensity={rainIntensity} theme={theme} />

        {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav Links | Zone 3 Primary Action */}
        <header className="relative z-20 flex items-center justify-between gap-8 max-w-7xl w-full mx-auto b2-glass-pod rounded-2xl px-5 py-3.5 shrink-0">
          <BrandLogo size="md" showText={true} />

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-[var(--text-secondary)]">
            <button
              type="button"
              onClick={() => setShowAdminCenter(false)}
              className={`hover:text-[var(--text-primary)] transition-colors whitespace-nowrap shrink-0 ${
                !showAdminCenter ? 'text-[#D4A373] font-semibold' : ''
              }`}
            >
              Classroom Studio
            </button>
            <button
              type="button"
              onClick={() => {
                refreshRooms();
                setShowAdminCenter(true);
              }}
              className={`hover:text-[var(--text-primary)] transition-colors whitespace-nowrap shrink-0 ${
                showAdminCenter ? 'text-[#D4A373] font-semibold' : ''
              }`}
            >
              Room Management ({roomsDirectory.length})
            </button>
            <button
              type="button"
              onClick={() =>
                setTheme((t) =>
                  t === 'espresso' ? 'noir' : t === 'noir' ? 'daylight' : 'espresso'
                )
              }
              className="hover:text-[var(--text-primary)] transition-colors whitespace-nowrap shrink-0"
            >
              Theme: {theme === 'espresso' ? 'Rainy Espresso' : theme === 'noir' ? 'Obsidian Noir' : 'Ivory Daylight'}
            </button>
            <button
              type="button"
              onClick={() => {
                const nextRain: RainIntensity =
                  rainIntensity === 'drizzle'
                    ? 'storm'
                    : rainIntensity === 'storm'
                    ? 'off'
                    : 'drizzle';
                setRainIntensity(nextRain);
                const nextVol = nextRain === 'off' ? 0 : Math.max(0.35, rainVolume);
                setRainVolume(nextVol);
                rainAudioEngine.setRainConfig(nextRain, nextVol);
              }}
              className="hover:text-[var(--text-primary)] transition-colors whitespace-nowrap shrink-0"
            >
              Rain: {rainIntensity.toUpperCase()}
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleJoinClassroom()}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#D4A373] text-[#0D0A08] hover:bg-[#E6CCB2] transition-colors whitespace-nowrap shrink-0 shadow-md"
            >
              Start / Join Session
            </button>
          </div>
        </header>

        {/* Main Content Area: Either Lobby Onboarding Split OR Real Room Command Center */}
        <main className="relative z-10 max-w-7xl w-full mx-auto my-auto py-6">
          {showAdminCenter ? (
            <div className="b2-glass-pod rounded-3xl p-5 sm:p-7 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-specular)] pb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                    Room Command Center
                  </h1>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    Create, manage, and monitor active classrooms. Only real created rooms are listed below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdminCenter(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--border-specular)]"
                >
                  Back to Lobby
                </button>
              </div>

              {/* Create New Real Room Form & Filter Bar */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                <form
                  onSubmit={handleCreateAdminRoom}
                  className="lg:col-span-8 flex flex-wrap sm:flex-nowrap items-center gap-2"
                >
                  <input
                    type="text"
                    dir="auto"
                    required
                    value={newRoomTitle}
                    onChange={(e) => setNewRoomTitle(e.target.value)}
                    placeholder="Room title (e.g., Quantum Mechanics 101)..."
                    className="flex-1 min-w-[180px] px-3.5 py-2 rounded-xl bg-black/30 border border-[var(--border-specular)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                  />
                  <input
                    type="text"
                    dir="auto"
                    value={newRoomSubject}
                    onChange={(e) => setNewRoomSubject(e.target.value)}
                    placeholder="Subject (optional)..."
                    className="w-44 px-3 py-2 rounded-xl bg-black/30 border border-[var(--border-specular)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#D4A373] text-[#0D0A08] hover:bg-[#E6CCB2] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Room</span>
                  </button>
                </form>

                <div className="lg:col-span-4">
                  <input
                    type="text"
                    dir="auto"
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    placeholder="Filter created rooms..."
                    className="w-full px-3.5 py-2 rounded-xl bg-black/30 border border-[var(--border-specular)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                  />
                </div>
              </div>

              {/* Real Rooms Directory Table or Clean Empty State */}
              {roomsDirectory.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border-specular)] bg-black/20 p-10 text-center space-y-2">
                  <LayoutGrid className="w-8 h-8 text-[#D4A373]/70 mx-auto" />
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    No Rooms Created Yet
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                    Use the form above to create your first classroom. Once created, you can copy invite links or launch the session directly.
                  </p>
                </div>
              ) : (
                <div className="max-h-[52dvh] overflow-y-auto rounded-2xl border border-[var(--border-specular)] bg-black/20">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#14100E] text-[11px] text-[var(--text-muted)] border-b border-[var(--border-specular)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Code</th>
                        <th className="py-2.5 px-3 font-medium">Classroom &amp; Subject</th>
                        <th className="py-2.5 px-3 font-medium">Instructor</th>
                        <th className="py-2.5 px-3 font-medium text-right">Online</th>
                        <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs">
                      {roomsDirectory
                        .filter(
                          (r) =>
                            r.name.toLowerCase().includes(adminSearch.toLowerCase()) ||
                            r.code.toLowerCase().includes(adminSearch.toLowerCase()) ||
                            r.instructorName.toLowerCase().includes(adminSearch.toLowerCase())
                        )
                        .map((room) => (
                          <tr key={room.id} className="hover:bg-white/5 transition-colors">
                            <td className="py-2.5 px-3 font-mono-tabular font-semibold text-[#D4A373] whitespace-nowrap">
                              {room.code}
                            </td>
                            <td className="py-2.5 px-3">
                              <div dir="auto" className="font-semibold text-[var(--text-primary)]">
                                {room.name}
                              </div>
                              <div dir="auto" className="text-[11px] text-[var(--text-muted)]">
                                {room.subject} · {room.status.toUpperCase()}
                              </div>
                            </td>
                            <td
                              dir="auto"
                              className="py-2.5 px-3 text-[var(--text-secondary)] whitespace-nowrap"
                            >
                              {room.instructorName}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-tabular text-[var(--text-primary)] whitespace-nowrap">
                              {room.activeParticipants}/{room.capacity}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleCopyInviteLink(room, 'student')}
                                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-[var(--text-secondary)] inline-flex items-center gap-1"
                                  title="Copy Student Invite Link"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Student Link</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyInviteLink(room, 'teacher')}
                                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-[#D4A373] inline-flex items-center gap-1"
                                  title="Copy Host Invite Link"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Host Link</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleJoinClassroom(room, userRole)}
                                  className="px-2.5 py-1 rounded-lg bg-[#D4A373] text-[#0D0A08] font-semibold text-[11px] hover:bg-[#E6CCB2]"
                                >
                                  Enter
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Delete room ${room.name}`}
                                  onClick={() => handleDeleteAdminRoom(room.id, room.name)}
                                  className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300"
                                  title="Delete Room"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left Column: Architectural Hero & Real Classroom Creation / Join Form */}
              <div className="lg:col-span-7 b2-glass-pod rounded-3xl p-6 sm:p-8 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="text-xs font-medium text-[#D4A373] tracking-wide">
                    B2.Connect · Real-Time Virtual Classroom &amp; STEM Studio
                  </div>
                  <h1
                    className="text-2xl sm:text-4xl font-extrabold tracking-tight text-[var(--text-primary)] leading-tight"
                    style={{ textWrap: 'balance' }}
                  >
                    Create or Join a Live Classroom Session.
                  </h1>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                    16:9 normalized vector whiteboard, PDF &amp; resizable image studio, live Focus Radar telemetry, and local WebM recording.
                  </p>
                </div>

                {/* Real Join / Create Configuration Form */}
                <div className="space-y-4 pt-3 border-t border-[var(--border-specular)]">
                  {formError && (
                    <div
                      role="alert"
                      className="px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium"
                    >
                      {formError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="lobby-name-input"
                        className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                      >
                        Your Display Name
                      </label>
                      <input
                        id="lobby-name-input"
                        type="text"
                        dir="auto"
                        placeholder="Enter your name..."
                        value={userName}
                        onChange={(e) => {
                          setUserName(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/30 border border-[var(--border-specular)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                      />
                    </div>

                    {roomsDirectory.length > 0 ? (
                      <div>
                        <label
                          htmlFor="lobby-room-select"
                          className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                        >
                          Select Existing Room or Create New
                        </label>
                        <select
                          id="lobby-room-select"
                          value={selectedRoomId}
                          onChange={(e) => {
                            setSelectedRoomId(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-[#14100E] border border-[var(--border-specular)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                        >
                          <option value="">+ Create a New Classroom</option>
                          {roomsDirectory.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.code} — {room.name} ({room.activeParticipants}/{room.capacity})
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label
                          htmlFor="lobby-room-title"
                          className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                        >
                          Classroom Name
                        </label>
                        <input
                          id="lobby-room-title"
                          type="text"
                          dir="auto"
                          placeholder="e.g., Physics 101 — Lecture 1"
                          value={roomTitleInput}
                          onChange={(e) => {
                            setRoomTitleInput(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-black/30 border border-[var(--border-specular)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                        />
                      </div>
                    )}
                  </div>

                  {roomsDirectory.length > 0 && !selectedRoomId && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="lobby-new-room-title"
                          className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                        >
                          New Classroom Name
                        </label>
                        <input
                          id="lobby-new-room-title"
                          type="text"
                          dir="auto"
                          placeholder="Enter classroom name..."
                          value={roomTitleInput}
                          onChange={(e) => {
                            setRoomTitleInput(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-black/30 border border-[var(--border-specular)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="lobby-new-room-subject"
                          className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                        >
                          Subject (Optional)
                        </label>
                        <input
                          id="lobby-new-room-subject"
                          type="text"
                          dir="auto"
                          placeholder="Enter subject..."
                          value={roomSubjectInput}
                          onChange={(e) => setRoomSubjectInput(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-black/30 border border-[var(--border-specular)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D4A373]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Role Selector */}
                  <div>
                    <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      Role
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'teacher', label: 'Teacher / Host', desc: 'Full Stage & Controls' },
                          { id: 'assistant', label: 'Co-Host / TA', desc: 'Moderation & Board Pen' },
                          { id: 'student', label: 'Student', desc: 'Participant' },
                        ] as { id: UserRole; label: string; desc: string }[]
                      ).map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setUserRole(r.id)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            userRole === r.id
                              ? 'bg-[#D4A373]/20 border-[#D4A373] text-[var(--text-primary)]'
                              : 'bg-black/20 border-[var(--border-specular)] text-[var(--text-secondary)] hover:bg-white/5'
                          }`}
                        >
                          <div className="text-xs font-bold">{r.label}</div>
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
                            {r.desc}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleJoinClassroom()}
                      className="flex-1 min-w-[200px] py-3 px-5 rounded-xl bg-[#D4A373] text-[#0D0A08] font-bold text-sm hover:bg-[#E6CCB2] transition-colors shadow-lg"
                    >
                      {currentSelectedRoom
                        ? `Join Classroom (${currentSelectedRoom.code})`
                        : 'Create & Enter Classroom'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        refreshRooms();
                        setShowAdminCenter(true);
                      }}
                      className="py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-specular)] transition-colors whitespace-nowrap"
                    >
                      Room Management ({isLoadingRooms ? '...' : roomsDirectory.length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Studio Preview & Atmospheric Acoustic Calibrator */}
              <div className="lg:col-span-5 b2-glass-pod rounded-3xl p-6 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">
                      Studio Preview
                    </span>
                    <span className="font-mono-tabular text-[#D4A373]">
                      {currentSelectedRoom
                        ? `${currentSelectedRoom.activeParticipants}/${currentSelectedRoom.capacity} Connected`
                        : `${roomsDirectory.length} Active Rooms`}
                    </span>
                  </div>

                  <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-[#0D0A08] border border-[var(--border-specular)] flex flex-col items-center justify-center p-4">
                    <BrandLogo size="lg" showText={true} />
                    <p className="text-xs text-[var(--text-muted)] mt-3 text-center max-w-xs">
                      {userName.trim()
                        ? `Ready to join as ${userName.trim()} (${userRole})`
                        : 'Enter your display name and classroom title to begin.'}
                    </p>
                  </div>
                </div>

                {/* Theme & Procedural Rain Synthesizer Controls */}
                <div className="space-y-3 p-4 rounded-2xl bg-black/25 border border-[var(--border-specular)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <CloudRain className="w-4 h-4 text-[#D4A373]" />
                      <span>Procedural Rain-on-Glass Acoustics</span>
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[#D4A373]">
                      {Math.round(rainVolume * 100)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {(['off', 'drizzle', 'storm'] as RainIntensity[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => {
                          setRainIntensity(lvl);
                          const vol = lvl === 'off' ? 0 : Math.max(0.35, rainVolume);
                          setRainVolume(vol);
                          rainAudioEngine.setRainConfig(lvl, vol);
                        }}
                        className={`py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                          rainIntensity === lvl
                            ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                            : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2.5 pt-1">
                    <Volume2 className="w-4 h-4 text-[#D4A373] shrink-0" />
                    <input
                      type="range"
                      aria-label="Rain Audio Synthesizer Volume"
                      min={0}
                      max={1}
                      step={0.05}
                      value={rainVolume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRainVolume(v);
                        const nextInt =
                          v > 0 && rainIntensity === 'off' ? 'drizzle' : rainIntensity;
                        setRainIntensity(nextInt);
                        rainAudioEngine.setRainConfig(nextInt, v);
                      }}
                      className="w-full accent-[#D4A373] cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Quiet Editorial Footer */}
        <footer className="relative z-10 max-w-7xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--text-muted)] py-2 shrink-0">
          <span>B2.Connect Virtual Classroom Platform</span>
          <span className="font-mono-tabular">16:9 Vector Canvas · UTF-8 BiDi Ready</span>
        </footer>
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: LIVE CLASSROOM WORKSPACE (100dvh Zero-Overflow Multi-Pod Bento Grid)
  // ============================================================================
  return (
    <div className="relative h-[100dvh] max-h-[100dvh] w-screen overflow-hidden flex flex-col select-none">
      {/* z-0: 60fps HTML5 Rain & Café Bokeh Canvas */}
      <RainBackdropCanvas intensity={rainIntensity} theme={theme} />

      {/* Floating Live Screen Emoji Reactions Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {floatingReactions.map((r) => (
          <div
            key={r.id}
            style={{ left: `${r.xPercent}%`, bottom: '14%' }}
            className="absolute animate-bounce flex flex-col items-center"
          >
            <span className="text-3xl drop-shadow-lg">{r.emoji}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-black/70 text-[#FAF7F5] whitespace-nowrap">
              {r.senderName}
            </span>
          </div>
        ))}
      </div>

      {/* z-[60]: System Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] b2-glass-elevated px-4 py-2.5 rounded-xl shadow-2xl border border-[#D4A373]/50 text-xs font-medium text-[var(--text-primary)] flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4 text-[#D4A373] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* z-[60]: Urgent 30s Presence Roll-Call Attention Check Modal */}
      {roomState.activeRollCall &&
        !roomState.activeRollCall.verifiedIds.includes(localParticipantId) && (
          <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-labelledby="rollcall-title"
              className="b2-glass-elevated max-w-md w-full rounded-3xl p-6 border-2 border-[#D4A373] shadow-2xl text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-[#D4A373]/20 border border-[#D4A373] flex items-center justify-center mx-auto text-[#D4A373]">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h2 id="rollcall-title" className="text-lg font-bold text-[var(--text-primary)]">
                30-Second Presence &amp; Focus Roll-Call
              </h2>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Your instructor triggered a live presence verification check. Confirm now to record your active attendance.
              </p>
              <button
                type="button"
                onClick={() => {
                  roomEngine.acknowledgeRollCall(localParticipantId);
                  rainAudioEngine.playChime('rollcall');
                }}
                className="w-full py-3 rounded-xl bg-[#D4A373] text-[#0D0A08] font-bold text-sm hover:bg-[#E6CCB2] transition-colors"
              >
                Confirm I Am Present
              </button>
            </div>
          </div>
        )}

      {/* z-50: Room Management Modal inside Classroom */}
      {showAdminCenter && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-label="Room Management"
            className="b2-glass-elevated max-w-3xl w-full max-h-[85dvh] rounded-3xl p-5 flex flex-col gap-4 border border-[#D4A373]/40 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-specular)] pb-3">
              <div className="flex items-center gap-2.5">
                <BrandLogo size="sm" showText={false} />
                <div>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">
                    Active Rooms ({roomsDirectory.length})
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Switch active classroom or copy invite links
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close Room Management"
                onClick={() => setShowAdminCenter(false)}
                className="p-2 rounded-xl hover:bg-white/10 text-[var(--text-secondary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {roomsDirectory.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                  No additional rooms created yet.
                </div>
              ) : (
                roomsDirectory.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-xl bg-black/25 border border-[var(--border-specular)] flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <div dir="auto" className="text-xs font-bold text-[var(--text-primary)]">
                        <span className="font-mono-tabular text-[#D4A373] mr-2">{r.code}</span>
                        {r.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular mt-0.5">
                        {r.instructorName} · {r.activeParticipants}/{r.capacity} connected
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopyInviteLink(r, 'student')}
                        className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[var(--text-secondary)]"
                      >
                        Copy Invite
                      </button>
                      <button
                        type="button"
                        onClick={() => handleJoinClassroom(r, userRole)}
                        className="px-3 py-1.5 rounded-lg bg-[#D4A373] text-[#0D0A08] font-semibold text-xs"
                      >
                        Switch
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* z-20: Top Glass Classroom Control Bar */}
      <header className="relative z-20 h-14 px-3 sm:px-4 b2-glass-pod border-b border-[var(--border-specular)] flex items-center justify-between gap-3 shrink-0">
        {/* Left Zone: Brand Emblem + Active Classroom Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandLogo size="sm" showText={false} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                dir="auto"
                className="text-xs sm:text-sm font-bold text-[var(--text-primary)] truncate"
              >
                {roomState.name || 'Live Classroom'}
              </span>
              <span className="hidden sm:inline text-[11px] font-mono-tabular text-[#D4A373] whitespace-nowrap shrink-0">
                · {connState === 'connected' ? 'Connected' : 'Reconnecting'}
              </span>
            </div>
          </div>
        </div>

        {/* Center Zone: Synchronized Pod Layout Switcher & Class Countdown Timer */}
        <div className="hidden lg:flex items-center gap-2">
          <div className="flex items-center gap-1 bg-black/25 p-1 rounded-xl border border-[var(--border-specular)]">
            {(
              [
                { id: 'whiteboard', label: 'Whiteboard Studio' },
                { id: 'lecture', label: 'Lecture Stage' },
                { id: 'exam', label: 'Exam Lock' },
                { id: 'seminar', label: 'Seminar Grid' },
              ] as { id: PodLayoutMode; label: string }[]
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => roomEngine.setLayout(mode.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  roomState.activeLayout === mode.id
                    ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Synced Class Timer */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/25 border border-[var(--border-specular)] text-xs font-mono-tabular">
            <span className="text-[#D4A373] font-semibold">{formatTimer(timerSeconds)}</span>
            <button
              type="button"
              aria-label={timerRunning ? 'Pause Class Timer' : 'Start Class Timer'}
              onClick={() => setTimerRunning((r) => !r)}
              className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)]"
            >
              {timerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              aria-label="Reset Class Timer"
              onClick={() => {
                setTimerSeconds(1500);
                setTimerRunning(false);
              }}
              className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Zone: Media Controls, Recorder, Atmosphere Popover, Zen Mode & Leave */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-label={localParticipant?.micMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            onClick={() => roomEngine.toggleLocalMedia(localParticipantId, 'mic')}
            className={`p-2 rounded-xl border transition-colors ${
              !localParticipant?.micMuted
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-specular)]'
            }`}
            title="Toggle Microphone"
          >
            {!localParticipant?.micMuted ? (
              <Mic className="w-4 h-4" />
            ) : (
              <MicOff className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            aria-label={localParticipant?.camOff ? 'Turn Camera On' : 'Turn Camera Off'}
            onClick={() => roomEngine.toggleLocalMedia(localParticipantId, 'cam')}
            className={`p-2 rounded-xl border transition-colors ${
              !localParticipant?.camOff
                ? 'bg-[#D4A373]/20 text-[#D4A373] border-[#D4A373]/40'
                : 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-specular)]'
            }`}
            title="Toggle Camera"
          >
            {!localParticipant?.camOff ? (
              <Video className="w-4 h-4" />
            ) : (
              <VideoOff className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            aria-label="Share Screen"
            onClick={handleToggleScreenShare}
            className={`hidden sm:inline-flex p-2 rounded-xl border transition-colors ${
              isScreenSharing
                ? 'bg-[#D4A373] text-[#0D0A08] border-[#D4A373]'
                : 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-specular)] hover:bg-white/10'
            }`}
            title="Share Screen"
          >
            <MonitorUp className="w-4 h-4" />
          </button>

          <button
            type="button"
            aria-label={isRecording ? 'Stop Local Class Recording' : 'Start Local Class Recording'}
            onClick={handleToggleRecording}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              isRecording
                ? 'bg-rose-500/25 text-rose-300 border-rose-500/50'
                : 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-specular)] hover:bg-white/10'
            }`}
            title="Record Class (.webm)"
          >
            <CircleDot className={`w-3.5 h-3.5 ${isRecording ? 'text-rose-400' : ''}`} />
            <span className="hidden xl:inline">{isRecording ? 'Stop Rec' : 'Record'}</span>
          </button>

          {/* Rain & Theme Atmosphere Trigger */}
          <div className="relative">
            <button
              type="button"
              aria-label="Atmosphere and Theme Settings"
              onClick={() => setShowAtmospherePopover((v) => !v)}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[#D4A373] border border-[var(--border-specular)]"
              title="Rain Acoustics & Theme"
            >
              <Sliders className="w-4 h-4" />
            </button>

            {showAtmospherePopover && (
              <div className="absolute right-0 mt-2 w-72 z-50 b2-glass-elevated rounded-2xl p-4 shadow-2xl border border-[#D4A373]/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-primary)]">
                    Atmosphere &amp; Theme Studio
                  </span>
                  <button
                    type="button"
                    aria-label="Close Atmosphere Popover"
                    onClick={() => setShowAtmospherePopover(false)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] text-[var(--text-muted)]">Visual Theme</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'espresso', label: 'Espresso' },
                        { id: 'noir', label: 'Noir' },
                        { id: 'daylight', label: 'Daylight' },
                      ] as { id: ThemeMode; label: string }[]
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id)}
                        className={`py-1.5 rounded-lg text-xs font-medium ${
                          theme === t.id
                            ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                            : 'bg-white/5 text-[var(--text-secondary)]'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] text-[var(--text-muted)]">Rain Intensity</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['off', 'drizzle', 'storm'] as RainIntensity[]).map((ri) => (
                      <button
                        key={ri}
                        type="button"
                        onClick={() => {
                          setRainIntensity(ri);
                          const vol = ri === 'off' ? 0 : Math.max(0.35, rainVolume);
                          setRainVolume(vol);
                          rainAudioEngine.setRainConfig(ri, vol);
                        }}
                        className={`py-1.5 rounded-lg text-xs font-medium capitalize ${
                          rainIntensity === ri
                            ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                            : 'bg-white/5 text-[var(--text-secondary)]'
                        }`}
                      >
                        {ri}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-[var(--text-muted)]">
                    <span>Web Audio Rain Synthesizer</span>
                    <span className="font-mono-tabular">{Math.round(rainVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Classroom Rain Volume"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rainVolume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRainVolume(v);
                      const nextInt =
                        v > 0 && rainIntensity === 'off' ? 'drizzle' : rainIntensity;
                      setRainIntensity(nextInt);
                      rainAudioEngine.setRainConfig(nextInt, v);
                    }}
                    className="w-full accent-[#D4A373] cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Rooms Switcher Button */}
          <button
            type="button"
            aria-label="Open Room Management"
            onClick={() => {
              refreshRooms();
              setShowAdminCenter(true);
            }}
            className="hidden md:inline-flex px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-specular)] items-center gap-1 whitespace-nowrap"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-[#D4A373]" />
            <span>Rooms ({roomsDirectory.length})</span>
          </button>

          {/* Zen / Cinema Mode Toggle */}
          <button
            type="button"
            aria-label={zenMode ? 'Exit Zen Mode' : 'Enter Zen Mode'}
            onClick={() => setZenMode((z) => !z)}
            className="hidden lg:inline-flex p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] border border-[var(--border-specular)]"
            title="Toggle Zen Cinema Stage"
          >
            {zenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Leave Room */}
          <button
            type="button"
            aria-label="Leave Classroom"
            onClick={() => {
              setInClassroom(false);
              refreshRooms();
            }}
            className="px-2.5 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lobby</span>
          </button>
        </div>
      </header>

      {/* z-10: Main Responsive Multi-Pod Workspace */}
      <main className="relative z-10 flex-1 min-h-0 w-full flex flex-col lg:flex-row gap-2.5 p-2 sm:p-3 overflow-hidden">
        {/* Center Primary Stage (Whiteboard / Exam Mode / Seminar Grid) */}
        <section className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          {roomState.activeLayout === 'seminar' ? (
            /* Seminar Multi-Participant Discussion Grid (Only Real Connected Participants) */
            <div className="flex-1 min-h-0 b2-glass-pod rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto">
              {participantsArray.map((p) => (
                <div
                  key={p.id}
                  className={`relative rounded-2xl bg-[#0D0A08] border p-4 flex flex-col items-center justify-center min-h-[160px] ${
                    !p.micMuted
                      ? 'border-[#D4A373] ring-2 ring-[#D4A373]/40'
                      : 'border-[var(--border-specular)]'
                  }`}
                >
                  <BrandLogo size="sm" showText={false} />
                  <div dir="auto" className="text-xs font-bold text-[var(--text-primary)] mt-2.5">
                    {p.name}
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5">
                    {p.role.toUpperCase()} · {p.engagementXp} XP
                  </div>
                </div>
              ))}
            </div>
          ) : roomState.activeLayout === 'exam' ? (
            /* Live Exam / Quiz Lock Mode: Split Stage with Timed Quiz & Anti-Cheat Focus Radar */
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 overflow-hidden">
              <div className="b2-glass-pod rounded-2xl p-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-[var(--border-specular)] pb-2.5 mb-3">
                  <span className="text-xs font-bold text-[#D4A373] flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Exam Lock Mode · Public Chat Locked</span>
                  </span>
                  <span className="text-xs font-mono-tabular text-[var(--text-primary)]">
                    Remaining: {formatTimer(timerSeconds)}
                  </span>
                </div>
                <PollPod
                  activePoll={roomState.activePoll}
                  localParticipantId={localParticipantId}
                  localRole={userRole}
                  onVotePoll={(idx) => roomEngine.votePoll(localParticipantId, idx)}
                  onStartNewPoll={(p) => roomEngine.startPoll(p)}
                  onToggleRevealAnswer={() => roomEngine.togglePollReveal()}
                />
              </div>
              <div className="b2-glass-pod rounded-2xl p-4 flex flex-col min-h-0">
                <div className="text-xs font-bold text-[var(--text-primary)] border-b border-[var(--border-specular)] pb-2.5 mb-3">
                  Live Proctoring &amp; Tab-Switch Focus Radar
                </div>
                <AttendanceAndFocusPod
                  roomName={roomState.name}
                  participants={participantsArray}
                  localRole={userRole}
                  activePoll={roomState.activePoll}
                  activeRollCall={roomState.activeRollCall}
                  onTogglePermission={(pid, perm) => roomEngine.togglePermission(pid, perm)}
                  onTriggerRollCall={() => roomEngine.triggerRollCall()}
                />
              </div>
            </div>
          ) : (
            /* Default: 16:9 Multi-Layer STEM Vector Whiteboard & Slide Studio */
            <WhiteboardPod
              strokes={roomState.strokesBySlide[roomState.currentSlide] || []}
              currentSlide={roomState.currentSlide}
              totalSlides={roomState.totalSlides}
              activeTemplate={roomState.activeTemplate}
              slideBackground={roomState.slideBackgrounds[roomState.currentSlide]}
              canDraw={canDrawOnBoard}
              localParticipantId={localParticipantId}
              localParticipantName={userName || 'Host'}
              theme={theme}
              remoteLaser={remoteLaser}
              onAddStroke={(s) => roomEngine.addStroke(s)}
              onUpdateStroke={(s) => roomEngine.updateStroke(s)}
              onDeleteStroke={(id, slideIdx) => roomEngine.deleteStroke(id, slideIdx)}
              onUndoStroke={() => roomEngine.undoStroke(roomState.currentSlide)}
              onClearSlide={() => roomEngine.clearSlide(roomState.currentSlide)}
              onChangeSlide={(idx) => roomEngine.setSlide(idx)}
              onChangeTemplate={(tpl) => roomEngine.setTemplate(tpl)}
              onUploadBackground={(idx, url) => roomEngine.setSlideBackground(idx, url)}
              onMoveLaser={(l) => roomEngine.moveLaser(l)}
              canvasRefCallback={(el) => {
                whiteboardCanvasRef.current = el;
              }}
            />
          )}
        </section>

        {/* z-20: Desktop & Tablet Docked Right Interaction Pod (Hidden in Zen Mode or Mobile) */}
        {!zenMode && (
          <aside className="hidden md:flex md:w-80 lg:w-96 shrink-0 flex-col gap-2.5 min-h-0 h-full">
            {/* Live Broadcast Video Tile with Real Host Name */}
            <div
              className={`relative rounded-2xl overflow-hidden bg-[#0D0A08] border p-3 shrink-0 transition-all ${
                !localParticipant?.micMuted
                  ? 'border-[#D4A373] shadow-[0_0_20px_rgba(212,163,115,0.2)]'
                  : 'border-[var(--border-specular)]'
              }`}
            >
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#14100E] flex flex-col items-center justify-center">
                <video
                  ref={localVideoRef}
                  playsInline
                  autoPlay
                  muted
                  className={`w-full h-full object-cover ${isScreenSharing ? 'block' : 'hidden'}`}
                />
                {!isScreenSharing && (
                  <div className="flex flex-col items-center justify-center text-center p-2">
                    <BrandLogo size="sm" showText={true} />
                    <span dir="auto" className="text-[11px] text-[var(--text-muted)] mt-1.5">
                      {hostParticipant?.name || userName} · {hostParticipant?.role || userRole}
                    </span>
                  </div>
                )}

                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg">
                  <span dir="auto" className="font-medium text-[var(--text-primary)] truncate">
                    {hostParticipant?.name || userName}
                  </span>
                  <span className="font-mono-tabular text-[#D4A373]">
                    {!localParticipant?.micMuted ? '● Mic On' : 'Muted'}
                  </span>
                </div>
              </div>
            </div>

            {/* Multi-Pod Tabbed Workspace Container */}
            <div className="flex-1 min-h-0 b2-glass-pod rounded-2xl p-3 flex flex-col gap-3 overflow-hidden">
              {/* Interactive Pod Switcher Tabs */}
              <div className="grid grid-cols-5 gap-1 bg-black/25 p-1 rounded-xl border border-[var(--border-specular)] shrink-0">
                {(
                  [
                    {
                      id: 'attendance',
                      label: 'Roster',
                      icon: <Users className="w-3.5 h-3.5" />,
                      count: participantsArray.length,
                    },
                    {
                      id: 'chat',
                      label: 'Chat',
                      icon: <MessageSquare className="w-3.5 h-3.5" />,
                      count: roomState.messages.length,
                    },
                    {
                      id: 'polls',
                      label: 'Quiz',
                      icon: <BarChart3 className="w-3.5 h-3.5" />,
                    },
                    {
                      id: 'hands',
                      label: 'Hands',
                      icon: <Hand className="w-3.5 h-3.5" />,
                      count: raisedHandsCount,
                    },
                    {
                      id: 'files',
                      label: 'Files',
                      icon: <FolderOpen className="w-3.5 h-3.5" />,
                      count: roomState.sharedFiles.length,
                    },
                  ] as {
                    id: ActiveSidebarTab;
                    label: string;
                    icon: React.ReactNode;
                    count?: number;
                  }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Active Pod Content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'attendance' && (
                  <AttendanceAndFocusPod
                    roomName={roomState.name}
                    participants={participantsArray}
                    localRole={userRole}
                    activePoll={roomState.activePoll}
                    activeRollCall={roomState.activeRollCall}
                    onTogglePermission={(pid, perm) => roomEngine.togglePermission(pid, perm)}
                    onTriggerRollCall={() => roomEngine.triggerRollCall()}
                  />
                )}
                {activeTab === 'chat' && (
                  <ChatPod
                    messages={roomState.messages}
                    chatLocked={roomState.chatLocked}
                    localParticipantId={localParticipantId}
                    localParticipantName={userName || 'Host'}
                    localRole={userRole}
                    onSendMessage={(ch, txt) =>
                      roomEngine.sendChatMessage({
                        senderId: localParticipantId,
                        senderName: userName || 'Host',
                        senderRole: userRole,
                        channel: ch,
                        text: txt,
                      })
                    }
                    onToggleChatLock={() => roomEngine.toggleChatLock()}
                    onSendReaction={(em) =>
                      roomEngine.sendEmojiReaction(localParticipantId, userName || 'Host', em)
                    }
                  />
                )}
                {activeTab === 'polls' && (
                  <PollPod
                    activePoll={roomState.activePoll}
                    localParticipantId={localParticipantId}
                    localRole={userRole}
                    onVotePoll={(idx) => roomEngine.votePoll(localParticipantId, idx)}
                    onStartNewPoll={(p) => roomEngine.startPoll(p)}
                    onToggleRevealAnswer={() => roomEngine.togglePollReveal()}
                  />
                )}
                {activeTab === 'hands' && (
                  <RaiseHandQueuePod
                    participants={participantsArray}
                    localParticipantId={localParticipantId}
                    localRole={userRole}
                    onToggleHandRaise={(pid) => roomEngine.toggleHandRaise(pid)}
                    onApproveStudentSpeaking={(pid) => {
                      roomEngine.togglePermission(pid, 'mic');
                      roomEngine.togglePermission(pid, 'pen');
                      roomEngine.toggleHandRaise(pid);
                      showToast('Granted student Microphone & Whiteboard Pen.');
                    }}
                  />
                )}
                {activeTab === 'files' && (
                  <FileVaultPod
                    files={roomState.sharedFiles}
                    localParticipantName={userName || 'Host'}
                    onUploadFile={(f) => {
                      roomEngine.addSharedFile(f);
                      showToast(`Uploaded "${f.fileName}".`);
                    }}
                    onDownloadFile={(f) => {
                      roomEngine.incrementFileDownload(f.id);
                      if (f.dataUrl) {
                        const a = document.createElement('a');
                        a.href = f.dataUrl;
                        a.download = f.fileName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }
                      showToast(`Downloading "${f.fileName}"...`);
                    }}
                  />
                )}
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* z-30: Mobile Floating Corner-Snap PiP Teacher Video Card (< 768px) */}
      <div
        className={`md:hidden fixed z-30 transition-all ${
          pipCorner === 'top-right'
            ? 'bottom-32 right-4'
            : pipCorner === 'top-left'
            ? 'bottom-32 left-4'
            : 'top-28 right-4'
        }`}
      >
        {pipMinimized ? (
          <button
            type="button"
            onClick={() => setPipMinimized(false)}
            className="b2-glass-elevated px-3 py-1.5 rounded-full text-xs font-semibold text-[#D4A373] border border-[#D4A373]/40 shadow-lg flex items-center gap-1.5"
          >
            <BrandLogo size="xs" showText={false} />
            <span dir="auto" className="truncate max-w-[90px]">
              {hostParticipant?.name || userName}
            </span>
          </button>
        ) : (
          <div className="w-32 b2-glass-elevated rounded-2xl p-2 border border-[#D4A373]/40 shadow-xl">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-1">
              <button
                type="button"
                onClick={() =>
                  setPipCorner((c) =>
                    c === 'top-right'
                      ? 'top-left'
                      : c === 'top-left'
                      ? 'bottom-right'
                      : 'top-right'
                  )
                }
                className="hover:text-[var(--text-primary)] font-medium"
              >
                Snap Corner
              </button>
              <button
                type="button"
                aria-label="Minimize PiP Video"
                onClick={() => setPipMinimized(true)}
                className="hover:text-[var(--text-primary)] font-bold px-1"
              >
                –
              </button>
            </div>
            <div className="aspect-video rounded-lg bg-[#0D0A08] flex flex-col items-center justify-center p-1">
              <BrandLogo size="xs" showText={false} />
              <span
                dir="auto"
                className="text-[10px] text-[var(--text-primary)] font-medium mt-1 truncate max-w-full"
              >
                {hostParticipant?.name || userName}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* z-40: Mobile Fixed Bottom Glass Navigation Bar & Slide-Up Bottom Sheets (< 768px) */}
      <nav
        aria-label="Mobile Classroom Pods"
        className="md:hidden relative z-40 h-14 b2-glass-pod border-t border-[var(--border-specular)] px-2 flex items-center justify-around shrink-0"
      >
        {(
          [
            { id: 'attendance', label: 'Roster', icon: <Users className="w-4 h-4" /> },
            { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
            { id: 'polls', label: 'Quiz', icon: <BarChart3 className="w-4 h-4" /> },
            { id: 'hands', label: 'Hands', icon: <Hand className="w-4 h-4" /> },
            { id: 'files', label: 'Files', icon: <FolderOpen className="w-4 h-4" /> },
          ] as { id: ActiveSidebarTab; label: string; icon: React.ReactNode }[]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMobileSheetTab((cur) => (cur === item.id ? null : item.id))}
            className={`min-w-[54px] min-h-[42px] px-2 py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              mobileSheetTab === item.id
                ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Mobile Slide-Up Bottom Sheet Drawer (`z-40`) */}
      {mobileSheetTab && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex flex-col justify-end"
          onClick={() => setMobileSheetTab(null)}
        >
          <div
            className="b2-glass-elevated rounded-t-3xl p-4 h-[72dvh] max-h-[78dvh] flex flex-col gap-3 border-t border-[#D4A373]/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-specular)] pb-2.5 shrink-0">
              <span className="text-sm font-bold text-[var(--text-primary)] capitalize">
                {mobileSheetTab} Pod
              </span>
              <button
                type="button"
                aria-label="Close Mobile Sheet"
                onClick={() => setMobileSheetTab(null)}
                className="p-1.5 rounded-lg bg-white/5 text-[var(--text-secondary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {mobileSheetTab === 'attendance' && (
                <AttendanceAndFocusPod
                  roomName={roomState.name}
                  participants={participantsArray}
                  localRole={userRole}
                  activePoll={roomState.activePoll}
                  activeRollCall={roomState.activeRollCall}
                  onTogglePermission={(pid, perm) => roomEngine.togglePermission(pid, perm)}
                  onTriggerRollCall={() => roomEngine.triggerRollCall()}
                />
              )}
              {mobileSheetTab === 'chat' && (
                <ChatPod
                  messages={roomState.messages}
                  chatLocked={roomState.chatLocked}
                  localParticipantId={localParticipantId}
                  localParticipantName={userName || 'Host'}
                  localRole={userRole}
                  onSendMessage={(ch, txt) =>
                    roomEngine.sendChatMessage({
                      senderId: localParticipantId,
                      senderName: userName || 'Host',
                      senderRole: userRole,
                      channel: ch,
                      text: txt,
                    })
                  }
                  onToggleChatLock={() => roomEngine.toggleChatLock()}
                  onSendReaction={(em) =>
                    roomEngine.sendEmojiReaction(localParticipantId, userName || 'Host', em)
                  }
                />
              )}
              {mobileSheetTab === 'polls' && (
                <PollPod
                  activePoll={roomState.activePoll}
                  localParticipantId={localParticipantId}
                  localRole={userRole}
                  onVotePoll={(idx) => roomEngine.votePoll(localParticipantId, idx)}
                  onStartNewPoll={(p) => roomEngine.startPoll(p)}
                  onToggleRevealAnswer={() => roomEngine.togglePollReveal()}
                />
              )}
              {mobileSheetTab === 'hands' && (
                <RaiseHandQueuePod
                  participants={participantsArray}
                  localParticipantId={localParticipantId}
                  localRole={userRole}
                  onToggleHandRaise={(pid) => roomEngine.toggleHandRaise(pid)}
                  onApproveStudentSpeaking={(pid) => {
                    roomEngine.togglePermission(pid, 'mic');
                    roomEngine.togglePermission(pid, 'pen');
                    roomEngine.toggleHandRaise(pid);
                  }}
                />
              )}
              {mobileSheetTab === 'files' && (
                <FileVaultPod
                  files={roomState.sharedFiles}
                  localParticipantName={userName || 'Host'}
                  onUploadFile={(f) => roomEngine.addSharedFile(f)}
                  onDownloadFile={(f) => {
                    roomEngine.incrementFileDownload(f.id);
                    if (f.dataUrl) {
                      const a = document.createElement('a');
                      a.href = f.dataUrl;
                      a.download = f.fileName;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
