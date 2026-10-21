import type {
  NormalizedPoint,
  Participant,
  LivePoll,
  WhiteboardStroke,
} from '../types/classroom';

export interface NormalizedBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Clamps and normalizes pixel coordinates into [0.0, 1.0] vector space
 * so canvas resizing or device rotation never shifts or erases strokes.
 */
export function normalizePoint(
  pixelX: number,
  pixelY: number,
  canvasWidth: number,
  canvasHeight: number,
  pressure = 0.5
): NormalizedPoint {
  const safeW = Math.max(1, canvasWidth);
  const safeH = Math.max(1, canvasHeight);
  const x = Math.min(1, Math.max(0, Number((pixelX / safeW).toFixed(5))));
  const y = Math.min(1, Math.max(0, Number((pixelY / safeH).toFixed(5))));
  return { x, y, pressure: Math.min(1, Math.max(0.1, pressure)) };
}

/**
 * Converts a normalized [0.0, 1.0] point back to physical canvas CSS pixels.
 */
export function denormalizePoint(
  point: NormalizedPoint,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; pressure: number } {
  return {
    x: point.x * canvasWidth,
    y: point.y * canvasHeight,
    pressure: point.pressure ?? 0.5,
  };
}

/**
 * Computes the normalized [0.0, 1.0] bounding box of any whiteboard object
 * (text, sticky note, uploaded image/PDF page, geometric shape, or freehand stroke).
 */
