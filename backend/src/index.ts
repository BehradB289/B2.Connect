/**
 * B2.Connect — Cloudflare Edge Worker & Durable Object Backend
 * Features:
 * - WebSocket Hibernation API (`state.acceptWebSocket`, `webSocketMessage`, `webSocketClose`)
 * - Full Room State Snapshot Hydration (`ROOM_STATE_SNAPSHOT`)
 * - Asymmetric 1-to-Many WebRTC Signaling Relay (`WEBRTC_SIGNAL`)
 * - Normalized Vector Whiteboard Sync (`WHITEBOARD_STROKE`, `WHITEBOARD_CLEAR`, `LASER_MOVE`)
 * - Granular Attendance & Anti-Cheat Focus Telemetry (`FOCUS_UPDATE`, `ROLL_CALL_START`, `ROLL_CALL_ACK`)
 * - Cloudflare D1 SQLite Persistence & R2 Object Vault Endpoints
 */

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface R2ObjectBody {
  body: ReadableStream | null;
  httpMetadata?: { contentType?: string };
  size: number;
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
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
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

export interface Env {
  CLASSROOM_ROOMS: DurableObjectNamespace;
  DB: D1Database;
  FILES: R2Bucket;
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
  participantId: string;
  name: string;
  role: 'teacher' | 'assistant' | 'student';
  joinedAt: number;
}

interface StoredRoomState {
  roomId: string;
  name: string;
  subject: string;
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
  messages: unknown[];
  activePoll: unknown | null;
  sharedFiles: unknown[];
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

  private async ensureRoomData(roomId: string): Promise<StoredRoomState> {
    if (this.roomData) return this.roomData;
    const saved = await this.state.storage.get<StoredRoomState>('room_state');
    if (saved) {
      this.roomData = saved;
      return saved;
    }
    const initial: StoredRoomState = {
      roomId,
      name: `Room ${roomId.toUpperCase()}`,
      subject: 'STEM Virtual Classroom',
      activeLayout: 'whiteboard',
      activeTemplate: 'cartesian',
      currentSlide: 0,
      totalSlides: 3,
      slideBackgrounds: {},
      chatLocked: false,
      timerSeconds: 1500,
      timerRunning: false,
      strokesBySlide: { 0: [], 1: [], 2: [] },
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

  private broadcast(payload: unknown, excludeWs?: WebSocket): void {
    const raw = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== excludeWs) {
        try {
          ws.send(raw);
        } catch {
          // Closed socket cleaned up by webSocketClose
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const roomId = url.searchParams.get('roomId') || 'room-101';
    const room = await this.ensureRoomData(roomId);

    // WebSocket Upgrade with Cloudflare Hibernation API
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new (globalThis as unknown as { WebSocketPair: new () => { 0: WebSocket; 1: WebSocket } }).WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      const participantId = url.searchParams.get('participantId') || `u-${Date.now()}`;
      const name = url.searchParams.get('name') || 'Guest Student';
      const role = (url.searchParams.get('role') as 'teacher' | 'assistant' | 'student') || 'student';

      this.state.acceptWebSocket(server, [participantId, role]);
      const attachment: SessionAttachment = {
        participantId,
        name,
        role,
        joinedAt: Date.now(),
      };
      (server as unknown as { serializeAttachment?: (a: SessionAttachment) => void }).serializeAttachment?.(attachment);

      const existing = room.participants[participantId];
      room.participants[participantId] = {
        id: participantId,
        name,
        role,
        joinedAt: existing?.joinedAt || Date.now(),
        lastSeenAt: Date.now(),
        activeMinutes: existing?.activeMinutes || 1,
        focusState: 'focused',
        tabSwitches: existing?.tabSwitches || 0,
        rollCallVerified: true,
        micGranted: role === 'teacher' || role === 'assistant',
        camGranted: role === 'teacher' || role === 'assistant',
        penGranted: role === 'teacher' || role === 'assistant',
        micMuted: role === 'student',
        camOff: role === 'student',
        handRaised: false,
        engagementXp: existing?.engagementXp || 96,
      };
      await this.persist();

      // Log join event in D1 asynchronously
      try {
        await this.env.DB.prepare(
          `INSERT INTO attendance_logs (room_id, participant_id, participant_name, role, event_type, timestamp) VALUES (?, ?, ?, ?, 'join', ?)`
        )
          .bind(roomId, participantId, name, role, Date.now())
          .run();
      } catch {
        // Non-blocking if D1 table not migrated yet
      }

      // Send immediate snapshot to connecting client
      server.send(
        JSON.stringify({
          type: 'ROOM_STATE_SNAPSHOT',
          payload: room,
        })
      );

      // Notify peers
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

    const room = await this.ensureRoomData('room-101');
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
        // Ephemeral 60fps broadcast without storage write for zero latency
        this.broadcast({ type: 'LASER_MOVE', payload }, ws);
        break;
      }

      case 'LAYOUT_CHANGE': {
        room.activeLayout = (payload.layout as StoredRoomState['activeLayout']) || room.activeLayout;
        await this.persist();
        this.broadcast({ type: 'LAYOUT_CHANGE', payload: { layout: room.activeLayout } });
        break;
      }

      case 'TEMPLATE_CHANGE': {
        room.activeTemplate = (payload.template as StoredRoomState['activeTemplate']) || room.activeTemplate;
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

      case 'CHAT_MESSAGE': {
        const msg = payload.message as { id?: string };
        if (msg && !room.messages.some((m) => (m as { id?: string }).id === msg.id)) {
          room.messages.push(msg);
          if (room.messages.length > 200) room.messages.shift();
          await this.persist();
          this.broadcast({ type: 'CHAT_MESSAGE', payload: { message: msg } });
        }
        break;
      }

      case 'POLL_START': {
        room.activePoll = payload.poll || null;
        await this.persist();
        this.broadcast({ type: 'POLL_START', payload: { poll: room.activePoll } });
        break;
      }

      case 'POLL_VOTE': {
        const poll = room.activePoll as {
          id: string;
          votes: Record<string, number>;
        } | null;
        const voterId = String(payload.participantId || '');
        const optionIndex = Number(payload.optionIndex ?? 0);
        if (poll && voterId) {
          poll.votes = poll.votes || {};
          poll.votes[voterId] = optionIndex;
          await this.persist();
          this.broadcast({ type: 'POLL_UPDATED', payload: { poll } });
        }
        break;
      }

      case 'ROLL_CALL_START': {
        const rc = {
          id: `rc-${Date.now()}`,
          expiresAt: Date.now() + 30000,
          verifiedIds: [] as string[],
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

      case 'WEBRTC_SIGNAL': {
        this.broadcast({ type: 'WEBRTC_SIGNAL', payload }, ws);
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
    if (attachment && this.roomData) {
      delete this.roomData.participants[attachment.participantId];
      await this.persist();
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

    // 1. WebSocket & Room Durable Object Routing
    if (url.pathname.startsWith('/api/room/') || url.pathname === '/ws') {
      const roomId = url.searchParams.get('roomId') || url.pathname.split('/')[3] || 'room-101';
      const id = env.CLASSROOM_ROOMS.idFromName(roomId);
      const stub = env.CLASSROOM_ROOMS.get(id);
      return stub.fetch(request);
    }

    // 2. Super Admin 50-Room Directory Endpoint (D1)
    if (url.pathname === '/api/rooms' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare(
          `SELECT * FROM rooms ORDER BY created_at DESC LIMIT 50`
        ).all();
        return new Response(JSON.stringify({ rooms: results }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } catch {
        return new Response(JSON.stringify({ rooms: [] }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. R2 Cloud File Vault Upload & Download
    if (url.pathname.startsWith('/api/files/')) {
      const key = url.pathname.replace('/api/files/', '');
      if (request.method === 'PUT' || request.method === 'POST') {
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        await env.FILES.put(key, request.body, {
          httpMetadata: { contentType },
        });
        return new Response(JSON.stringify({ ok: true, key }), {
          status: 201,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      if (request.method === 'GET') {
        const object = await env.FILES.get(key);
        if (!object || !object.body) {
          return new Response('File Not Found', { status: 404, headers: CORS_HEADERS });
        }
        return new Response(object.body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
          },
        });
      }
    }

    return new Response(
      JSON.stringify({
        service: 'B2.Connect Edge Core',
        status: 'operational',
        architecture: 'Cloudflare Workers + Durable Objects WebSocket Hibernation + D1 + R2',
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  },
};
