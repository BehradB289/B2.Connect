import type {
  BoardTemplate,
  ChatMessage,
  ClassroomSummary,
  ConnectionState,
  EmojiReactionEvent,
  FocusState,
  LaserPointerPosition,
  LivePoll,
  Participant,
  PodLayoutMode,
  RoomStateSnapshot,
  SharedFileItem,
  UserRole,
  WebRTCSignalPayload,
  WhiteboardStroke,
} from '../types/classroom';
import { calculateEngagementXp } from '../utils/classroomRules';

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

/**
 * Fetches only real rooms from the backend `/api/rooms`.
 * Returns an empty array if no rooms have been created yet.
 */
export async function fetchRoomsDirectory(): Promise<ClassroomSummary[]> {
  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) return [];
    const data = (await res.json()) as { rooms?: ClassroomSummary[] };
    return Array.isArray(data.rooms) ? data.rooms : [];
  } catch {
    return [];
  }
}

export async function createRoomOnServer(params: {
  name: string;
  subject: string;
  instructorName: string;
  capacity?: number;
}): Promise<ClassroomSummary | null> {
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { room?: ClassroomSummary };
    return data.room || null;
  } catch {
    return null;
  }
}

export async function deleteRoomOnServer(roomId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

type RoomListener = (state: RoomStateSnapshot) => void;
type ConnectionListener = (conn: ConnectionState) => void;
type LaserListener = (laser: LaserPointerPosition | null) => void;
type ReactionListener = (reaction: EmojiReactionEvent) => void;
type RemoteStreamListener = (streams: Record<string, MediaStream>) => void;

export class B2RoomEngine {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private telemetryInterval: number | null = null;
  private connectionState: ConnectionState = 'reconnecting';
  private localParticipantId = '';
  private localParticipantName = '';
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  // WebRTC Peer-to-Peer State
  private localMediaStream: MediaStream | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();

  private state: RoomStateSnapshot;
  private listeners = new Set<RoomListener>();
  private connListeners = new Set<ConnectionListener>();
  private laserListeners = new Set<LaserListener>();
  private reactionListeners = new Set<ReactionListener>();
  private remoteStreamListeners = new Set<RemoteStreamListener>();

  constructor() {
    this.state = {
      roomId: '',
      name: '',
      subject: '',
      activeLayout: 'whiteboard',
      activeTemplate: 'espresso',
      currentSlide: 0,
      totalSlides: 1,
      slideBackgrounds: {},
      chatLocked: false,
      timerSeconds: 1500,
      timerRunning: false,
      strokesBySlide: { 0: [] },
      participants: {},
      messages: [],
      activePoll: null,
      sharedFiles: [],
      activeRollCall: null,
    };
  }

  public getState(): RoomStateSnapshot {
    return this.state;
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public getLocalParticipantId(): string {
    return this.localParticipantId;
  }

  public subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public subscribeConnection(listener: ConnectionListener): () => void {
    this.connListeners.add(listener);
    listener(this.connectionState);
    return () => this.connListeners.delete(listener);
  }

  public subscribeLaser(listener: LaserListener): () => void {
    this.laserListeners.add(listener);
    return () => this.laserListeners.delete(listener);
  }

  public subscribeReactions(listener: ReactionListener): () => void {
    this.reactionListeners.add(listener);
    return () => this.reactionListeners.delete(listener);
  }

  public subscribeRemoteStreams(listener: RemoteStreamListener): () => void {
    this.remoteStreamListeners.add(listener);
    listener(this.getRemoteStreamsRecord());
    return () => this.remoteStreamListeners.delete(listener);
  }

  private getRemoteStreamsRecord(): Record<string, MediaStream> {
    const out: Record<string, MediaStream> = {};
    for (const [peerId, stream] of this.remoteStreams.entries()) {
      out[peerId] = stream;
    }
    return out;
  }

  private notifyRemoteStreams(): void {
    const snapshot = this.getRemoteStreamsRecord();
    for (const l of this.remoteStreamListeners) l(snapshot);
  }

  private notify(): void {
    const snapshot = { ...this.state };
    for (const l of this.listeners) l(snapshot);
  }

  private setConnState(next: ConnectionState): void {
    this.connectionState = next;
    for (const l of this.connListeners) l(next);
  }

  /**
   * Connects to the live WebSocket backend (`/ws`) with strict room isolation.
   */
  public connectToRoom(params: {
    roomId: string;
    roomName: string;
    subject: string;
    participantId: string;
    participantName: string;
    role: UserRole;
  }): void {
    this.disconnect();

    this.localParticipantId = params.participantId;
    this.localParticipantName = params.participantName;
    const localParticipant: Participant = {
      id: params.participantId,
      name: params.participantName,
      role: params.role,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      activeMinutes: 0,
      focusState: 'focused',
      tabSwitches: 0,
      rollCallVerified: true,
      micGranted: params.role !== 'student',
      camGranted: params.role !== 'student',
      penGranted: params.role !== 'student',
      micMuted: true,
      camOff: true,
      handRaised: false,
      engagementXp: 100,
      isSpeaking: false,
      audioLevel: 0,
    };

    this.state = {
      roomId: params.roomId,
      name: params.roomName,
      subject: params.subject,
      activeLayout: 'whiteboard',
      activeTemplate: 'espresso',
      currentSlide: 0,
      totalSlides: 1,
      slideBackgrounds: {},
      chatLocked: false,
      timerSeconds: 1500,
      timerRunning: false,
      strokesBySlide: { 0: [] },
      participants: {
        [params.participantId]: localParticipant,
      },
      messages: [],
      activePoll: null,
      sharedFiles: [],
      activeRollCall: null,
    };
    this.notify();

    this.openWebSocket(params);
    this.startRealTelemetryClock();
  }

  private openWebSocket(params: {
    roomId: string;
    roomName: string;
    subject: string;
    participantId: string;
    participantName: string;
    role: UserRole;
  }): void {
    if (typeof window === 'undefined') return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?roomId=${encodeURIComponent(
        params.roomId
      )}&participantId=${encodeURIComponent(params.participantId)}&name=${encodeURIComponent(
        params.participantName
      )}&role=${encodeURIComponent(params.role)}&roomName=${encodeURIComponent(
        params.roomName
      )}&subject=${encodeURIComponent(params.subject)}`;

      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempt = 0;
        this.setConnState('connected');
        // Request active WebRTC streams from any broadcasting host/peer in this room
        this.sendWebRTCSignal({
          roomId: params.roomId,
          senderId: params.participantId,
          senderName: params.participantName,
          signalType: 'request-offer',
        });
      };

      socket.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handleServerPacket(packet);
        } catch {
          // Ignore malformed packet
        }
      };

      socket.onclose = () => {
        if (this.ws === socket) {
          this.setConnState('reconnecting');
          this.scheduleReconnect(params);
        }
      };

      socket.onerror = () => {
        this.setConnState('reconnecting');
      };
    } catch {
      this.setConnState('reconnecting');
    }
  }

  private scheduleReconnect(params: {
    roomId: string;
    roomName: string;
    subject: string;
    participantId: string;
    participantName: string;
    role: UserRole;
  }): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.setConnState('reconnecting');
      this.openWebSocket(params);
    }, delay);
  }

  private sendPacket(type: string, payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  // ============================================================================
  // REAL WEBRTC PEER-TO-PEER AUDIO/VIDEO RELAY ENGINE
  // ============================================================================

  private sendWebRTCSignal(signal: WebRTCSignalPayload): void {
    this.sendPacket('WEBRTC_SIGNAL', signal as unknown as Record<string, unknown>);
  }

  private getOrCreatePeerConnection(remotePeerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(remotePeerId);
    if (existing && existing.signalingState !== 'closed') {
      return existing;
    }

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    this.peerConnections.set(remotePeerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWebRTCSignal({
          roomId: this.state.roomId,
          senderId: this.localParticipantId,
          senderName: this.localParticipantName,
          targetId: remotePeerId,
          signalType: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const incomingStream = event.streams?.[0] || new MediaStream([event.track]);
      this.remoteStreams.set(remotePeerId, incomingStream);
      this.notifyRemoteStreams();
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      ) {
        // Keep stream until explicit close or participant leave
      }
    };

    return pc;
  }

  private async initiateOfferToPeer(remotePeerId: string): Promise<void> {
    if (
      !this.localMediaStream ||
      this.localMediaStream.getTracks().length === 0 ||
      remotePeerId === this.localParticipantId ||
      typeof RTCPeerConnection === 'undefined'
    ) {
      return;
    }

    try {
      const pc = this.getOrCreatePeerConnection(remotePeerId);
      const existingSenders = pc.getSenders();

      for (const track of this.localMediaStream.getTracks()) {
        const alreadySent = existingSenders.find((s) => s.track?.kind === track.kind);
        if (alreadySent) {
          await alreadySent.replaceTrack(track);
        } else {
          pc.addTrack(track, this.localMediaStream);
        }
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendWebRTCSignal({
        roomId: this.state.roomId,
        senderId: this.localParticipantId,
        senderName: this.localParticipantName,
        targetId: remotePeerId,
        signalType: 'offer',
        sdp: pc.localDescription || offer,
      });
    } catch {
      // Ignore transient WebRTC negotiation error
    }
  }

  /**
   * Attaches the local hardware camera/microphone/screen MediaStream and broadcasts
   * live WebRTC offers to all participants in the room.
   */
  public async setLocalMediaStream(stream: MediaStream | null): Promise<void> {
    this.localMediaStream = stream;

    if (!stream || stream.getTracks().length === 0) {
      for (const [, pc] of this.peerConnections.entries()) {
        try {
          pc.close();
        } catch {
          // Ignore
        }
      }
      this.peerConnections.clear();
      this.sendWebRTCSignal({
        roomId: this.state.roomId,
        senderId: this.localParticipantId,
        senderName: this.localParticipantName,
        signalType: 'stream-stopped',
      });
      return;
    }

    const peerIds = Object.keys(this.state.participants).filter(
      (id) => id !== this.localParticipantId
    );
    for (const peerId of peerIds) {
      await this.initiateOfferToPeer(peerId);
    }
  }

  private async handleIncomingWebRTCSignal(signal: WebRTCSignalPayload): Promise<void> {
    if (!signal || signal.senderId === this.localParticipantId) return;
    if (signal.roomId && signal.roomId !== this.state.roomId) return;
    if (signal.targetId && signal.targetId !== this.localParticipantId) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    const remotePeerId = signal.senderId;

    try {
      if (signal.signalType === 'request-offer') {
        if (this.localMediaStream && this.localMediaStream.getTracks().length > 0) {
          await this.initiateOfferToPeer(remotePeerId);
        }
        return;
      }

      if (signal.signalType === 'stream-stopped') {
        const existingPc = this.peerConnections.get(remotePeerId);
        if (existingPc) {
          existingPc.close();
          this.peerConnections.delete(remotePeerId);
        }
        this.remoteStreams.delete(remotePeerId);
        this.notifyRemoteStreams();
        return;
      }

      const pc = this.getOrCreatePeerConnection(remotePeerId);

      if (signal.signalType === 'offer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (this.localMediaStream && this.localMediaStream.getTracks().length > 0) {
          const existingSenders = pc.getSenders();
          for (const track of this.localMediaStream.getTracks()) {
            const alreadySent = existingSenders.find((s) => s.track?.kind === track.kind);
            if (!alreadySent) {
              pc.addTrack(track, this.localMediaStream);
            }
          }
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendWebRTCSignal({
          roomId: this.state.roomId,
          senderId: this.localParticipantId,
          senderName: this.localParticipantName,
          targetId: remotePeerId,
          signalType: 'answer',
          sdp: pc.localDescription || answer,
        });
      } else if (signal.signalType === 'answer' && signal.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }
      } else if (signal.signalType === 'ice-candidate' && signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch {
      // Ignore transient ICE / SDP error
    }
  }

  private handleServerPacket(packet: { type: string; payload?: Record<string, unknown> }): void {
    const p = packet.payload || {};
    switch (packet.type) {
      case 'ROOM_STATE_SNAPSHOT': {
        const snapshotRoomId = (p.roomId as string) || this.state.roomId;
        if (snapshotRoomId !== this.state.roomId) return;

        const serverParticipants = (p.participants as Record<string, Participant>) || {};
        const serverStrokes = (p.strokesBySlide as Record<number, WhiteboardStroke[]>) || { 0: [] };
        const rawMessages = (p.messages as ChatMessage[]) || [];
        // Strict Room Isolation: only keep messages belonging to this roomId
        const roomIsolatedMessages = rawMessages.filter(
          (m) => !m.roomId || m.roomId === this.state.roomId
        );
        const serverFiles = (p.sharedFiles as SharedFileItem[]) || [];

        this.state = {
          ...this.state,
          name: (p.name as string) || this.state.name,
          subject: (p.subject as string) || this.state.subject,
          activeLayout: (p.activeLayout as PodLayoutMode) || this.state.activeLayout,
          activeTemplate: (p.activeTemplate as BoardTemplate) || this.state.activeTemplate,
          currentSlide: Number(p.currentSlide ?? this.state.currentSlide),
          totalSlides: Math.max(1, Number(p.totalSlides ?? this.state.totalSlides)),
          chatLocked: Boolean(p.chatLocked),
          strokesBySlide: serverStrokes,
          participants: serverParticipants,
          messages: roomIsolatedMessages,
          activePoll: (p.activePoll as LivePoll) || null,
          sharedFiles: serverFiles,
          activeRollCall:
            (p.activeRollCall as { id: string; expiresAt: number; verifiedIds: string[] }) || null,
        };
        this.notify();
        break;
      }
      case 'WHITEBOARD_STROKE': {
        const slideIndex = Number(p.slideIndex ?? this.state.currentSlide);
        const stroke = p.stroke as WhiteboardStroke;
        if (stroke) {
          const currentList = this.state.strokesBySlide[slideIndex] || [];
          if (slideIndex >= this.state.totalSlides) {
            this.state.totalSlides = slideIndex + 1;
          }
          if (!currentList.some((s) => s.id === stroke.id)) {
            this.state.strokesBySlide = {
              ...this.state.strokesBySlide,
              [slideIndex]: [...currentList, stroke],
            };
            this.notify();
          }
        }
        break;
      }
      case 'WHITEBOARD_UPDATE_STROKE': {
        const slideIndex = Number(p.slideIndex ?? this.state.currentSlide);
        const stroke = p.stroke as WhiteboardStroke;
        if (stroke && stroke.id) {
          const currentList = this.state.strokesBySlide[slideIndex] || [];
          this.state.strokesBySlide = {
            ...this.state.strokesBySlide,
            [slideIndex]: currentList.map((s) => (s.id === stroke.id ? stroke : s)),
          };
          this.notify();
        }
        break;
      }
      case 'WHITEBOARD_DELETE_STROKE': {
        const slideIndex = Number(p.slideIndex ?? this.state.currentSlide);
        const strokeId = String(p.strokeId || '');
        if (strokeId) {
          const currentList = this.state.strokesBySlide[slideIndex] || [];
          this.state.strokesBySlide = {
            ...this.state.strokesBySlide,
            [slideIndex]: currentList.filter((s) => s.id !== strokeId),
          };
          this.notify();
        }
        break;
      }
      case 'WHITEBOARD_SYNC_SLIDE': {
        const slideIndex = Number(p.slideIndex ?? this.state.currentSlide);
        const strokes = (p.strokes as WhiteboardStroke[]) || [];
        this.state.strokesBySlide = {
          ...this.state.strokesBySlide,
          [slideIndex]: strokes,
        };
        this.notify();
        break;
      }
      case 'WHITEBOARD_CLEAR': {
        const slideIndex = Number(p.slideIndex ?? this.state.currentSlide);
        this.state.strokesBySlide = {
          ...this.state.strokesBySlide,
          [slideIndex]: [],
        };
        this.notify();
        break;
      }
      case 'LASER_MOVE': {
        const laser = p.laser as LaserPointerPosition | null;
        for (const l of this.laserListeners) l(laser);
        break;
      }
      case 'LAYOUT_CHANGE': {
        if (p.layout) {
          this.state.activeLayout = p.layout as PodLayoutMode;
          this.notify();
        }
        break;
      }
      case 'TEMPLATE_CHANGE': {
        if (p.template) {
          this.state.activeTemplate = p.template as BoardTemplate;
          this.notify();
        }
        break;
      }
      case 'SLIDE_CHANGE': {
        this.state.currentSlide = Number(p.currentSlide ?? this.state.currentSlide);
        this.state.totalSlides = Number(p.totalSlides ?? this.state.totalSlides);
        this.notify();
        break;
      }
      case 'PARTICIPANT_JOINED': {
        const part = p as unknown as Participant;
        if (part && part.id) {
          this.state.participants = {
            ...this.state.participants,
            [part.id]: part,
          };
          this.notify();
          if (
            part.id !== this.localParticipantId &&
            this.localMediaStream &&
            this.localMediaStream.getTracks().length > 0
          ) {
            this.initiateOfferToPeer(part.id);
          }
        }
        break;
      }
      case 'PARTICIPANT_UPDATED': {
        const part = p as unknown as Participant;
        if (part && part.id) {
          this.state.participants = {
            ...this.state.participants,
            [part.id]: part,
          };
          this.notify();
        }
        break;
      }
      case 'PARTICIPANT_LEFT': {
        const pid = String(p.participantId || '');
        if (pid) {
          if (this.state.participants[pid]) {
            const next = { ...this.state.participants };
            delete next[pid];
            this.state.participants = next;
            this.notify();
          }
          const pc = this.peerConnections.get(pid);
          if (pc) {
            pc.close();
            this.peerConnections.delete(pid);
          }
          if (this.remoteStreams.has(pid)) {
            this.remoteStreams.delete(pid);
            this.notifyRemoteStreams();
          }
        }
        break;
      }
      case 'CHAT_MESSAGE': {
        const msg = p.message as ChatMessage;
        if (
          msg &&
          (!msg.roomId || msg.roomId === this.state.roomId) &&
          !this.state.messages.some((m) => m.id === msg.id)
        ) {
          this.state.messages = [
            ...this.state.messages,
            { ...msg, roomId: this.state.roomId },
          ];
          this.notify();
        }
        break;
      }
      case 'CHAT_CLEAR': {
        const targetRoomId = (p.roomId as string) || this.state.roomId;
        if (targetRoomId === this.state.roomId) {
          this.state.messages = [];
          this.notify();
        }
        break;
      }
      case 'CHAT_DELETE_MESSAGE': {
        const messageId = String(p.messageId || '');
        if (messageId) {
          this.state.messages = this.state.messages.filter((m) => m.id !== messageId);
          this.notify();
        }
        break;
      }
      case 'CHAT_LOCK_TOGGLE': {
        this.state.chatLocked = Boolean(p.chatLocked);
        this.notify();
        break;
      }
      case 'POLL_START':
      case 'POLL_UPDATED': {
        this.state.activePoll = (p.poll as LivePoll) || null;
        this.notify();
        break;
      }
      case 'ROLL_CALL_START': {
        const rc = p as unknown as { id: string; expiresAt: number; verifiedIds: string[] };
        this.state.activeRollCall = rc;
        this.notify();
        break;
      }
      case 'ROLL_CALL_ACK': {
        const verifiedIds = (p.verifiedIds as string[]) || [];
        if (this.state.activeRollCall) {
          this.state.activeRollCall = {
            ...this.state.activeRollCall,
            verifiedIds,
          };
          this.notify();
        }
        break;
      }
      case 'FILE_SHARE': {
        const file = p.file as SharedFileItem;
        if (file && !this.state.sharedFiles.some((f) => f.id === file.id)) {
          this.state.sharedFiles = [file, ...this.state.sharedFiles];
          this.notify();
        }
        break;
      }
      case 'WEBRTC_SIGNAL': {
        this.handleIncomingWebRTCSignal(p as unknown as WebRTCSignalPayload);
        break;
      }
      case 'EMOJI_REACTION': {
        const reaction = p.reaction as EmojiReactionEvent;
        if (reaction) {
          for (const l of this.reactionListeners) l(reaction);
        }
        break;
      }
    }
  }

  /**
   * Real-time elapsed attendance clock for actually connected participants.
   */
  private startRealTelemetryClock(): void {
    if (this.telemetryInterval) window.clearInterval(this.telemetryInterval);
    this.telemetryInterval = window.setInterval(() => {
      const now = Date.now();
      const updated: Record<string, Participant> = {};
      for (const [id, part] of Object.entries(this.state.participants)) {
        const elapsedMinutes = Math.max(0, Number(((now - part.joinedAt) / 60000).toFixed(1)));
        const hasVoted = Boolean(this.state.activePoll && id in this.state.activePoll.votes);
        const xp = calculateEngagementXp({
          activeMinutes: Math.max(1, elapsedMinutes),
          expectedMinutes: Math.max(1, elapsedMinutes),
          tabSwitches: part.tabSwitches,
          rollCallVerified: part.rollCallVerified,
          participatedInPoll: !this.state.activePoll || hasVoted,
        });
        updated[id] = {
          ...part,
          activeMinutes: elapsedMinutes,
          engagementXp: part.role === 'teacher' ? 100 : xp,
        };
      }
      this.state.participants = updated;
      this.notify();
    }, 5000);
  }

  // --- Classroom Actions ---

  public addStroke(stroke: WhiteboardStroke): void {
    const idx = stroke.slideIndex;
    if (idx >= this.state.totalSlides) {
      this.state.totalSlides = idx + 1;
    }
    const current = this.state.strokesBySlide[idx] || [];
    this.state.strokesBySlide = {
      ...this.state.strokesBySlide,
      [idx]: [...current, stroke],
    };
    this.notify();
    this.sendPacket('WHITEBOARD_STROKE', { slideIndex: idx, stroke });
  }

  public updateStroke(stroke: WhiteboardStroke): void {
    const idx = stroke.slideIndex;
    const current = this.state.strokesBySlide[idx] || [];
    this.state.strokesBySlide = {
      ...this.state.strokesBySlide,
      [idx]: current.map((s) => (s.id === stroke.id ? stroke : s)),
    };
    this.notify();
    this.sendPacket('WHITEBOARD_UPDATE_STROKE', { slideIndex: idx, stroke });
  }

  public deleteStroke(strokeId: string, slideIndex: number): void {
    const current = this.state.strokesBySlide[slideIndex] || [];
    this.state.strokesBySlide = {
      ...this.state.strokesBySlide,
      [slideIndex]: current.filter((s) => s.id !== strokeId),
    };
    this.notify();
    this.sendPacket('WHITEBOARD_DELETE_STROKE', { slideIndex, strokeId });
  }

  public undoStroke(slideIndex: number): void {
    const current = [...(this.state.strokesBySlide[slideIndex] || [])];
    current.pop();
    this.state.strokesBySlide = {
      ...this.state.strokesBySlide,
      [slideIndex]: current,
    };
    this.notify();
    this.sendPacket('WHITEBOARD_UNDO', { slideIndex });
  }

  public clearSlide(slideIndex: number): void {
    this.state.strokesBySlide = {
      ...this.state.strokesBySlide,
      [slideIndex]: [],
    };
    this.notify();
    this.sendPacket('WHITEBOARD_CLEAR', { slideIndex });
  }

  public moveLaser(laser: LaserPointerPosition | null): void {
    for (const l of this.laserListeners) l(laser);
    this.sendPacket('LASER_MOVE', { laser });
  }

  public setLayout(layout: PodLayoutMode): void {
    this.state.activeLayout = layout;
    if (layout === 'exam') {
      this.state.chatLocked = true;
    }
    this.notify();
    this.sendPacket('LAYOUT_CHANGE', { layout });
  }

  public setTemplate(template: BoardTemplate): void {
    this.state.activeTemplate = template;
    this.notify();
    this.sendPacket('TEMPLATE_CHANGE', { template });
  }

  public setSlide(slideIndex: number): void {
    const safeSlide = Math.max(0, slideIndex);
    if (safeSlide >= this.state.totalSlides) {
      this.state.totalSlides = safeSlide + 1;
    }
    if (!this.state.strokesBySlide[safeSlide]) {
      this.state.strokesBySlide[safeSlide] = [];
    }
    this.state.currentSlide = safeSlide;
    this.notify();
    this.sendPacket('SLIDE_CHANGE', { slideIndex: safeSlide });
  }

  public setSlideBackground(slideIndex: number, dataUrl: string): void {
    this.state.slideBackgrounds = {
      ...this.state.slideBackgrounds,
      [slideIndex]: dataUrl,
    };
    this.notify();
  }

  public updateFocusState(participantId: string, focusState: FocusState): void {
    const part = this.state.participants[participantId];
    if (!part) return;
    const incrementedSwitches =
      focusState === 'away' && part.focusState !== 'away'
        ? part.tabSwitches + 1
        : part.tabSwitches;
    const updated: Participant = {
      ...part,
      focusState,
      tabSwitches: incrementedSwitches,
      lastSeenAt: Date.now(),
    };
    this.state.participants = {
      ...this.state.participants,
      [participantId]: updated,
    };
    this.notify();
    this.sendPacket('FOCUS_UPDATE', { participantId, focusState });
  }

  public toggleHandRaise(participantId: string): void {
    const part = this.state.participants[participantId];
    if (!part) return;
    const nextRaised = !part.handRaised;
    this.state.participants = {
      ...this.state.participants,
      [participantId]: {
        ...part,
        handRaised: nextRaised,
        handRaisedAt: nextRaised ? Date.now() : null,
      },
    };
    this.notify();
    this.sendPacket('HAND_RAISE_TOGGLE', { participantId, handRaised: nextRaised });
  }

  public togglePermission(participantId: string, permission: 'mic' | 'cam' | 'pen'): void {
    const part = this.state.participants[participantId];
    if (!part) return;
    const nextVal =
      permission === 'mic'
        ? !part.micGranted
        : permission === 'cam'
        ? !part.camGranted
        : !part.penGranted;

    this.state.participants = {
      ...this.state.participants,
      [participantId]: {
        ...part,
        micGranted: permission === 'mic' ? nextVal : part.micGranted,
        camGranted: permission === 'cam' ? nextVal : part.camGranted,
        penGranted: permission === 'pen' ? nextVal : part.penGranted,
      },
    };
    this.notify();
    this.sendPacket('PERMISSION_TOGGLE', { participantId, permission, value: nextVal });
  }

  /**
   * Synchronizes real hardware camera/microphone mute & voice analyser state across the room.
   */
  public setLocalMediaState(
    participantId: string,
    updates: {
      micMuted?: boolean;
      camOff?: boolean;
      isSpeaking?: boolean;
      audioLevel?: number;
    }
  ): void {
    const part = this.state.participants[participantId];
    if (!part) return;
    const nextPart: Participant = {
      ...part,
      micMuted: typeof updates.micMuted === 'boolean' ? updates.micMuted : part.micMuted,
      camOff: typeof updates.camOff === 'boolean' ? updates.camOff : part.camOff,
      isSpeaking: typeof updates.isSpeaking === 'boolean' ? updates.isSpeaking : part.isSpeaking,
      audioLevel: typeof updates.audioLevel === 'number' ? updates.audioLevel : part.audioLevel,
    };
    this.state.participants = {
      ...this.state.participants,
      [participantId]: nextPart,
    };
    this.notify();
    this.sendPacket('MEDIA_STATE_TOGGLE', {
      participantId,
      micMuted: nextPart.micMuted,
      camOff: nextPart.camOff,
      isSpeaking: nextPart.isSpeaking,
      audioLevel: nextPart.audioLevel,
    });
  }

  public sendChatMessage(params: {
    senderId: string;
    senderName: string;
    senderRole: UserRole;
    channel: 'public' | 'private_host' | 'pinned';
    text: string;
    targetParticipantId?: string;
    targetParticipantName?: string;
  }): void {
    const trimmed = params.text.trim();
    if (!trimmed) return;
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      roomId: this.state.roomId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderRole: params.senderRole,
      channel: params.channel,
      targetParticipantId: params.targetParticipantId,
      targetParticipantName: params.targetParticipantName,
      text: trimmed,
      timestamp: Date.now(),
      pinned: params.channel === 'pinned',
    };
    this.state.messages = [...this.state.messages, message];
    this.notify();
    this.sendPacket('CHAT_MESSAGE', { message });
  }

  public clearChat(): void {
    this.state.messages = [];
    this.notify();
    this.sendPacket('CHAT_CLEAR', { roomId: this.state.roomId });
  }

  public deleteChatMessage(messageId: string): void {
    this.state.messages = this.state.messages.filter((m) => m.id !== messageId);
    this.notify();
    this.sendPacket('CHAT_DELETE_MESSAGE', { roomId: this.state.roomId, messageId });
  }

  public toggleChatLock(): void {
    const nextLocked = !this.state.chatLocked;
    this.state.chatLocked = nextLocked;
    this.notify();
    this.sendPacket('CHAT_LOCK_TOGGLE', { chatLocked: nextLocked });
  }

  public startPoll(poll: LivePoll): void {
    this.state.activePoll = poll;
    this.notify();
    this.sendPacket('POLL_START', { poll });
  }

  public votePoll(participantId: string, optionIndex: number): void {
    if (!this.state.activePoll) return;
    this.state.activePoll = {
      ...this.state.activePoll,
      votes: {
        ...this.state.activePoll.votes,
        [participantId]: optionIndex,
      },
    };
    this.notify();
    this.sendPacket('POLL_VOTE', { participantId, optionIndex });
  }

  public togglePollReveal(): void {
    if (!this.state.activePoll) return;
    this.state.activePoll = {
      ...this.state.activePoll,
      revealAnswer: !this.state.activePoll.revealAnswer,
    };
    this.notify();
    this.sendPacket('POLL_REVEAL_TOGGLE', {});
  }

  public triggerRollCall(): void {
    const rc = {
      id: `rc-${Date.now()}`,
      expiresAt: Date.now() + 30000,
      verifiedIds: [this.localParticipantId],
    };
    this.state.activeRollCall = rc;

    const updated: Record<string, Participant> = {};
    for (const [id, p] of Object.entries(this.state.participants)) {
      updated[id] = {
        ...p,
        rollCallVerified: p.role !== 'student' || id === this.localParticipantId,
      };
    }
    this.state.participants = updated;
    this.notify();
    this.sendPacket('ROLL_CALL_START', { hostId: this.localParticipantId });
  }

  public acknowledgeRollCall(participantId: string): void {
    if (!this.state.activeRollCall) return;
    const verifiedIds = this.state.activeRollCall.verifiedIds.includes(participantId)
      ? this.state.activeRollCall.verifiedIds
      : [...this.state.activeRollCall.verifiedIds, participantId];

    this.state.activeRollCall = {
      ...this.state.activeRollCall,
      verifiedIds,
    };

    const part = this.state.participants[participantId];
    if (part) {
      this.state.participants = {
        ...this.state.participants,
        [participantId]: {
          ...part,
          rollCallVerified: true,
        },
      };
    }
    this.notify();
    this.sendPacket('ROLL_CALL_ACK', { participantId });
  }

  public dismissRollCall(): void {
    this.state.activeRollCall = null;
    this.notify();
  }

  public addSharedFile(file: SharedFileItem): void {
    this.state.sharedFiles = [file, ...this.state.sharedFiles];
    this.notify();
    this.sendPacket('FILE_SHARE', { file });
  }

  public incrementFileDownload(fileId: string): void {
    this.state.sharedFiles = this.state.sharedFiles.map((f) =>
      f.id === fileId ? { ...f, downloads: f.downloads + 1 } : f
    );
    this.notify();
  }

  public sendEmojiReaction(senderId: string, senderName: string, emoji: string): void {
    const reaction: EmojiReactionEvent = {
      id: `re-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      senderId,
      senderName,
      emoji,
      xPercent: 18 + Math.random() * 64,
      timestamp: Date.now(),
    };
    for (const l of this.reactionListeners) l(reaction);
    this.sendPacket('EMOJI_REACTION', { reaction });
  }

  public startCanvasRecording(canvas: HTMLCanvasElement | null): boolean {
    if (
      !canvas ||
      typeof canvas.captureStream !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      return false;
    }
    try {
      const stream = canvas.captureStream(30);
      this.recordedChunks = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm',
      });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `B2Connect_${this.state.roomId || 'session'}_${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      recorder.start(500);
      this.mediaRecorder = recorder;
      return true;
    } catch {
      return false;
    }
  }

  public stopCanvasRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.telemetryInterval) {
      window.clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
    for (const [, pc] of this.peerConnections.entries()) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
    }
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.notifyRemoteStreams();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const roomEngine = new B2RoomEngine();
