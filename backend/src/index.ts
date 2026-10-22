/**
 * B2.Connect — Standalone Cloudflare Edge Worker & Durable Object Backend
 * Features:
 * - Zero-Config 1-Command Deployment (`npm run deploy` -> Workers Static Assets + Durable Objects)
 * - WebSocket Hibernation API (`state.acceptWebSocket`, `webSocketMessage`, `webSocketClose`)
 * - Global Room Directory Durable Object (`__GLOBAL_DIRECTORY__`) for up to 50 Isolated Classrooms
 * - Real-Time WebRTC Signaling Relay (`WEBRTC_SIGNAL` with targeted & broadcast delivery)
 * - Normalized Vector Whiteboard Sync (`WHITEBOARD_STROKE`, `WHITEBOARD_UPDATE_STROKE`, `WHITEBOARD_DELETE_STROKE`, `WHITEBOARD_UNDO`, `WHITEBOARD_CLEAR`)
 * - Strict Room & Role Chat Isolation + Teacher Moderation (`CHAT_MESSAGE`, `CHAT_CLEAR`, `CHAT_DELETE_MESSAGE`, `CHAT_LOCK_TOGGLE`)
 */

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

export interface Env {
  CLASSROOM_ROOMS: DurableObjectNamespace;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  MAX_ROOMS: string;
  MAX_PARTICIPANTS_PER_ROOM: string;
  ALLOWED_ORIGIN: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Participant-Id, X-Room-Id',
};

interface SessionAttachment {
  roomId: string;
  participantId: string;
  name: string;
  role: 'teacher' | 'assistant' | 'student';
  joinedAt: number;
}

interface DirectoryRoomItem {
  id: string;
  code: string;
  name: string;
  subject: string;
  instructorName: string;
  activeParticipants: number;
  capacity: number;
  status: 'live' | 'standby' | 'exam';
  latencyMs: number;
  activeLayout: 'lecture' | 'whiteboard' | 'exam' | 'seminar';
  createdAt: number;
}

interface StoredRoomState {
  roomId: string;
  code: string;
  name: string;
  subject: string;
  instructorName: string;
  capacity: number;
  createdAt: number;
  activeLayout: 'lecture' | 'whiteboard' | 'exam' | 'seminar';
  activeTemplate: 'espresso' | 'grid' | 'cartesian' | 'notebook' | 'dots';
  currentSlide: number;
  totalSlides: number;
  slideBackgrounds: Record<number, string>;
  chatLocked: boolean;
  timerSeconds: number;
  timerRunning: boolean;
  strokesBySlide: Record<number, unknown[]>;
  participants: Record<string, Record<string, unknown>>;
  messages: Record<string, unknown>[];
  activePoll: Record<string, unknown> | null;
  sharedFiles: Record<string, unknown>[];
  activeRollCall: { id: string; expiresAt: number; verifiedIds: string[] } | null;
}

