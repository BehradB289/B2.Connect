export type ThemeMode = 'espresso' | 'noir' | 'daylight';

export type RainIntensity = 'off' | 'drizzle' | 'storm';

export type UserRole = 'teacher' | 'assistant' | 'student';

export type FocusState = 'focused' | 'away' | 'idle';

export type PodLayoutMode = 'lecture' | 'whiteboard' | 'exam' | 'seminar';

export type BoardTemplate = 'espresso' | 'grid' | 'cartesian' | 'notebook' | 'dots';

export type WhiteboardTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'circle'
  | 'text'
  | 'sticky'
  | 'image'
  | 'laser'
  | 'pan';

export interface NormalizedPoint {
  /** Normalized X coordinate in [0.0, 1.0] */
  x: number;
  /** Normalized Y coordinate in [0.0, 1.0] */
  y: number;
  /** Stylus or pointer pressure in [0.0, 1.0] */
  pressure?: number;
}

export interface WhiteboardStroke {
  id: string;
  authorId: string;
  authorName: string;
  slideIndex: number;
  tool: Exclude<WhiteboardTool, 'select' | 'laser' | 'pan'>;
  color: string;
  size: number;
  opacity: number;
  points: NormalizedPoint[];
  text?: string;
  /** Base64 Data URL for resizable uploaded images or rendered PDF pages */
  imageDataUrl?: string;
  /** Natural width/height ratio of uploaded image */
  aspectRatio?: number;
  createdAt: number;
}

export interface LaserPointerPosition {
  authorId: string;
  authorName: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface Participant {
  id: string;
  name: string;
  role: UserRole;
  joinedAt: number;
  lastSeenAt: number;
  activeMinutes: number;
  focusState: FocusState;
  tabSwitches: number;
  rollCallVerified: boolean;
  micGranted: boolean;
  camGranted: boolean;
  penGranted: boolean;
  micMuted: boolean;
  camOff: boolean;
  handRaised: boolean;
  handRaisedAt?: number | null;
  engagementXp: number;
  isSpeaking?: boolean;
  audioLevel?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  channel: 'public' | 'private_host' | 'pinned';
  text: string;
  timestamp: number;
  pinned?: boolean;
}

export interface LivePollOption {
  id: string;
  text: string;
}

export interface LivePoll {
  id: string;
  question: string;
  options: LivePollOption[];
  correctOptionIndex: number | null;
  revealAnswer: boolean;
  isActive: boolean;
  durationSeconds: number;
  createdAt: number;
  /** Map of participantId -> selected option index */
  votes: Record<string, number>;
}

export interface SharedFileItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  r2Key: string;
  uploadedBy: string;
  downloads: number;
  uploadedAt: number;
  dataUrl?: string;
}

export interface RollCallSession {
  id: string;
  expiresAt: number;
  verifiedIds: string[];
}

export interface ClassroomSummary {
  id: string;
  code: string;
  name: string;
  subject: string;
  instructorName: string;
  activeParticipants: number;
  capacity: number;
  status: 'live' | 'standby' | 'exam';
  latencyMs: number;
  activeLayout: PodLayoutMode;
}

export interface EmojiReactionEvent {
  id: string;
  senderId: string;
  senderName: string;
  emoji: string;
  xPercent: number;
  timestamp: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'simulated_local';

export interface RoomStateSnapshot {
  roomId: string;
  name: string;
  subject: string;
  activeLayout: PodLayoutMode;
  activeTemplate: BoardTemplate;
  currentSlide: number;
  totalSlides: number;
  slideBackgrounds: Record<number, string>;
  chatLocked: boolean;
  timerSeconds: number;
  timerRunning: boolean;
  strokesBySlide: Record<number, WhiteboardStroke[]>;
  participants: Record<string, Participant>;
  messages: ChatMessage[];
  activePoll: LivePoll | null;
  sharedFiles: SharedFileItem[];
  activeRollCall: RollCallSession | null;
}