export function getStrokeBoundingBox(stroke: WhiteboardStroke): NormalizedBoundingBox {
  const pts = stroke.points || [];
  if (pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  if (stroke.tool === 'image' || stroke.tool === 'rect') {
    const p0 = pts[0];
    const p1 = pts[pts.length - 1] || { x: p0.x + 0.35, y: p0.y + 0.35 };
    return {
      minX: Math.min(p0.x, p1.x),
      minY: Math.min(p0.y, p1.y),
      maxX: Math.max(p0.x, p1.x),
      maxY: Math.max(p0.y, p1.y),
    };
  }

  if (stroke.tool === 'sticky') {
    const p0 = pts[0];
    if (pts.length >= 2) {
      const p1 = pts[pts.length - 1];
      return {
        minX: Math.min(p0.x, p1.x),
        minY: Math.min(p0.y, p1.y),
        maxX: Math.max(p0.x, p1.x),
        maxY: Math.max(p0.y, p1.y),
      };
    }
    return {
      minX: p0.x,
      minY: p0.y,
      maxX: Math.min(0.98, p0.x + 0.24),
      maxY: Math.min(0.98, p0.y + 0.18),
    };
  }

  if (stroke.tool === 'text') {
    const p0 = pts[0];
    if (pts.length >= 2) {
      const p1 = pts[pts.length - 1];
      return {
        minX: Math.min(p0.x, p1.x),
        minY: Math.min(p0.y, p1.y),
        maxX: Math.max(p0.x, p1.x),
        maxY: Math.max(p0.y, p1.y),
      };
    }
    const textLen = Math.max(4, (stroke.text || '').length);
    const scale = (stroke.size || 18) / 18;
    const estWidth = Math.min(0.75, Math.max(0.08, textLen * 0.011 * scale));
    const estHeight = Math.min(0.25, Math.max(0.04, 0.045 * scale));
    return {
      minX: p0.x,
      minY: p0.y,
      maxX: Math.min(0.99, p0.x + estWidth),
      maxY: Math.min(0.99, p0.y + estHeight),
    };
  }

  if (stroke.tool === 'circle' && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const r = Math.hypot(end.x - start.x, end.y - start.y);
    return {
      minX: Math.max(0, start.x - r),
      minY: Math.max(0, start.y - r),
      maxX: Math.min(1, start.x + r),
      maxY: Math.min(1, start.y + r),
    };
  }

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const pt of pts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Checks whether a normalized point falls inside a bounding box (with optional hit padding).
 */
export function isPointInBoundingBox(
  point: NormalizedPoint,
  box: NormalizedBoundingBox,
  padding = 0.012
): boolean {
  return (
    point.x >= box.minX - padding &&
    point.x <= box.maxX + padding &&
    point.y >= box.minY - padding &&
    point.y <= box.maxY + padding
  );
}

/**
 * Translates all normalized points of a whiteboard object by (dx, dy), clamped to [0.0, 1.0].
 */
export function translateStrokePoints(
  stroke: WhiteboardStroke,
  dx: number,
  dy: number
): WhiteboardStroke {
  const box = getStrokeBoundingBox(stroke);
  const clampedDx = Math.max(-box.minX, Math.min(1 - box.maxX, dx));
  const clampedDy = Math.max(-box.minY, Math.min(1 - box.maxY, dy));

  return {
    ...stroke,
    points: stroke.points.map((pt) => ({
      ...pt,
      x: Number(Math.min(1, Math.max(0, pt.x + clampedDx)).toFixed(5)),
      y: Number(Math.min(1, Math.max(0, pt.y + clampedDy)).toFixed(5)),
    })),
  };
}

/**
 * Resizes a whiteboard object's bounding box to new normalized bounds.
 */
export function resizeStrokeToBox(
  stroke: WhiteboardStroke,
  nextBox: NormalizedBoundingBox
): WhiteboardStroke {
  const safeMinX = Number(Math.max(0, Math.min(0.95, nextBox.minX)).toFixed(5));
  const safeMinY = Number(Math.max(0, Math.min(0.95, nextBox.minY)).toFixed(5));
  const safeMaxX = Number(Math.max(safeMinX + 0.04, Math.min(1, nextBox.maxX)).toFixed(5));
  const safeMaxY = Number(Math.max(safeMinY + 0.04, Math.min(1, nextBox.maxY)).toFixed(5));

  if (
    stroke.tool === 'image' ||
    stroke.tool === 'rect' ||
    stroke.tool === 'sticky' ||
    stroke.tool === 'line' ||
    stroke.tool === 'arrow'
  ) {
    return {
      ...stroke,
      points: [
        { x: safeMinX, y: safeMinY },
        { x: safeMaxX, y: safeMaxY },
      ],
    };
  }

  if (stroke.tool === 'text') {
    const heightRatio = (safeMaxY - safeMinY) / 0.045;
    const nextSize = Math.max(11, Math.min(56, Math.round(18 * heightRatio)));
    return {
      ...stroke,
      size: nextSize,
      points: [{ x: safeMinX, y: safeMinY }],
    };
  }

  if (stroke.tool === 'circle') {
    const cx = Number(((safeMinX + safeMaxX) / 2).toFixed(5));
    const cy = Number(((safeMinY + safeMaxY) / 2).toFixed(5));
    const r = Number((Math.min(safeMaxX - safeMinX, safeMaxY - safeMinY) / 2).toFixed(5));
    return {
      ...stroke,
      points: [
        { x: cx, y: cy },
        { x: Math.min(1, cx + r), y: cy },
      ],
    };
  }

  const oldBox = getStrokeBoundingBox(stroke);
  const oldW = Math.max(0.001, oldBox.maxX - oldBox.minX);
  const oldH = Math.max(0.001, oldBox.maxY - oldBox.minY);
  const newW = safeMaxX - safeMinX;
  const newH = safeMaxY - safeMinY;

  return {
    ...stroke,
    points: stroke.points.map((pt) => ({
      ...pt,
      x: Number((safeMinX + ((pt.x - oldBox.minX) / oldW) * newW).toFixed(5)),
      y: Number((safeMinY + ((pt.y - oldBox.minY) / oldH) * newH).toFixed(5)),
    })),
  };
}

/**
 * Computes automated Student Engagement Score (0 - 100 XP)
 * based on active attendance duration, focus stability (low tab switches),
 * Roll-Call attention check verification, and poll participation.
 */
export function calculateEngagementXp(params: {
  activeMinutes: number;
  expectedMinutes?: number;
  tabSwitches: number;
  rollCallVerified: boolean;
  participatedInPoll: boolean;
}): number {
  const expected = Math.max(5, params.expectedMinutes ?? 30);
  const durationRatio = Math.min(1, Math.max(0, params.activeMinutes / expected));
  const attendancePoints = durationRatio * 45; // up to 45 pts
  const focusPenalty = Math.min(35, params.tabSwitches * 5);
  const focusPoints = Math.max(0, 35 - focusPenalty); // up to 35 pts
  const rollCallPoints = params.rollCallVerified ? 12 : 0; // 12 pts
  const pollPoints = params.participatedInPoll ? 8 : 0; // 8 pts

  return Math.round(
    Math.min(100, Math.max(0, attendancePoints + focusPoints + rollCallPoints + pollPoints))
  );
}

/**
 * Computes poll option counts and percentages.
 */
export function computePollBreakdown(poll: LivePoll): {
  totalVotes: number;
  counts: number[];
  percentages: number[];
} {
  const counts = poll.options.map(() => 0);
  const voteValues = Object.values(poll.votes || {});
  for (const optionIdx of voteValues) {
    if (typeof optionIdx === 'number' && optionIdx >= 0 && optionIdx < counts.length) {
      counts[optionIdx] += 1;
    }
  }
  const totalVotes = counts.reduce((acc, c) => acc + c, 0);
  const percentages = counts.map((c) => (totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0));
  return { totalVotes, counts, percentages };
}

/**
 * Escapes CSV cell values safely and prepends UTF-8 Byte Order Mark (\uFEFF)
 * so international names and STEM symbols open cleanly in Microsoft Excel.
 */
export function generateAttendanceCsvWithBom(
  roomName: string,
  participants: Participant[],
  activePoll: LivePoll | null
): string {
  const escapeCell = (val: string | number | boolean): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    'Room Name',
    'Participant ID',
    'Full Name',
    'Role',
    'Joined Time',
    'Active Minutes',
    'Live Focus Status',
    'Tab Switches (Focus Loss)',
    'Roll-Call Verified',
    'Poll Answered',
    'Engagement Score (XP)',
  ];

  const rows = participants.map((p) => {
    const joinedIso = new Date(p.joinedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const answeredPoll = activePoll && activePoll.votes && p.id in activePoll.votes ? 'Yes' : 'No';
    return [
      escapeCell(roomName),
      escapeCell(p.id),
      escapeCell(p.name),
      escapeCell(p.role.toUpperCase()),
      escapeCell(joinedIso),
      escapeCell(p.activeMinutes.toFixed(1)),
      escapeCell(p.focusState.toUpperCase()),
      escapeCell(p.tabSwitches),
      escapeCell(p.rollCallVerified ? 'VERIFIED' : 'MISSED'),
      escapeCell(answeredPoll),
      escapeCell(`${p.engagementXp} XP`),
    ].join(',');
  });

  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}