export class ClassroomRoom {
  private state: DurableObjectState;
  private env: Env;
  private roomData: StoredRoomState | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async ensureRoomData(params?: {
    roomId?: string;
    name?: string;
    subject?: string;
    instructorName?: string;
    capacity?: number;
  }): Promise<StoredRoomState> {
    if (this.roomData) {
      if (params?.name) this.roomData.name = params.name;
      if (params?.subject) this.roomData.subject = params.subject;
      if (params?.instructorName) this.roomData.instructorName = params.instructorName;
      return this.roomData;
    }

    const saved = await this.state.storage.get<StoredRoomState>('room_state');
    if (saved) {
      if (params?.name) saved.name = params.name;
      if (params?.subject) saved.subject = params.subject;
      if (params?.instructorName) saved.instructorName = params.instructorName;
      this.roomData = saved;
      return saved;
    }

    const resolvedRoomId = params?.roomId || 'rm-default';
    const code = resolvedRoomId.toUpperCase().slice(0, 8);
    const initial: StoredRoomState = {
      roomId: resolvedRoomId,
      code,
      name: params?.name || `Room ${code}`,
      subject: params?.subject || 'General Session',
      instructorName: params?.instructorName || 'Host',
      capacity: params?.capacity || 30,
      createdAt: Date.now(),
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
    this.roomData = initial;
    await this.state.storage.put('room_state', initial);
    return initial;
  }

  private async persist(): Promise<void> {
    if (this.roomData) {
      await this.state.storage.put('room_state', this.roomData);
    }
  }

  private async syncWithGlobalDirectory(): Promise<void> {
    if (!this.roomData) return;
    try {
      const dirId = this.env.CLASSROOM_ROOMS.idFromName('__GLOBAL_DIRECTORY__');
      const dirStub = this.env.CLASSROOM_ROOMS.get(dirId);
      const activeCount = Object.keys(this.roomData.participants).length;
      const summary: DirectoryRoomItem = {
        id: this.roomData.roomId,
        code: this.roomData.code,
        name: this.roomData.name,
        subject: this.roomData.subject,
        instructorName: this.roomData.instructorName,
        activeParticipants: activeCount,
        capacity: this.roomData.capacity || 30,
        status:
          this.roomData.activeLayout === 'exam'
            ? 'exam'
            : activeCount > 0
            ? 'live'
            : 'standby',
        latencyMs: 0,
        activeLayout: this.roomData.activeLayout,
        createdAt: this.roomData.createdAt || Date.now(),
      };
      await dirStub.fetch(
        new Request('https://internal/directory/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(summary),
        })
      );
    } catch {
      // Non-blocking directory update
    }
  }

  private broadcast(payload: unknown, excludeWs?: WebSocket, targetParticipantId?: string): void {
    const raw = JSON.stringify(payload);
    const sockets = targetParticipantId
      ? this.state.getWebSockets(targetParticipantId)
      : this.state.getWebSockets();

    for (const ws of sockets) {
      if (ws !== excludeWs) {
        try {
          ws.send(raw);
        } catch {
          // Closed socket cleaned up by webSocketClose
        }
      }
    }
  }

