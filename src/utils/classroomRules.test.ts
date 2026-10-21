import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePoint,
  denormalizePoint,
  calculateEngagementXp,
  computePollBreakdown,
  generateAttendanceCsvWithBom,
  getStrokeBoundingBox,
  translateStrokePoints,
  resizeStrokeToBox,
} from './classroomRules';
import type { LivePoll, Participant, WhiteboardStroke } from '../types/classroom';

test('normalizePoint and denormalizePoint preserve vector coordinates across canvas resizes', () => {
  const norm = normalizePoint(400, 225, 800, 450, 0.75);
  assert.equal(norm.x, 0.5);
  assert.equal(norm.y, 0.5);
  assert.equal(norm.pressure, 0.75);

  const denorm = denormalizePoint(norm, 1600, 900);
  assert.equal(denorm.x, 800);
  assert.equal(denorm.y, 450);
});

test('getStrokeBoundingBox, translateStrokePoints, and resizeStrokeToBox move and resize objects accurately', () => {
  const imageStroke: WhiteboardStroke = {
    id: 'img-1',
    authorId: 'u-1',
    authorName: 'Host',
    slideIndex: 0,
    tool: 'image',
    color: '#D4A373',
    size: 1,
    opacity: 1,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.5 },
    ],
    imageDataUrl: 'data:image/png;base64,AAA',
    createdAt: 1000,
  };

  const box = getStrokeBoundingBox(imageStroke);
  assert.equal(box.minX, 0.2);
  assert.equal(box.maxX, 0.6);

  const moved = translateStrokePoints(imageStroke, 0.1, 0.15);
  assert.equal(moved.points[0].x, 0.3);
  assert.equal(moved.points[0].y, 0.35);
  assert.equal(moved.points[1].x, 0.7);
  assert.equal(moved.points[1].y, 0.65);

  const resized = resizeStrokeToBox(moved, {
    minX: 0.1,
    minY: 0.1,
    maxX: 0.8,
    maxY: 0.7,
  });
  assert.equal(resized.points[0].x, 0.1);
  assert.equal(resized.points[1].x, 0.8);
});

test('calculateEngagementXp rewards focus and penalizes excessive tab switches', () => {
  const highXp = calculateEngagementXp({
    activeMinutes: 30,
    expectedMinutes: 30,
    tabSwitches: 0,
    rollCallVerified: true,
    participatedInPoll: true,
  });
  assert.equal(highXp, 100);

  const distractedXp = calculateEngagementXp({
    activeMinutes: 15,
    expectedMinutes: 30,
    tabSwitches: 5,
    rollCallVerified: false,
    participatedInPoll: false,
  });
  assert.equal(distractedXp, 33);
});

test('computePollBreakdown calculates vote totals and percentages accurately', () => {
  const poll: LivePoll = {
    id: 'poll-1',
    question: 'What is the derivative of sin(x)?',
    options: [
      { id: 'o1', text: 'cos(x)' },
      { id: 'o2', text: '-cos(x)' },
    ],
    correctOptionIndex: 0,
    revealAnswer: false,
    isActive: true,
    durationSeconds: 60,
    createdAt: Date.now(),
    votes: {
      s1: 0,
      s2: 0,
      s3: 0,
      s4: 1,
    },
  };

  const breakdown = computePollBreakdown(poll);
  assert.equal(breakdown.totalVotes, 4);
  assert.deepEqual(breakdown.counts, [3, 1]);
  assert.deepEqual(breakdown.percentages, [75, 25]);
});

test('generateAttendanceCsvWithBom prepends UTF-8 BOM and formats attendance rows', () => {
  const sampleParticipants: Participant[] = [
    {
      id: 'st-1',
      name: 'Alex Rivera',
      role: 'student',
      joinedAt: 1729500000000,
      lastSeenAt: 1729501800000,
      activeMinutes: 28.5,
      focusState: 'focused',
      tabSwitches: 1,
      rollCallVerified: true,
      micGranted: false,
      camGranted: false,
      penGranted: false,
      micMuted: true,
      camOff: true,
      handRaised: false,
      engagementXp: 95,
    },
  ];

  const csv = generateAttendanceCsvWithBom('Physics 101', sampleParticipants, null);
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.equal(csv.includes('Alex Rivera'), true);
  assert.equal(csv.includes('95 XP'), true);
});
