import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomState {
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

const DATA_DIR = path.join(__dirname, '.data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

const rooms = new Map<string, RoomState>();

const LEGACY_FAKE_ROOM_IDS = new Set([
  'bio-11',
  'phys-quantum',
  'chem-org',
  'math-olymp',
  'cs-algo',
  'calc-bc',
]);

function loadPersistedRooms(): void {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const raw = fs.readFileSync(ROOMS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as RoomState[];
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (LEGACY_FAKE_ROOM_IDS.has(r.roomId) || r.instructorName === 'Dr. Behrad Rostami') {
            continue;
          }
          r.participants = {};
          r.messages = Array.isArray(r.messages)
            ? r.messages.filter((m) => !m.roomId || m.roomId === r.roomId)
            : [];
          rooms.set(r.roomId, r);
        }
      }
    }
  } catch {
    // Start with empty map if no persisted file exists
  }
}

function savePersistedRooms(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(Array.from(rooms.values()), null, 2);
    fs.writeFileSync(ROOMS_FILE, serialized, 'utf-8');
  } catch {
    // Ignore disk write errors in read-only environments
  }
}

loadPersistedRooms();
savePersistedRooms();

function createOrGetRoom(params: {
  roomId: string;
  name?: string;
  subject?: string;
  instructorName?: string;
  capacity?: number;
}): RoomState {
  const existing = rooms.get(params.roomId);
  if (existing) {
    if (params.name) existing.name = params.name;
    if (params.subject) existing.subject = params.subject;
    if (params.instructorName) existing.instructorName = params.instructorName;
    return existing;
  }

  const code = params.roomId.toUpperCase().slice(0, 8);
  const initial: RoomState = {
    roomId: params.roomId,
    code,
    name: params.name || `Room ${code}`,
    subject: params.subject || 'General Session',
    instructorName: params.instructorName || 'Host',
    capacity: params.capacity || 30,
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
  rooms.set(params.roomId, initial);
  savePersistedRooms();
  return initial;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const roomSockets = new Map<string, Set<{ ws: WebSocket; participantId: string }>>();

  function broadcastToRoom(
    roomId: string,
    packet: unknown,
    excludeWs?: WebSocket,
    targetParticipantId?: string
  ) {
    const set = roomSockets.get(roomId);
    if (!set) return;
    const serialized = JSON.stringify(packet);
    for (const item of set) {
      if (targetParticipantId && item.participantId !== targetParticipantId) {
        continue;
      }
      if (item.ws !== excludeWs && item.ws.readyState === WebSocket.OPEN) {
        item.ws.send(serialized);
      }
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost:3000'}`);
    if (url.pathname === '/ws' || url.pathname.startsWith('/api/room/')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost:3000'}`);
    const roomId = url.searchParams.get('roomId') || '';
    const participantId = url.searchParams.get('participantId') || `u-${Date.now()}`;
    const name = url.searchParams.get('name') || 'Participant';
    const role = (url.searchParams.get('role') as 'teacher' | 'assistant' | 'student') || 'student';
    const roomName = url.searchParams.get('roomName') || undefined;
    const subject = url.searchParams.get('subject') || undefined;

    if (!roomId || LEGACY_FAKE_ROOM_IDS.has(roomId) || name === 'Dr. Behrad Rostami') {
      ws.close(1008, 'Legacy fake room rejected');
      return;
    }

    if (!rooms.has(roomId) && !roomName) {
      ws.close(1008, 'Room does not exist');
      return;
    }

    const room = createOrGetRoom({
      roomId,
      name: roomName,
      subject,
      instructorName: role === 'teacher' ? name : undefined,
    });

    if (!roomSockets.has(roomId)) {
      roomSockets.set(roomId, new Set());
    }
    const clientEntry = { ws, participantId };
    roomSockets.get(roomId)!.add(clientEntry);

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

    ws.send(
      JSON.stringify({
        type: 'ROOM_STATE_SNAPSHOT',
        payload: room,
      })
    );

    broadcastToRoom(
      roomId,
      {
        type: 'PARTICIPANT_JOINED',
        payload: room.participants[participantId],
      },
      ws
    );

    ws.on('message', (data) => {
      let packet: { type: string; payload?: Record<string, unknown> };
      try {
        packet = JSON.parse(data.toString());
      } catch {
        return;
      }
      const payload = packet.payload || {};

      switch (packet.type) {
        case 'REQUEST_SNAPSHOT':
          ws.send(JSON.stringify({ type: 'ROOM_STATE_SNAPSHOT', payload: room }));
          break;
        case 'WHITEBOARD_STROKE': {
          const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
          const stroke = payload.stroke as { id?: string };
          if (!room.strokesBySlide[slideIndex]) room.strokesBySlide[slideIndex] = [];
          if (slideIndex >= room.totalSlides) room.totalSlides = slideIndex + 1;
          const exists = room.strokesBySlide[slideIndex].some(
            (s) => (s as { id?: string }).id === stroke?.id
          );
          if (!exists && stroke) {
            room.strokesBySlide[slideIndex].push(stroke);
            savePersistedRooms();
          }
          broadcastToRoom(roomId, { type: 'WHITEBOARD_STROKE', payload }, ws);
          break;
        }
        case 'WHITEBOARD_UPDATE_STROKE': {
          const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
          const stroke = payload.stroke as { id?: string };
          if (stroke?.id && room.strokesBySlide[slideIndex]) {
            room.strokesBySlide[slideIndex] = room.strokesBySlide[slideIndex].map((s) =>
              (s as { id?: string }).id === stroke.id ? stroke : s
            );
            savePersistedRooms();
            broadcastToRoom(roomId, { type: 'WHITEBOARD_UPDATE_STROKE', payload }, ws);
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
            savePersistedRooms();
            broadcastToRoom(roomId, { type: 'WHITEBOARD_DELETE_STROKE', payload }, ws);
          }
          break;
        }
        case 'WHITEBOARD_UNDO': {
          const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
          const list = room.strokesBySlide[slideIndex] || [];
          list.pop();
          room.strokesBySlide[slideIndex] = list;
          savePersistedRooms();
          broadcastToRoom(roomId, {
            type: 'WHITEBOARD_SYNC_SLIDE',
            payload: { slideIndex, strokes: list },
          });
          break;
        }
        case 'WHITEBOARD_CLEAR': {
          const slideIndex = Number(payload.slideIndex ?? room.currentSlide);
          room.strokesBySlide[slideIndex] = [];
          savePersistedRooms();
          broadcastToRoom(roomId, { type: 'WHITEBOARD_CLEAR', payload: { slideIndex } });
          break;
        }
        case 'LASER_MOVE':
          broadcastToRoom(roomId, { type: 'LASER_MOVE', payload }, ws);
          break;
        case 'LAYOUT_CHANGE':
          room.activeLayout = (payload.layout as RoomState['activeLayout']) || room.activeLayout;
          savePersistedRooms();
          broadcastToRoom(roomId, { type: 'LAYOUT_CHANGE', payload: { layout: room.activeLayout } });
          break;
        case 'TEMPLATE_CHANGE':
          room.activeTemplate =
            (payload.template as RoomState['activeTemplate']) || room.activeTemplate;
          savePersistedRooms();
          broadcastToRoom(roomId, {
            type: 'TEMPLATE_CHANGE',
            payload: { template: room.activeTemplate },
          });
          break;
        case 'SLIDE_CHANGE': {
          const nextSlide = Number(payload.slideIndex ?? 0);
          room.currentSlide = nextSlide;
          if (nextSlide >= room.totalSlides) room.totalSlides = nextSlide + 1;
          if (!room.strokesBySlide[nextSlide]) room.strokesBySlide[nextSlide] = [];
          savePersistedRooms();
          broadcastToRoom(roomId, {
            type: 'SLIDE_CHANGE',
            payload: { currentSlide: room.currentSlide, totalSlides: room.totalSlides },
          });
          break;
        }
        case 'FOCUS_UPDATE': {
          const pid = String(payload.participantId || '');
          const focusState = (payload.focusState as 'focused' | 'away' | 'idle') || 'focused';
          const p = room.participants[pid];
          if (p) {
            if (focusState === 'away' && p.focusState !== 'away') {
              p.tabSwitches = Number(p.tabSwitches || 0) + 1;
              p.engagementXp = Math.max(20, Number(p.engagementXp || 100) - 3);
            }
            p.focusState = focusState;
            p.lastSeenAt = Date.now();
            broadcastToRoom(roomId, { type: 'PARTICIPANT_UPDATED', payload: p });
          }
          break;
        }
        case 'HAND_RAISE_TOGGLE': {
          const pid = String(payload.participantId || '');
          const p = room.participants[pid];
          if (p) {
            p.handRaised = Boolean(payload.handRaised);
            p.handRaisedAt = p.handRaised ? Date.now() : null;
            broadcastToRoom(roomId, { type: 'PARTICIPANT_UPDATED', payload: p });
          }
          break;
        }
        case 'PERMISSION_TOGGLE': {
          const pid = String(payload.participantId || '');
          const perm = String(payload.permission || '');
          const value = Boolean(payload.value);
          const p = room.participants[pid];
          if (p) {
            if (perm === 'mic') p.micGranted = value;
            if (perm === 'cam') p.camGranted = value;
            if (perm === 'pen') p.penGranted = value;
            broadcastToRoom(roomId, { type: 'PARTICIPANT_UPDATED', payload: p });
          }
          break;
        }
        case 'MEDIA_STATE_TOGGLE': {
          const pid = String(payload.participantId || '');
          const p = room.participants[pid];
          if (p) {
            if (typeof payload.micMuted === 'boolean') p.micMuted = payload.micMuted;
            if (typeof payload.camOff === 'boolean') p.camOff = payload.camOff;
            if (typeof payload.isSpeaking === 'boolean') p.isSpeaking = payload.isSpeaking;
            if (typeof payload.audioLevel === 'number') p.audioLevel = payload.audioLevel;
            broadcastToRoom(roomId, { type: 'PARTICIPANT_UPDATED', payload: p });
          }
          break;
        }
        case 'CHAT_MESSAGE': {
          const rawMsg = payload.message as Record<string, unknown> | undefined;
          if (rawMsg && rawMsg.id) {
            const stampedMsg: Record<string, unknown> = {
              ...rawMsg,
              roomId,
            };
            if (!room.messages.some((m) => m.id === stampedMsg.id)) {
              room.messages.push(stampedMsg);
              if (room.messages.length > 200) room.messages.shift();
              savePersistedRooms();
              broadcastToRoom(roomId, { type: 'CHAT_MESSAGE', payload: { message: stampedMsg } });
            }
          }
          break;
        }
        case 'CHAT_CLEAR': {
          room.messages = [];
          savePersistedRooms();
          broadcastToRoom(roomId, { type: 'CHAT_CLEAR', payload: { roomId } });
          break;
        }
        case 'CHAT_DELETE_MESSAGE': {
          const messageId = String(payload.messageId || '');
          if (messageId) {
            room.messages = room.messages.filter((m) => String(m.id) !== messageId);
            savePersistedRooms();
            broadcastToRoom(roomId, {
              type: 'CHAT_DELETE_MESSAGE',
              payload: { roomId, messageId },
            });
          }
          break;
        }
        case 'CHAT_LOCK_TOGGLE': {
          room.chatLocked = Boolean(payload.chatLocked);
          savePersistedRooms();
          broadcastToRoom(roomId, {
            type: 'CHAT_LOCK_TOGGLE',
            payload: { chatLocked: room.chatLocked },
          });
          break;
        }
        case 'POLL_START':
          room.activePoll = (payload.poll as Record<string, unknown>) || null;
          savePersistedRooms();
          broadcastToRoom(roomId, { type: 'POLL_START', payload: { poll: room.activePoll } });
          break;
        case 'POLL_VOTE': {
          const voterId = String(payload.participantId || '');
          const optionIndex = Number(payload.optionIndex ?? 0);
          if (room.activePoll && voterId) {
            const votes = (room.activePoll.votes as Record<string, number>) || {};
            votes[voterId] = optionIndex;
            room.activePoll.votes = votes;
            savePersistedRooms();
            broadcastToRoom(roomId, { type: 'POLL_UPDATED', payload: { poll: room.activePoll } });
          }
          break;
        }
        case 'POLL_REVEAL_TOGGLE': {
          if (room.activePoll) {
            room.activePoll.revealAnswer = !room.activePoll.revealAnswer;
            savePersistedRooms();
            broadcastToRoom(roomId, { type: 'POLL_UPDATED', payload: { poll: room.activePoll } });
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
          broadcastToRoom(roomId, { type: 'ROLL_CALL_START', payload: rc });
          break;
        }
        case 'ROLL_CALL_ACK': {
          const pid = String(payload.participantId || '');
          if (room.activeRollCall && !room.activeRollCall.verifiedIds.includes(pid)) {
            room.activeRollCall.verifiedIds.push(pid);
          }
          const p = room.participants[pid];
          if (p) {
            p.rollCallVerified = true;
          }
          broadcastToRoom(roomId, {
            type: 'ROLL_CALL_ACK',
            payload: { participantId: pid, verifiedIds: room.activeRollCall?.verifiedIds || [] },
          });
          break;
        }
        case 'FILE_SHARE': {
          const file = payload.file as Record<string, unknown> | undefined;
          if (file && file.id && !room.sharedFiles.some((f) => f.id === file.id)) {
            room.sharedFiles.unshift(file);
            savePersistedRooms();
            broadcastToRoom(roomId, { type: 'FILE_SHARE', payload: { file } });
          }
          break;
        }
        case 'EMOJI_REACTION':
          broadcastToRoom(roomId, { type: 'EMOJI_REACTION', payload });
          break;
        case 'WEBRTC_SIGNAL': {
          const targetId = typeof payload.targetId === 'string' ? payload.targetId : undefined;
          broadcastToRoom(roomId, { type: 'WEBRTC_SIGNAL', payload }, ws, targetId);
          break;
        }
      }
    });

    ws.on('close', () => {
      const set = roomSockets.get(roomId);
      if (set) {
        set.delete(clientEntry);
      }
      delete room.participants[participantId];
      broadcastToRoom(roomId, {
        type: 'PARTICIPANT_LEFT',
        payload: { participantId },
      });
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'B2.Connect Real-Time Edge Server' });
  });

  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(rooms.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.roomId,
        code: r.code,
        name: r.name,
        subject: r.subject,
        instructorName: r.instructorName,
        activeParticipants: Object.keys(r.participants).length,
        capacity: r.capacity,
        status:
          r.activeLayout === 'exam'
            ? 'exam'
            : Object.keys(r.participants).length > 0
            ? 'live'
            : 'standby',
        latencyMs: 0,
        activeLayout: r.activeLayout,
      }));
    res.json({ rooms: list });
  });

  app.post('/api/rooms', (req, res) => {
    const { name, subject, instructorName, capacity } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Room name is required' });
      return;
    }
    const cleanId = `rm-${Date.now().toString(36)}`;
    const room = createOrGetRoom({
      roomId: cleanId,
      name: name.trim(),
      subject: typeof subject === 'string' && subject.trim() ? subject.trim() : 'General Session',
      instructorName:
        typeof instructorName === 'string' && instructorName.trim()
          ? instructorName.trim()
          : 'Instructor',
      capacity: Number(capacity) > 0 ? Number(capacity) : 30,
    });
    res.status(201).json({
      room: {
        id: room.roomId,
        code: room.code,
        name: room.name,
        subject: room.subject,
        instructorName: room.instructorName,
        activeParticipants: Object.keys(room.participants).length,
        capacity: room.capacity,
        status: 'standby',
        latencyMs: 0,
        activeLayout: room.activeLayout,
      },
    });
  });

  app.delete('/api/rooms/:roomId', (req, res) => {
    const { roomId } = req.params;
    rooms.delete(roomId);
    savePersistedRooms();
    res.json({ ok: true });
  });

  app.get('/api/room/:roomId/snapshot', (req, res) => {
    const existing = rooms.get(req.params.roomId);
    if (!existing) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(existing);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`B2.Connect server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