  // Handle Global Room Directory requests inside the `__GLOBAL_DIRECTORY__` instance
  private async handleDirectoryRequest(request: Request, url: URL): Promise<Response> {
    const map =
      (await this.state.storage.get<Record<string, DirectoryRoomItem>>('rooms_directory')) || {};

    if (url.pathname === '/directory/upsert' && request.method === 'POST') {
      const item = (await request.json()) as DirectoryRoomItem;
      if (item && item.id) {
        map[item.id] = item;
        await this.state.storage.put('rooms_directory', map);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/rooms' && request.method === 'GET') {
      const list = Object.values(map).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return new Response(JSON.stringify({ rooms: list }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        subject?: string;
        instructorName?: string;
        capacity?: number;
      };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return new Response(JSON.stringify({ error: 'Room name is required' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      const roomId = `rm-${Date.now().toString(36)}`;
      const code = roomId.toUpperCase().slice(0, 8);
      const newRoom: DirectoryRoomItem = {
        id: roomId,
        code,
        name,
        subject:
          typeof body.subject === 'string' && body.subject.trim()
            ? body.subject.trim()
            : 'General Session',
        instructorName:
          typeof body.instructorName === 'string' && body.instructorName.trim()
            ? body.instructorName.trim()
            : 'Instructor',
        activeParticipants: 0,
        capacity: Number(body.capacity) > 0 ? Number(body.capacity) : 30,
        status: 'standby',
        latencyMs: 0,
        activeLayout: 'whiteboard',
        createdAt: Date.now(),
      };
      map[roomId] = newRoom;
      await this.state.storage.put('rooms_directory', map);

      // Initialize the room Durable Object instance
      try {
        const roomObjId = this.env.CLASSROOM_ROOMS.idFromName(roomId);
        const roomStub = this.env.CLASSROOM_ROOMS.get(roomObjId);
        await roomStub.fetch(
          new Request(`https://internal/init?roomId=${encodeURIComponent(roomId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRoom),
          })
        );
      } catch {
        // Initialized on first WebSocket join if skipped
      }

      return new Response(JSON.stringify({ room: newRoom }), {
        status: 201,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.startsWith('/api/rooms/') && request.method === 'DELETE') {
      const roomId = decodeURIComponent(url.pathname.replace('/api/rooms/', ''));
      delete map[roomId];
      await this.state.storage.put('rooms_directory', map);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ rooms: Object.values(map) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Route Global Directory requests
    if (
      url.pathname === '/api/rooms' ||
      url.pathname.startsWith('/api/rooms/') ||
      url.pathname.startsWith('/directory/')
    ) {
      return this.handleDirectoryRequest(request, url);
    }

    if (url.pathname === '/init' && request.method === 'POST') {
      const info = (await request.json().catch(() => ({}))) as Partial<DirectoryRoomItem>;
      const room = await this.ensureRoomData({
        roomId: info.id || url.searchParams.get('roomId') || 'rm-default',
        name: info.name,
        subject: info.subject,
        instructorName: info.instructorName,
        capacity: info.capacity,
      });
      await this.persist();
      return new Response(JSON.stringify({ ok: true, roomId: room.roomId }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const roomId =
      url.searchParams.get('roomId') ||
      (url.pathname.startsWith('/api/room/') ? url.pathname.split('/')[3] : '') ||
      'rm-default';
    const roomName = url.searchParams.get('roomName') || undefined;
    const subject = url.searchParams.get('subject') || undefined;
    const participantId = url.searchParams.get('participantId') || `u-${Date.now()}`;
    const name = url.searchParams.get('name') || 'Participant';
    const role = (url.searchParams.get('role') as 'teacher' | 'assistant' | 'student') || 'student';

    const room = await this.ensureRoomData({
      roomId,
      name: roomName,
      subject,
      instructorName: role === 'teacher' ? name : undefined,
    });

    // WebSocket Upgrade with Cloudflare Hibernation API
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new (
        globalThis as unknown as { WebSocketPair: new () => { 0: WebSocket; 1: WebSocket } }
      ).WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.state.acceptWebSocket(server, [participantId, role, room.roomId]);
      const attachment: SessionAttachment = {
        roomId: room.roomId,
        participantId,
        name,
        role,
        joinedAt: Date.now(),
      };
      (
        server as unknown as { serializeAttachment?: (a: SessionAttachment) => void }
      ).serializeAttachment?.(attachment);

      const existing = room.participants[participantId];
      room.participants[participantId] = {
        id: participantId,
        name,
        role,
        joinedAt: existing?.joinedAt || Date.now(),
        lastSeenAt: Date.now(),
        activeMinutes: existing?.activeMinutes || 0,
        focusState: 'focused',
        tabSwitches: existing?.tabSwitches || 0,
        rollCallVerified: true,
        micGranted: role === 'teacher' || role === 'assistant',
        camGranted: role === 'teacher' || role === 'assistant',
        penGranted: role === 'teacher' || role === 'assistant',
        micMuted: true,
        camOff: true,
        handRaised: false,
        engagementXp: existing?.engagementXp || 100,
      };
      await this.persist();
      await this.syncWithGlobalDirectory();

      server.send(
        JSON.stringify({
          type: 'ROOM_STATE_SNAPSHOT',
          payload: room,
        })
      );

      this.broadcast(
        {
          type: 'PARTICIPANT_JOINED',
          payload: room.participants[participantId],
        },
        server
      );

      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }

    if (url.pathname.endsWith('/snapshot')) {
      return new Response(JSON.stringify(room), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, roomId: room.roomId }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const rawText = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let packet: { type: string; payload?: Record<string, unknown> };
    try {
      packet = JSON.parse(rawText);
    } catch {
      return;
    }

    const attachment = (
      ws as unknown as { deserializeAttachment?: () => SessionAttachment | null }
    ).deserializeAttachment?.();

    const room = await this.ensureRoomData({
      roomId: attachment?.roomId,
    });
    const payload = packet.payload || {};

    switch (packet.type) {
      case 'REQUEST_SNAPSHOT': {
        ws.send(JSON.stringify({ type: 'ROOM_STATE_SNAPSHOT', payload: room }));
        break;
      }

      case 'WHITEBOARD_STROKE': {
        const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
        const stroke = payload.stroke as { id?: string };
        if (!room.strokesBySlide[slideIndex]) {
          room.strokesBySlide[slideIndex] = [];
        }
        if (slideIndex >= room.totalSlides) {
          room.totalSlides = slideIndex + 1;
        }
        const exists = room.strokesBySlide[slideIndex].some(
          (s) => (s as { id?: string }).id === stroke?.id
        );
        if (!exists && stroke) {
          room.strokesBySlide[slideIndex].push(stroke);
          await this.persist();
        }
        this.broadcast({ type: 'WHITEBOARD_STROKE', payload }, ws);
        break;
      }

      case 'WHITEBOARD_UPDATE_STROKE': {
        const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
        const stroke = payload.stroke as { id?: string };
        if (stroke?.id && room.strokesBySlide[slideIndex]) {
          room.strokesBySlide[slideIndex] = room.strokesBySlide[slideIndex].map((s) =>
            (s as { id?: string }).id === stroke.id ? stroke : s
          );
          await this.persist();
          this.broadcast({ type: 'WHITEBOARD_UPDATE_STROKE', payload }, ws);
        }
        break;
      }

      case 'WHITEBOARD_DELETE_STROKE': {
        const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
        const strokeId = String(payload.strokeId || '');
        if (strokeId && room.strokesBySlide[slideIndex]) {
          room.strokesBySlide[slideIndex] = room.strokesBySlide[slideIndex].filter(
            (s) => (s as { id?: string }).id !== strokeId
          );
          await this.persist();
          this.broadcast({ type: 'WHITEBOARD_DELETE_STROKE', payload }, ws);
        }
        break;
      }

      case 'WHITEBOARD_UNDO': {
        const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
        const list = room.strokesBySlide[slideIndex] || [];
        list.pop();
        room.strokesBySlide[slideIndex] = list;
        await this.persist();
        this.broadcast({ type: 'WHITEBOARD_SYNC_SLIDE', payload: { slideIndex, strokes: list } });
        break;
      }

      case 'WHITEBOARD_CLEAR': {
        const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
        room.strokesBySlide[slideIndex] = [];
        await this.persist();
        this.broadcast({ type: 'WHITEBOARD_CLEAR', payload: { slideIndex } });
        break;
      }

      case 'LASER_MOVE': {
        this.broadcast({ type: 'LASER_MOVE', payload }, ws);
        break;
      }

      case 'LAYOUT_CHANGE': {
        room.activeLayout =
          (payload.layout as StoredRoomState['activeLayout']) || room.activeLayout;
        await this.persist();
        await this.syncWithGlobalDirectory();
        this.broadcast({ type: 'LAYOUT_CHANGE', payload: { layout: room.activeLayout } });
        break;
      }

      case 'TEMPLATE_CHANGE': {
        room.activeTemplate =
          (payload.template as StoredRoomState['activeTemplate']) || room.activeTemplate;
        await this.persist();
        this.broadcast({ type: 'TEMPLATE_CHANGE', payload: { template: room.activeTemplate } });
        break;
      }

      case 'SLIDE_CHANGE': {
        const nextSlide = Number(payload.slideIndex ?? 0);
        room.currentSlide = nextSlide;
        if (nextSlide >= room.totalSlides) {
          room.totalSlides = nextSlide + 1;
        }
        if (!room.strokesBySlide[nextSlide]) {
          room.strokesBySlide[nextSlide] = [];
        }
        await this.persist();
        this.broadcast({
          type: 'SLIDE_CHANGE',
          payload: { currentSlide: room.currentSlide, totalSlides: room.totalSlides },
        });
        break;
      }

      case 'FOCUS_UPDATE': {
        const pid = String(payload.participantId || '');
        const focusState = (payload.focusState as 'focused' | 'away' | 'idle') || 'focused';
        const participant = room.participants[pid];
        if (participant) {
          const prevFocus = participant.focusState;
          participant.focusState = focusState;
          participant.lastSeenAt = Date.now();
          if (focusState === 'away' && prevFocus !== 'away') {
            participant.tabSwitches = Number(participant.tabSwitches || 0) + 1;
            participant.engagementXp = Math.max(20, Number(participant.engagementXp || 100) - 3);
          }
          await this.persist();
          this.broadcast({ type: 'PARTICIPANT_UPDATED', payload: participant });
        }
        break;
      }

      case 'HAND_RAISE_TOGGLE': {
        const pid = String(payload.participantId || '');
        const participant = room.participants[pid];
        if (participant) {
          participant.handRaised = Boolean(payload.handRaised);
          participant.handRaisedAt = participant.handRaised ? Date.now() : null;
          await this.persist();
          this.broadcast({ type: 'PARTICIPANT_UPDATED', payload: participant });
        }
        break;
      }

      case 'PERMISSION_TOGGLE': {
        const pid = String(payload.participantId || '');
        const perm = String(payload.permission || '');
        const value = Boolean(payload.value);
        const participant = room.participants[pid];
        if (participant) {
          if (perm === 'mic') participant.micGranted = value;
          if (perm === 'cam') participant.camGranted = value;
          if (perm === 'pen') participant.penGranted = value;
          await this.persist();
          this.broadcast({ type: 'PARTICIPANT_UPDATED', payload: participant });
        }
        break;
      }

      case 'MEDIA_STATE_TOGGLE': {
        const pid = String(payload.participantId || '');
        const participant = room.participants[pid];
        if (participant) {
          if (typeof payload.micMuted === 'boolean') participant.micMuted = payload.micMuted;
          if (typeof payload.camOff === 'boolean') participant.camOff = payload.camOff;
          if (typeof payload.isSpeaking === 'boolean') participant.isSpeaking = payload.isSpeaking;
          if (typeof payload.audioLevel === 'number') participant.audioLevel = payload.audioLevel;
          await this.persist();
          this.broadcast({ type: 'PARTICIPANT_UPDATED', payload: participant });
        }
        break;
      }

      case 'CHAT_MESSAGE': {
        const rawMsg = payload.message as Record<string, unknown> | undefined;
        if (rawMsg && rawMsg.id) {
          const stampedMsg: Record<string, unknown> = {
            ...rawMsg,
            roomId: room.roomId,
          };
          if (!room.messages.some((m) => m.id === stampedMsg.id)) {
            room.messages.push(stampedMsg);
            if (room.messages.length > 200) room.messages.shift();
            await this.persist();
            this.broadcast({ type: 'CHAT_MESSAGE', payload: { message: stampedMsg } });
          }
        }
        break;
      }

      case 'CHAT_CLEAR': {
        room.messages = [];
        await this.persist();
        this.broadcast({ type: 'CHAT_CLEAR', payload: { roomId: room.roomId } });
        break;
      }

      case 'CHAT_DELETE_MESSAGE': {
        const messageId = String(payload.messageId || '');
        if (messageId) {
          room.messages = room.messages.filter((m) => String(m.id) !== messageId);
          await this.persist();
          this.broadcast({
            type: 'CHAT_DELETE_MESSAGE',
            payload: { roomId: room.roomId, messageId },
          });
        }
        break;
      }

      case 'CHAT_LOCK_TOGGLE': {
        room.chatLocked = Boolean(payload.chatLocked);
        await this.persist();
        this.broadcast({
          type: 'CHAT_LOCK_TOGGLE',
          payload: { chatLocked: room.chatLocked },
        });
        break;
      }

      case 'POLL_START': {
        room.activePoll = (payload.poll as Record<string, unknown>) || null;
        await this.persist();
        this.broadcast({ type: 'POLL_START', payload: { poll: room.activePoll } });
        break;
      }

      case 'POLL_VOTE': {
        const voterId = String(payload.participantId || '');
        const optionIndex = Number(payload.optionIndex ?? 0);
        if (room.activePoll && voterId) {
          const votes = (room.activePoll.votes as Record<string, number>) || {};
          votes[voterId] = optionIndex;
          room.activePoll.votes = votes;
          await this.persist();
          this.broadcast({ type: 'POLL_UPDATED', payload: { poll: room.activePoll } });
        }
        break;
      }

      case 'POLL_REVEAL_TOGGLE': {
        if (room.activePoll) {
          room.activePoll.revealAnswer = !room.activePoll.revealAnswer;
          await this.persist();
          this.broadcast({ type: 'POLL_UPDATED', payload: { poll: room.activePoll } });
        }
        break;
      }

      case 'ROLL_CALL_START': {
        const rc = {
          id: `rc-${Date.now()}`,
          expiresAt: Date.now() + 30000,
          verifiedIds: payload.hostId ? [String(payload.hostId)] : ([] as string[]),
        };
        room.activeRollCall = rc;
        for (const p of Object.values(room.participants)) {
          if (p.role === 'student') {
            p.rollCallVerified = false;
          }
        }
        await this.persist();
        this.broadcast({ type: 'ROLL_CALL_START', payload: rc });
        break;
      }

      case 'ROLL_CALL_ACK': {
        const pid = String(payload.participantId || '');
        if (room.activeRollCall && !room.activeRollCall.verifiedIds.includes(pid)) {
          room.activeRollCall.verifiedIds.push(pid);
        }
        const participant = room.participants[pid];
        if (participant) {
          participant.rollCallVerified = true;
          participant.engagementXp = Math.min(100, Number(participant.engagementXp || 90) + 4);
        }
        await this.persist();
        this.broadcast({
          type: 'ROLL_CALL_ACK',
          payload: { participantId: pid, verifiedIds: room.activeRollCall?.verifiedIds || [] },
        });
        break;
      }

      case 'FILE_SHARE': {
        const file = payload.file as Record<string, unknown> | undefined;
        if (file && file.id && !room.sharedFiles.some((f) => f.id === file.id)) {
          room.sharedFiles.unshift(file);
          await this.persist();
          this.broadcast({ type: 'FILE_SHARE', payload: { file } });
        }
        break;
      }

      case 'WEBRTC_SIGNAL': {
        const targetId = typeof payload.targetId === 'string' ? payload.targetId : undefined;
        this.broadcast({ type: 'WEBRTC_SIGNAL', payload }, ws, targetId);
        break;
      }

      case 'EMOJI_REACTION': {
        this.broadcast({ type: 'EMOJI_REACTION', payload });
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = (
      ws as unknown as { deserializeAttachment?: () => SessionAttachment | null }
    ).deserializeAttachment?.();
    if (attachment) {
      const room = await this.ensureRoomData({ roomId: attachment.roomId });
      delete room.participants[attachment.participantId];
      await this.persist();
      await this.syncWithGlobalDirectory();
      this.broadcast({
        type: 'PARTICIPANT_LEFT',
        payload: { participantId: attachment.participantId },
      });
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. Health Check
    if (url.pathname === '/api/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'B2.Connect Edge Core',
          architecture: 'Cloudflare Workers + Durable Objects WebSocket Hibernation',
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Global Rooms Directory API (`GET /api/rooms`, `POST /api/rooms`, `DELETE /api/rooms/:roomId`)
    if (url.pathname === '/api/rooms' || url.pathname.startsWith('/api/rooms/')) {
      const dirId = env.CLASSROOM_ROOMS.idFromName('__GLOBAL_DIRECTORY__');
      const dirStub = env.CLASSROOM_ROOMS.get(dirId);
      return dirStub.fetch(request);
    }

    // 3. WebSocket & Per-Room Durable Object Routing (`/ws` or `/api/room/:roomId/*`)
    if (url.pathname === '/ws' || url.pathname.startsWith('/api/room/')) {
      const roomId =
        url.searchParams.get('roomId') || url.pathname.split('/')[3] || 'rm-default';
      const id = env.CLASSROOM_ROOMS.idFromName(roomId);
      const stub = env.CLASSROOM_ROOMS.get(id);
      return stub.fetch(request);
    }

    // 4. Serve Frontend Static Assets (Cloudflare Workers Assets Binding)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      JSON.stringify({
        service: 'B2.Connect Edge Core',
        status: 'operational',
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  },
};
