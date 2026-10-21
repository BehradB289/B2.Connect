import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  MousePointer,
  Pen,
  Highlighter,
  Eraser,
  Minus,
  ArrowUpRight,
  Square,
  Circle as CircleIcon,
  Type,
  StickyNote,
  Sparkles,
  Hand,
  Undo2,
  Trash2,
  Download,
  ChevronLeft,
  ChevronRight,
  Plus,
  ImagePlus,
  FileUp,
  ZoomIn,
  ZoomOut,
  Grid,
  Maximize2,
} from 'lucide-react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  BoardTemplate,
  LaserPointerPosition,
  NormalizedPoint,
  ThemeMode,
  WhiteboardStroke,
  WhiteboardTool,
} from '../types/classroom';
import {
  normalizePoint,
  denormalizePoint,
  getStrokeBoundingBox,
  isPointInBoundingBox,
  translateStrokePoints,
  resizeStrokeToBox,
  type NormalizedBoundingBox,
} from '../utils/classroomRules';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STEM_SYMBOLS = [
  { label: '∫ Integral', symbol: '∫ f(x) dx' },
  { label: '∑ Sum', symbol: '∑ (i=1..n)' },
  { label: '√ Root', symbol: '√(x² + y²)' },
  { label: 'Equilibrium', symbol: 'A + B ⇌ C + D' },
  { label: 'Δ Delta', symbol: 'ΔG = ΔH - TΔS' },
  { label: 'π Pi', symbol: '2πr' },
  { label: 'θ Theta', symbol: 'sin²(θ) + cos²(θ) = 1' },
  { label: '∞ Infinity', symbol: 'lim (x → ∞)' },
];

const PALETTE_COLORS = [
  { name: 'Crema Gold', value: '#D4A373' },
  { name: 'Crisp Ivory', value: '#FAF7F5' },
  { name: 'Emerald Nominal', value: '#10B981' },
  { name: 'Cerulean Xylem', value: '#0EA5E9' },
  { name: 'Amber Elevated', value: '#F59E0B' },
  { name: 'Coral Acidic', value: '#F43F5E' },
];

type ResizeHandleCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface WhiteboardPodProps {
  strokes: WhiteboardStroke[];
  currentSlide: number;
  totalSlides: number;
  activeTemplate: BoardTemplate;
  slideBackground?: string;
  canDraw: boolean;
  localParticipantId: string;
  localParticipantName: string;
  theme: ThemeMode;
  remoteLaser: LaserPointerPosition | null;
  onAddStroke: (stroke: WhiteboardStroke) => void;
  onUpdateStroke: (stroke: WhiteboardStroke) => void;
  onDeleteStroke: (strokeId: string, slideIndex: number) => void;
  onUndoStroke: () => void;
  onClearSlide: () => void;
  onChangeSlide: (slideIndex: number) => void;
  onChangeTemplate: (template: BoardTemplate) => void;
  onUploadBackground: (slideIndex: number, dataUrl: string) => void;
  onMoveLaser: (laser: LaserPointerPosition | null) => void;
  canvasRefCallback?: (canvas: HTMLCanvasElement | null) => void;
}

export const WhiteboardPod: React.FC<WhiteboardPodProps> = ({
  strokes,
  currentSlide,
  totalSlides,
  activeTemplate,
  slideBackground,
  canDraw,
  localParticipantId,
  localParticipantName,
  theme,
  remoteLaser,
  onAddStroke,
  onUpdateStroke,
  onDeleteStroke,
  onUndoStroke,
  onClearSlide,
  onChangeSlide,
  onChangeTemplate,
  onMoveLaser,
  canvasRefCallback,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const [activeTool, setActiveTool] = useState<WhiteboardTool>('pen');
  const [strokeColor, setStrokeColor] = useState<string>('#D4A373');
  const [strokeSize, setStrokeSize] = useState<number>(3.5);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [customTextDraft, setCustomTextDraft] = useState<string>('');
  const [pendingTextPos, setPendingTextPos] = useState<NormalizedPoint | null>(null);
  const [localLaserTrail, setLocalLaserTrail] = useState<{ x: number; y: number; t: number }[]>([]);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [isImportingPdf, setIsImportingPdf] = useState<boolean>(false);
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);

  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<NormalizedPoint[]>([]);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  // Drag / Resize interaction state for Select / Move tool
  const interactionRef = useRef<{
    mode: 'move' | 'resize';
    corner?: ResizeHandleCorner;
    strokeId: string;
    startNorm: NormalizedPoint;
    initialStroke: WhiteboardStroke;
    initialBox: NormalizedBoundingBox;
    currentStroke: WhiteboardStroke;
  } | null>(null);

  const selectedStroke = strokes.find((s) => s.id === selectedStrokeId) || null;

  const setCanvasRefs = useCallback(
    (el: HTMLCanvasElement | null) => {
      canvasRef.current = el;
      if (canvasRefCallback) canvasRefCallback(el);
    },
    [canvasRefCallback]
  );

  // Clear selection when switching slides
  useEffect(() => {
    setSelectedStrokeId(null);
  }, [currentSlide]);

  // Keyboard Delete / Backspace shortcut for selected object
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedStrokeId || !canDraw) return;
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteStroke(selectedStrokeId, currentSlide);
        setSelectedStrokeId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStrokeId, canDraw, currentSlide, onDeleteStroke]);

  // 1. Draw Base Board Template (Espresso, Math Grid, Cartesian X-Y Axes, Notebook, Dots)
  const drawBoardTemplate = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const isDaylight = theme === 'daylight';
      const bgFill =
        activeTemplate === 'notebook'
          ? isDaylight
            ? '#FAF6F0'
            : '#16120F'
          : isDaylight
          ? '#F7F3EE'
          : theme === 'noir'
          ? '#08080A'
          : '#110D0B';

      ctx.fillStyle = bgFill;
      ctx.fillRect(0, 0, width, height);

      const gridMinorColor = isDaylight
        ? 'rgba(156, 107, 59, 0.12)'
        : 'rgba(212, 163, 115, 0.09)';
      const gridMajorColor = isDaylight
        ? 'rgba(156, 107, 59, 0.28)'
        : 'rgba(212, 163, 115, 0.24)';

      if (activeTemplate === 'grid' || activeTemplate === 'cartesian') {
        const step = Math.max(20, Math.round(width / 32));
        ctx.lineWidth = 1;
        ctx.strokeStyle = gridMinorColor;
        ctx.beginPath();
        for (let x = step; x < width; x += step) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (let y = step; y < height; y += step) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();

        if (activeTemplate === 'cartesian') {
          const originX = Math.round(width * 0.12);
          const originY = Math.round(height * 0.84);
          ctx.strokeStyle = gridMajorColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(originX, height * 0.08);
          ctx.lineTo(originX, originY + 16);
          ctx.moveTo(originX - 16, originY);
          ctx.lineTo(width * 0.92, originY);
          ctx.stroke();

          ctx.save();
          ctx.fillStyle = isDaylight ? '#7F5539' : '#D4A373';
          ctx.font = `600 ${Math.max(10, Math.round(width / 85))}px "JetBrains Mono", monospace`;
          ctx.fillText('Y', originX + 8, Math.max(16, height * 0.065));
          ctx.textAlign = 'right';
          ctx.fillText('X', width * 0.91, originY - 8);
          ctx.restore();
        }
      } else if (activeTemplate === 'notebook') {
        const lineStep = Math.max(24, Math.round(height / 16));
        ctx.strokeStyle = gridMinorColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = lineStep * 2; y < height; y += lineStep) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(244, 63, 94, 0.28)';
        ctx.beginPath();
        ctx.moveTo(width * 0.09, 0);
        ctx.lineTo(width * 0.09, height);
        ctx.stroke();
      } else if (activeTemplate === 'dots') {
        const dotStep = Math.max(22, Math.round(width / 28));
        ctx.fillStyle = gridMajorColor;
        for (let x = dotStep; x < width; x += dotStep) {
          for (let y = dotStep; y < height; y += dotStep) {
            ctx.beginPath();
            ctx.arc(x, y, 1.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    },
    [activeTemplate, theme]
  );

  // 2. Draw Discrete Movable Objects (Images, PDF Pages, Sticky Notes, Text)
  const drawDiscreteObject = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      stroke: WhiteboardStroke,
      width: number,
      height: number,
      triggerRedraw: () => void
    ) => {
      if (!stroke.points || stroke.points.length === 0) return;
      const box = getStrokeBoundingBox(stroke);
      const x = box.minX * width;
      const y = box.minY * height;
      const w = Math.max(20, (box.maxX - box.minX) * width);
      const h = Math.max(20, (box.maxY - box.minY) * height);

      ctx.save();
      ctx.globalAlpha = stroke.opacity ?? 1;

      if (stroke.tool === 'image' && stroke.imageDataUrl) {
        const cached = imageCacheRef.current[stroke.imageDataUrl];
        if (cached && cached.complete) {
          ctx.drawImage(cached, x, y, w, h);
        } else if (!cached) {
          const img = new Image();
          img.onload = () => triggerRedraw();
          img.src = stroke.imageDataUrl;
          imageCacheRef.current[stroke.imageDataUrl] = img;
        }
      } else if (stroke.tool === 'sticky' && stroke.text) {
        ctx.fillStyle =
          theme === 'daylight' ? 'rgba(212, 163, 115, 0.28)' : 'rgba(212, 163, 115, 0.18)';
        ctx.strokeStyle = stroke.color || '#D4A373';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = theme === 'daylight' ? '#1A130F' : '#FAF7F5';
        const fontSize = Math.max(11, Math.round(width / 78));
        const lineHeight = Math.max(15, Math.round(fontSize * 1.35));
        ctx.font = `500 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.textBaseline = 'top';
        const words = stroke.text.split(' ');
        let line = '';
        let lineY = y + 10;
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          if (ctx.measureText(testLine).width > w - 20 && line) {
            ctx.fillText(line, x + 10, lineY);
            line = word;
            lineY += lineHeight;
          } else {
            line = testLine;
          }
        }
        if (line) ctx.fillText(line, x + 10, lineY);
      } else if (stroke.tool === 'text' && stroke.text) {
        const p0 = denormalizePoint(stroke.points[0], width, height);
        const fontSize = Math.max(12, Math.round((stroke.size || 18) * (width / 920)));
        ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle =
          theme === 'daylight' && stroke.color === '#FAF7F5' ? '#1A130F' : stroke.color;
        ctx.fillText(stroke.text, p0.x, p0.y);
      }

      ctx.restore();
    },
    [theme]
  );

  // 3. Draw Ink & Eraser Strokes onto the Transparent Offscreen Ink Canvas
  // CRITICAL FIX: Eraser uses `destination-out` on the transparent ink canvas so it ONLY erases
  // drawn lines/shapes/paint and NEVER paints black or erases the background grid or images!
  const drawInkOrEraserStroke = useCallback(
    (
      inkCtx: CanvasRenderingContext2D,
      stroke: {
        tool: WhiteboardTool;
        color: string;
        size: number;
        opacity: number;
        points: NormalizedPoint[];
      },
      width: number,
      height: number
    ) => {
      if (!stroke.points || stroke.points.length === 0) return;

      inkCtx.save();
      if (stroke.tool === 'eraser') {
        inkCtx.globalCompositeOperation = 'destination-out';
        inkCtx.globalAlpha = 1;
        inkCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        inkCtx.globalCompositeOperation = 'source-over';
        inkCtx.globalAlpha = stroke.opacity ?? 1;
        inkCtx.strokeStyle =
          theme === 'daylight' && stroke.color === '#FAF7F5' ? '#1A130F' : stroke.color;
      }

      inkCtx.lineWidth =
        stroke.tool === 'highlighter'
          ? stroke.size * 3.8
          : stroke.tool === 'eraser'
          ? stroke.size * 5.5
          : stroke.size;
      inkCtx.lineCap = 'round';
      inkCtx.lineJoin = 'round';

      const pts = stroke.points.map((pt) => denormalizePoint(pt, width, height));

      if (stroke.tool === 'pen' || stroke.tool === 'highlighter' || stroke.tool === 'eraser') {
        inkCtx.beginPath();
        inkCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const midX = (pts[i - 1].x + pts[i].x) / 2;
          const midY = (pts[i - 1].y + pts[i].y) / 2;
          inkCtx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, midX, midY);
        }
        if (pts.length === 1) {
          inkCtx.lineTo(pts[0].x + 0.5, pts[0].y + 0.5);
        }
        inkCtx.stroke();
      } else if (stroke.tool === 'line' && pts.length >= 2) {
        const start = pts[0];
        const end = pts[pts.length - 1];
        inkCtx.beginPath();
        inkCtx.moveTo(start.x, start.y);
        inkCtx.lineTo(end.x, end.y);
        inkCtx.stroke();
      } else if (stroke.tool === 'arrow' && pts.length >= 2) {
        const start = pts[0];
        const end = pts[pts.length - 1];
        const headLength = 14;
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        inkCtx.beginPath();
        inkCtx.moveTo(start.x, start.y);
        inkCtx.lineTo(end.x, end.y);
        inkCtx.lineTo(
          end.x - headLength * Math.cos(angle - Math.PI / 6),
          end.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        inkCtx.moveTo(end.x, end.y);
        inkCtx.lineTo(
          end.x - headLength * Math.cos(angle + Math.PI / 6),
          end.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        inkCtx.stroke();
      } else if (stroke.tool === 'rect' && pts.length >= 2) {
        const start = pts[0];
        const end = pts[pts.length - 1];
        inkCtx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (stroke.tool === 'circle' && pts.length >= 2) {
        const start = pts[0];
        const end = pts[pts.length - 1];
        const radius = Math.hypot(end.x - start.x, end.y - start.y);
        inkCtx.beginPath();
        inkCtx.arc(start.x, start.y, radius, 0, Math.PI * 2);
        inkCtx.stroke();
      }

      inkCtx.restore();
    },
    [theme]
  );

  // Master Composited Vector Redraw
  const redrawAllVectors = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    if (!inkCanvasRef.current) {
      inkCanvasRef.current = document.createElement('canvas');
    }
    const inkCanvas = inkCanvasRef.current;
    if (inkCanvas.width !== targetW || inkCanvas.height !== targetH) {
      inkCanvas.width = targetW;
      inkCanvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    const inkCtx = inkCanvas.getContext('2d');
    if (!ctx || !inkCtx) return;

    const cssW = rect.width;
    const cssH = rect.height;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Step 1: Draw Background Template (Grid / X-Y Axes / Notebook / Espresso)
    drawBoardTemplate(ctx, cssW, cssH);

    // Optional Legacy Slide Background
    if (slideBackground) {
      const cached = imageCacheRef.current[slideBackground];
      if (cached && cached.complete) {
        ctx.drawImage(cached, 0, 0, cssW, cssH);
      } else if (!cached) {
        const img = new Image();
        img.onload = () => redrawAllVectors();
        img.src = slideBackground;
        imageCacheRef.current[slideBackground] = img;
      }
    }

    // Substitute in-flight dragged/resized stroke if active
    const activeInteraction = interactionRef.current;
    const effectiveStrokes = strokes.map((s) =>
      activeInteraction && activeInteraction.strokeId === s.id
        ? activeInteraction.currentStroke
        : s
    );

    // Step 2: Draw Discrete Objects (Uploaded Images, PDF Pages, Sticky Notes, Text)
    for (const stroke of effectiveStrokes) {
      if (stroke.tool === 'image' || stroke.tool === 'sticky' || stroke.tool === 'text') {
        drawDiscreteObject(ctx, stroke, cssW, cssH, redrawAllVectors);
      }
    }

    // Step 3: Clear Transparent Ink Layer & Render All Ink + Eraser (`destination-out`) Strokes
    inkCtx.save();
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, targetW, targetH);
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const stroke of effectiveStrokes) {
      if (
        stroke.tool === 'pen' ||
        stroke.tool === 'highlighter' ||
        stroke.tool === 'eraser' ||
        stroke.tool === 'line' ||
        stroke.tool === 'arrow' ||
        stroke.tool === 'rect' ||
        stroke.tool === 'circle'
      ) {
        drawInkOrEraserStroke(inkCtx, stroke, cssW, cssH);
      }
    }

    // Active in-flight drawing stroke (including live Eraser preview!)
    if (
      isDrawingRef.current &&
      currentPointsRef.current.length > 0 &&
      activeTool !== 'select' &&
      activeTool !== 'laser' &&
      activeTool !== 'pan' &&
      activeTool !== 'text' &&
      activeTool !== 'sticky' &&
      activeTool !== 'image'
    ) {
      drawInkOrEraserStroke(
        inkCtx,
        {
          tool: activeTool,
          color: strokeColor,
          size: strokeSize,
          opacity: activeTool === 'highlighter' ? 0.35 : 1,
          points: currentPointsRef.current,
        },
        cssW,
        cssH
      );
    }

    inkCtx.restore();

    // Composite Transparent Ink Layer onto Main Canvas
    ctx.drawImage(inkCanvas, 0, 0, cssW, cssH);

    // Step 4: Draw Selection Box & 4 Corner Resize Handles for Selected Object
    if (selectedStrokeId) {
      const targetObj = effectiveStrokes.find((s) => s.id === selectedStrokeId);
      if (targetObj && targetObj.tool !== 'eraser') {
        const box = getStrokeBoundingBox(targetObj);
        const bx = box.minX * cssW;
        const by = box.minY * cssH;
        const bw = Math.max(18, (box.maxX - box.minX) * cssW);
        const bh = Math.max(18, (box.maxY - box.minY) * cssH);

        ctx.save();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(bx - 4, by - 4, bw + 8, bh + 8);
        ctx.setLineDash([]);

        const handleRadius = 5.5;
        const corners = [
          { x: bx - 4, y: by - 4 },
          { x: bx + bw + 4, y: by - 4 },
          { x: bx - 4, y: by + bh + 4 },
          { x: bx + bw + 4, y: by + bh + 4 },
        ];
        for (const c of corners) {
          ctx.fillStyle = '#0A0705';
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, handleRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Step 5: Draw Local & Remote Laser Pointer Trails
    if (localLaserTrail.length > 0) {
      for (let i = 0; i < localLaserTrail.length; i++) {
        const pt = localLaserTrail[i];
        const ratio = (i + 1) / localLaserTrail.length;
        ctx.fillStyle = `rgba(244, 63, 94, ${ratio * 0.85})`;
        ctx.beginPath();
        ctx.arc(pt.x * cssW, pt.y * cssH, 3 + ratio * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (remoteLaser) {
      const lx = remoteLaser.x * cssW;
      const ly = remoteLaser.y * cssH;
      ctx.fillStyle = 'rgba(244, 63, 94, 0.9)';
      ctx.beginPath();
      ctx.arc(lx, ly, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [
    strokes,
    activeTemplate,
    slideBackground,
    activeTool,
    strokeColor,
    strokeSize,
    selectedStrokeId,
    localLaserTrail,
    remoteLaser,
    drawBoardTemplate,
    drawDiscreteObject,
    drawInkOrEraserStroke,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      redrawAllVectors();
    });
    ro.observe(container);
    redrawAllVectors();

    return () => {
      ro.disconnect();
    };
  }, [redrawAllVectors]);

  useEffect(() => {
    if (localLaserTrail.length === 0) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setLocalLaserTrail((prev) => prev.filter((p) => now - p.t < 260));
    }, 40);
    return () => window.clearTimeout(timer);
  }, [localLaserTrail]);

  // Detect if pointer hits a corner resize handle of the currently selected object
  const hitTestResizeCorner = (
    normPt: NormalizedPoint,
    box: NormalizedBoundingBox
  ): ResizeHandleCorner | null => {
    const tol = 0.025;
    const corners: { id: ResizeHandleCorner; x: number; y: number }[] = [
      { id: 'nw', x: box.minX, y: box.minY },
      { id: 'ne', x: box.maxX, y: box.minY },
      { id: 'sw', x: box.minX, y: box.maxY },
      { id: 'se', x: box.maxX, y: box.maxY },
    ];
    for (const c of corners) {
      if (Math.hypot(normPt.x - c.x, normPt.y - c.y) <= tol) {
        return c.id;
      }
    }
    return null;
  };

  // Find topmost selectable object at a normalized point
  const findTopmostObjectAt = (normPt: NormalizedPoint): WhiteboardStroke | null => {
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.tool === 'eraser') continue;
      const box = getStrokeBoundingBox(s);
      if (isPointInBoundingBox(normPt, box, 0.015)) {
        return s;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (activeTool === 'pan') {
      panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      return;
    }

    if (!canDraw) return;

    const normPt = normalizePoint(localX, localY, rect.width, rect.height, e.pressure || 0.6);

    // Select / Move / Resize Tool
    if (activeTool === 'select') {
      if (selectedStroke) {
        const selBox = getStrokeBoundingBox(selectedStroke);
        const corner = hitTestResizeCorner(normPt, selBox);
        if (corner) {
          interactionRef.current = {
            mode: 'resize',
            corner,
            strokeId: selectedStroke.id,
            startNorm: normPt,
            initialStroke: selectedStroke,
            initialBox: selBox,
            currentStroke: selectedStroke,
          };
          return;
        }
      }

      const hit = findTopmostObjectAt(normPt);
      if (hit) {
        setSelectedStrokeId(hit.id);
        const hitBox = getStrokeBoundingBox(hit);
        interactionRef.current = {
          mode: 'move',
          strokeId: hit.id,
          startNorm: normPt,
          initialStroke: hit,
          initialBox: hitBox,
          currentStroke: hit,
        };
      } else {
        setSelectedStrokeId(null);
      }
      redrawAllVectors();
      return;
    }

    if (activeTool === 'laser') {
      setLocalLaserTrail((prev) => [
        ...prev.slice(-12),
        { x: normPt.x, y: normPt.y, t: Date.now() },
      ]);
      onMoveLaser({
        authorId: localParticipantId,
        authorName: localParticipantName,
        x: normPt.x,
        y: normPt.y,
        timestamp: Date.now(),
      });
      return;
    }

    if (activeTool === 'text' || activeTool === 'sticky') {
      setPendingTextPos(normPt);
      setCustomTextDraft('');
      return;
    }

    // If user clicks with Eraser directly on a Text or Sticky note, allow erasing it or drawing pixel eraser
    setSelectedStrokeId(null);
    isDrawingRef.current = true;
    currentPointsRef.current = [normPt];
    redrawAllVectors();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (activeTool === 'pan' && panStartRef.current) {
      setPanOffset({
        x: Math.max(-180, Math.min(180, e.clientX - panStartRef.current.x)),
        y: Math.max(-120, Math.min(120, e.clientY - panStartRef.current.y)),
      });
      return;
    }

    if (!canDraw) return;

    const normPt = normalizePoint(localX, localY, rect.width, rect.height, e.pressure || 0.6);

    // Handle active object Move or Corner Resize
    if (activeTool === 'select' && interactionRef.current) {
      const inter = interactionRef.current;
      const dx = normPt.x - inter.startNorm.x;
      const dy = normPt.y - inter.startNorm.y;

      if (inter.mode === 'move') {
        inter.currentStroke = translateStrokePoints(inter.initialStroke, dx, dy);
      } else if (inter.mode === 'resize' && inter.corner) {
        const nextBox = { ...inter.initialBox };
        if (inter.corner === 'nw') {
          nextBox.minX = Math.min(nextBox.maxX - 0.05, nextBox.minX + dx);
          nextBox.minY = Math.min(nextBox.maxY - 0.05, nextBox.minY + dy);
        } else if (inter.corner === 'ne') {
          nextBox.maxX = Math.max(nextBox.minX + 0.05, nextBox.maxX + dx);
          nextBox.minY = Math.min(nextBox.maxY - 0.05, nextBox.minY + dy);
        } else if (inter.corner === 'sw') {
          nextBox.minX = Math.min(nextBox.maxX - 0.05, nextBox.minX + dx);
          nextBox.maxY = Math.max(nextBox.minY + 0.05, nextBox.maxY + dy);
        } else if (inter.corner === 'se') {
          nextBox.maxX = Math.max(nextBox.minX + 0.05, nextBox.maxX + dx);
          nextBox.maxY = Math.max(nextBox.minY + 0.05, nextBox.maxY + dy);
        }
        inter.currentStroke = resizeStrokeToBox(inter.initialStroke, nextBox);
      }
      redrawAllVectors();
      return;
    }

    if (activeTool === 'laser' && e.buttons > 0) {
      setLocalLaserTrail((prev) => [
        ...prev.slice(-14),
        { x: normPt.x, y: normPt.y, t: Date.now() },
      ]);
      onMoveLaser({
        authorId: localParticipantId,
        authorName: localParticipantName,
        x: normPt.x,
        y: normPt.y,
        timestamp: Date.now(),
      });
      return;
    }

    if (!isDrawingRef.current) return;

    if (
      activeTool === 'line' ||
      activeTool === 'arrow' ||
      activeTool === 'rect' ||
      activeTool === 'circle'
    ) {
      currentPointsRef.current = [currentPointsRef.current[0], normPt];
    } else {
      currentPointsRef.current.push(normPt);
    }
    redrawAllVectors();
  };

  const handlePointerUp = () => {
    if (activeTool === 'pan') {
      panStartRef.current = null;
      return;
    }
    if (activeTool === 'laser') {
      onMoveLaser(null);
      return;
    }
    if (activeTool === 'select' && interactionRef.current) {
      const committed = interactionRef.current.currentStroke;
      interactionRef.current = null;
      onUpdateStroke(committed);
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (
      currentPointsRef.current.length > 0 &&
      activeTool !== 'select' &&
      activeTool !== 'text' &&
      activeTool !== 'sticky' &&
      activeTool !== 'image'
    ) {
      const committed: WhiteboardStroke = {
        id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        authorId: localParticipantId,
        authorName: localParticipantName,
        slideIndex: currentSlide,
        tool: activeTool,
        color: strokeColor,
        size: strokeSize,
        opacity: activeTool === 'highlighter' ? 0.35 : 1,
        points: [...currentPointsRef.current],
        createdAt: Date.now(),
      };
      currentPointsRef.current = [];
      onAddStroke(committed);
    }
  };

  const handleCommitTextOrSticky = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTextPos || !customTextDraft.trim()) {
      setPendingTextPos(null);
      return;
    }
    const toolType = activeTool === 'sticky' ? 'sticky' : 'text';
    const newId = `txt-${Date.now()}`;
    const points: NormalizedPoint[] =
      toolType === 'sticky'
        ? [
            pendingTextPos,
            {
              x: Number(Math.min(0.96, pendingTextPos.x + 0.25).toFixed(4)),
              y: Number(Math.min(0.96, pendingTextPos.y + 0.2).toFixed(4)),
            },
          ]
        : [pendingTextPos];

    onAddStroke({
      id: newId,
      authorId: localParticipantId,
      authorName: localParticipantName,
      slideIndex: currentSlide,
      tool: toolType,
      color: strokeColor,
      size: 20,
      opacity: 1,
      points,
      text: customTextDraft.trim(),
      createdAt: Date.now(),
    });
    setPendingTextPos(null);
    setCustomTextDraft('');
    setSelectedStrokeId(newId);
    setActiveTool('select');
  };

  const handleQuickInsertStemSymbol = (symbolText: string) => {
    if (!canDraw) return;
    const yOffset = 0.22 + ((strokes.length * 0.08) % 0.52);
    const newId = `stem-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    onAddStroke({
      id: newId,
      authorId: localParticipantId,
      authorName: localParticipantName,
      slideIndex: currentSlide,
      tool: 'text',
      color: strokeColor,
      size: 22,
      opacity: 1,
      points: [{ x: 0.22, y: Number(yOffset.toFixed(3)) }],
      text: symbolText,
      createdAt: Date.now(),
    });
    setSelectedStrokeId(newId);
    setActiveTool('select');
  };

  // Add a Resizable Image Object onto a Slide
  const addImageObjectToSlide = (
    dataUrl: string,
    targetSlide: number,
    defaultWidthPercent = 0.52
  ) => {
    const img = new Image();
    img.onload = () => {
      const natW = Math.max(1, img.naturalWidth || 800);
      const natH = Math.max(1, img.naturalHeight || 600);
      // 16:9 board aspect compensation
      const boardAspect = 16 / 9;
      const imgAspect = natW / natH;
      let boxW = defaultWidthPercent;
      let boxH = (boxW * boardAspect) / imgAspect;
      if (boxH > 0.84) {
        boxH = 0.84;
        boxW = (boxH * imgAspect) / boardAspect;
      }
      boxW = Math.min(0.92, Math.max(0.15, boxW));
      boxH = Math.min(0.92, Math.max(0.15, boxH));

      const minX = Number(((1 - boxW) / 2).toFixed(4));
      const minY = Number(((1 - boxH) / 2).toFixed(4));
      const maxX = Number((minX + boxW).toFixed(4));
      const maxY = Number((minY + boxH).toFixed(4));

      const newId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      imageCacheRef.current[dataUrl] = img;

      onAddStroke({
        id: newId,
        authorId: localParticipantId,
        authorName: localParticipantName,
        slideIndex: targetSlide,
        tool: 'image',
        color: '#D4A373',
        size: 1,
        opacity: 1,
        points: [
          { x: minX, y: minY },
          { x: maxX, y: maxY },
        ],
        imageDataUrl: dataUrl,
        aspectRatio: imgAspect,
        createdAt: Date.now(),
      });

      if (targetSlide === currentSlide) {
        setSelectedStrokeId(newId);
        setActiveTool('select');
      }
    };
    img.src = dataUrl;
  };

  // Upload Resizable Image Handler
  const handleImageUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        addImageObjectToSlide(reader.result, currentSlide, 0.55);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Upload PDF & Render Pages onto Slides Handler
  const handlePdfUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setIsImportingPdf(true);
    setUploadStatusText(`Importing "${file.name}"...`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      const maxPages = Math.min(pdf.numPages, 15);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        setUploadStatusText(`Rendering PDF Page ${pageNum} of ${maxPages}...`);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.8 });

        const offCanvas = document.createElement('canvas');
        offCanvas.width = viewport.width;
        offCanvas.height = viewport.height;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) continue;

        await page.render({
          canvasContext: offCtx,
          viewport,
          canvas: offCanvas,
        }).promise;

        const pageDataUrl = offCanvas.toDataURL('image/png');
        const targetSlideIdx = currentSlide + (pageNum - 1);
        addImageObjectToSlide(pageDataUrl, targetSlideIdx, 0.82);
      }

      setUploadStatusText(`Imported ${maxPages} PDF page${maxPages > 1 ? 's' : ''} to Whiteboard`);
      window.setTimeout(() => setUploadStatusText(null), 3200);
    } catch {
      setUploadStatusText('Could not render PDF file. Please verify the file is a valid PDF.');
      window.setTimeout(() => setUploadStatusText(null), 3500);
    } finally {
      setIsImportingPdf(false);
    }
  };

  // Update Selected Object Size (Width Percentage 10% - 100%)
  const handleResizeSelectedByWidthPercent = (widthPercent: number) => {
    if (!selectedStroke) return;
    const clampedPct = Math.max(10, Math.min(100, widthPercent)) / 100;
    const curBox = getStrokeBoundingBox(selectedStroke);
    const centerX = (curBox.minX + curBox.maxX) / 2;
    const centerY = (curBox.minY + curBox.maxY) / 2;
    const curW = Math.max(0.05, curBox.maxX - curBox.minX);
    const curH = Math.max(0.05, curBox.maxY - curBox.minY);
    const ratio = curH / curW;

    const newW = clampedPct;
    const newH = Math.min(0.96, Math.max(0.06, newW * ratio));
    const minX = Math.max(0, Math.min(1 - newW, centerX - newW / 2));
    const minY = Math.max(0, Math.min(1 - newH, centerY - newH / 2));

    const updated = resizeStrokeToBox(selectedStroke, {
      minX,
      minY,
      maxX: minX + newW,
      maxY: minY + newH,
    });
    onUpdateStroke(updated);
  };

  const handleCenterSelectedObject = () => {
    if (!selectedStroke) return;
    const box = getStrokeBoundingBox(selectedStroke);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const moved = translateStrokePoints(selectedStroke, 0.5 - cx, 0.5 - cy);
    onUpdateStroke(moved);
  };

  // Export High-Resolution PNG with B2.Connect Watermark Stamp
  const handleExportWatermarkedPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ectx = exportCanvas.getContext('2d');
    if (!ectx) return;

    ectx.drawImage(canvas, 0, 0);

    const pad = 20;
    const badgeW = 280;
    const badgeH = 44;
    const bx = exportCanvas.width - badgeW - pad;
    const by = exportCanvas.height - badgeH - pad;

    ectx.fillStyle = 'rgba(10, 7, 5, 0.9)';
    ectx.strokeStyle = '#D4A373';
    ectx.lineWidth = 2;
    ectx.beginPath();
    ectx.roundRect(bx, by, badgeW, badgeH, 10);
    ectx.fill();
    ectx.stroke();

    ectx.fillStyle = '#FFFFFF';
    ectx.font = '800 16px "Plus Jakarta Sans", sans-serif';
    ectx.fillText('B2.Connect', bx + 14, by + 27);

    ectx.fillStyle = '#F59E0B';
    ectx.font = '500 12px "JetBrains Mono", monospace';
    ectx.fillText(
      `Slide ${currentSlide + 1} · ${new Date().toLocaleTimeString()}`,
      bx + 114,
      by + 27
    );

    const dataUrl = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `B2Connect_Whiteboard_Slide_${currentSlide + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const toolButtons: { id: WhiteboardTool; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Select / Move', icon: <MousePointer className="w-4 h-4" /> },
    { id: 'pen', label: 'Pen', icon: <Pen className="w-4 h-4" /> },
    { id: 'highlighter', label: 'Highlight', icon: <Highlighter className="w-4 h-4" /> },
    { id: 'eraser', label: 'Eraser', icon: <Eraser className="w-4 h-4" /> },
    { id: 'line', label: 'Line', icon: <Minus className="w-4 h-4" /> },
    { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight className="w-4 h-4" /> },
    { id: 'rect', label: 'Rectangle', icon: <Square className="w-4 h-4" /> },
    { id: 'circle', label: 'Circle', icon: <CircleIcon className="w-4 h-4" /> },
    { id: 'text', label: 'Text', icon: <Type className="w-4 h-4" /> },
    { id: 'sticky', label: 'Sticky Note', icon: <StickyNote className="w-4 h-4" /> },
    { id: 'laser', label: 'Laser Pointer', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'pan', label: 'Pan / Zoom', icon: <Hand className="w-4 h-4" /> },
  ];

  const selectedBox = selectedStroke ? getStrokeBoundingBox(selectedStroke) : null;
  const selectedWidthPct = selectedBox
    ? Math.round((selectedBox.maxX - selectedBox.minX) * 100)
    : 50;

  return (
    <div className="flex flex-col h-full min-h-0 w-full gap-2 select-none">
      {/* Top Stage Header: Board Templates, STEM Quick-Insert Bar & Slide / Image / PDF Controls */}
      <div className="b2-glass-pod rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Template Selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <Grid className="w-4 h-4 text-[#D4A373] shrink-0" />
          {(
            [
              { id: 'espresso', label: 'Espresso' },
              { id: 'cartesian', label: 'X-Y Axes' },
              { id: 'grid', label: 'Math Grid' },
              { id: 'notebook', label: 'Notebook' },
              { id: 'dots', label: 'Dot Matrix' },
            ] as { id: BoardTemplate; label: string }[]
          ).map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onChangeTemplate(tpl.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTemplate === tpl.id
                  ? 'bg-[#D4A373] text-[#0D0A08] font-semibold'
                  : 'text-[var(--text-secondary)] hover:bg-white/5'
              }`}
            >
              {tpl.label}
            </button>
          ))}
        </div>

        {/* STEM Formula Quick-Insert Strip */}
        <div className="hidden xl:flex items-center gap-1 overflow-x-auto">
          {STEM_SYMBOLS.slice(0, 6).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => handleQuickInsertStemSymbol(item.symbol)}
              title={`Insert ${item.symbol}`}
              className="px-2 py-1 rounded-md text-xs font-mono-tabular bg-black/20 hover:bg-[#D4A373]/20 text-[var(--text-primary)] border border-[var(--border-specular)] transition-colors whitespace-nowrap shrink-0"
            >
              {item.label.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Multi-Page Slide Deck, Resizable Image Upload, PDF Upload & Export */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-label="Previous Slide"
            disabled={currentSlide <= 0}
            onClick={() => onChangeSlide(currentSlide - 1)}
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40 text-[var(--text-primary)]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono-tabular px-1.5 text-[var(--text-primary)] whitespace-nowrap">
            Slide {currentSlide + 1} / {totalSlides}
          </span>
          <button
            type="button"
            aria-label="Next Slide"
            onClick={() => onChangeSlide(currentSlide + 1)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--text-primary)]"
            title="Next or Add Slide"
          >
            {currentSlide + 1 >= totalSlides ? (
              <Plus className="w-4 h-4 text-[#D4A373]" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {/* Upload Resizable Image Button */}
          <label
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--border-specular)] cursor-pointer transition-colors whitespace-nowrap shrink-0"
            title="Upload Resizable Image to Whiteboard"
          >
            <ImagePlus className="w-3.5 h-3.5 text-[#D4A373]" />
            <span>Add Image</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUploadChange}
              className="hidden"
            />
          </label>

          {/* Upload PDF Document to Slides Button */}
          <label
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-[var(--border-specular)] cursor-pointer transition-colors whitespace-nowrap shrink-0"
            title="Upload PDF Document onto Whiteboard Slides"
          >
            <FileUp className="w-3.5 h-3.5 text-[#D4A373]" />
            <span>{isImportingPdf ? 'Loading PDF...' : 'Upload PDF'}</span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handlePdfUploadChange}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={handleExportWatermarkedPng}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#D4A373]/15 hover:bg-[#D4A373]/25 text-[#D4A373] border border-[#D4A373]/30 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export PNG</span>
          </button>
        </div>
      </div>

      {/* Center 16:9 Vector Stage Container */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden rounded-2xl b2-glass-pod p-1.5"
      >
        <div
          className="relative w-full h-full max-w-full max-h-full aspect-video rounded-xl overflow-hidden shadow-2xl border border-[var(--border-specular)]"
          style={{
            transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${
              panOffset.y / zoomLevel
            }px)`,
            transformOrigin: 'center center',
          }}
        >
          <canvas
            ref={setCanvasRefs}
            data-testid="whiteboard-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
            className={`w-full h-full block ${
              activeTool === 'pan'
                ? 'cursor-grab active:cursor-grabbing'
                : activeTool === 'select'
                ? 'cursor-move'
                : canDraw
                ? 'cursor-crosshair'
                : 'cursor-default'
            }`}
          />

          {/* Floating Inspector Bar for Selected Object (Resize Image, Edit Text, Move/Center, Delete) */}
          {selectedStroke && canDraw && (
            <div className="absolute top-3 right-3 left-auto z-30 b2-glass-elevated px-3 py-2 rounded-xl shadow-2xl border border-[#F59E0B]/50 flex flex-wrap items-center gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#F59E0B]">
                {selectedStroke.tool === 'image'
                  ? 'Image / PDF Size'
                  : selectedStroke.tool === 'text'
                  ? 'Text Object'
                  : selectedStroke.tool === 'sticky'
                  ? 'Sticky Note'
                  : 'Selected Shape'}
              </span>

              {(selectedStroke.tool === 'image' ||
                selectedStroke.tool === 'sticky' ||
                selectedStroke.tool === 'rect') && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono-tabular text-[var(--text-secondary)]">
                    Width: {selectedWidthPct}%
                  </span>
                  <input
                    type="range"
                    aria-label="Selected Object Size Percentage"
                    min={12}
                    max={100}
                    step={2}
                    value={selectedWidthPct}
                    onChange={(e) => handleResizeSelectedByWidthPercent(Number(e.target.value))}
                    className="w-24 accent-[#F59E0B] cursor-pointer"
                  />
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleResizeSelectedByWidthPercent(pct)}
                      className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-[#F59E0B]/25 text-[10px] font-mono-tabular text-[var(--text-primary)]"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              )}

              {(selectedStroke.tool === 'text' || selectedStroke.tool === 'sticky') && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    aria-label="Edit Selected Text"
                    value={selectedStroke.text || ''}
                    onChange={(e) =>
                      onUpdateStroke({
                        ...selectedStroke,
                        text: e.target.value,
                      })
                    }
                    className="px-2 py-1 rounded-lg bg-black/40 border border-white/15 text-xs text-[var(--text-primary)] w-36 focus:outline-none focus:border-[#F59E0B]"
                  />
                  {selectedStroke.tool === 'text' && (
                    <input
                      type="range"
                      aria-label="Text Font Size"
                      min={12}
                      max={48}
                      step={2}
                      value={selectedStroke.size || 20}
                      onChange={(e) =>
                        onUpdateStroke({
                          ...selectedStroke,
                          size: Number(e.target.value),
                        })
                      }
                      className="w-20 accent-[#F59E0B] cursor-pointer"
                      title="Font Size"
                    />
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleCenterSelectedObject}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1"
                title="Center on Slide"
              >
                <Maximize2 className="w-3 h-3 text-[#F59E0B]" />
                <span>Center</span>
              </button>

              <button
                type="button"
                aria-label="Delete Selected Object"
                onClick={() => {
                  onDeleteStroke(selectedStroke.id, currentSlide);
                  setSelectedStrokeId(null);
                }}
                className="px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 text-[11px] font-semibold inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete</span>
              </button>
            </div>
          )}

          {/* Floating Text / Sticky Note Input Overlay when user clicks with Text/Sticky tool */}
          {pendingTextPos && (
            <form
              onSubmit={handleCommitTextOrSticky}
              style={{
                left: `${Math.min(68, Math.max(5, pendingTextPos.x * 100))}%`,
                top: `${Math.min(75, Math.max(8, pendingTextPos.y * 100))}%`,
              }}
              className="absolute z-20 b2-glass-elevated p-2.5 rounded-xl shadow-xl flex items-center gap-2 border border-[#D4A373]/40"
            >
              <input
                type="text"
                autoFocus
                value={customTextDraft}
                onChange={(e) => setCustomTextDraft(e.target.value)}
                placeholder="Type text or formula..."
                className="bg-black/30 text-xs text-[var(--text-primary)] px-2.5 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-[#D4A373] w-52"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#D4A373] text-[#0D0A08] whitespace-nowrap"
              >
                Place
              </button>
              <button
                type="button"
                onClick={() => setPendingTextPos(null)}
                className="px-2 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
            </form>
          )}
        </div>

        {/* Subtle Top-Left Board Telemetry Status */}
        <div className="absolute top-3 left-4 pointer-events-none flex items-center gap-2 text-[11px] font-mono-tabular text-[var(--text-muted)] bg-black/50 backdrop-blur-md px-2.5 py-1 rounded-md">
          <span>16:9 Vector Canvas</span>
          <span aria-hidden="true">·</span>
          <span>{strokes.filter((s) => s.tool !== 'eraser').length} objects</span>
          <span aria-hidden="true">·</span>
          <span>{Math.round(zoomLevel * 100)}%</span>
          {uploadStatusText && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[#F59E0B] font-semibold">{uploadStatusText}</span>
            </>
          )}
        </div>
      </div>

      {/* Bottom Touch & Stylus Contextual Drawing Dock */}
      <div className="b2-glass-pod rounded-xl px-3 py-2 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
        {/* Drawing & Selection Tools */}
        <div className="flex items-center gap-1 shrink-0">
          {toolButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              aria-label={btn.label}
              title={btn.label}
              onClick={() => setActiveTool(btn.id)}
              className={`min-w-[38px] min-h-[38px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTool === btn.id
                  ? 'bg-[#D4A373] text-[#0D0A08] font-semibold shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-white/10'
              }`}
            >
              {btn.icon}
              <span className="hidden 2xl:inline">{btn.label}</span>
            </button>
          ))}
        </div>

        {/* Color Swatches & Brush / Eraser Weight */}
        <div className="flex items-center gap-2 shrink-0 border-x border-[var(--border-specular)] px-3">
          {PALETTE_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={`Color ${c.name}`}
              title={c.name}
              onClick={() => {
                setStrokeColor(c.value);
                if (selectedStroke && selectedStroke.tool !== 'image') {
                  onUpdateStroke({ ...selectedStroke, color: c.value });
                }
              }}
              className={`w-6 h-6 rounded-full transition-transform shrink-0 ${
                strokeColor === c.value
                  ? 'scale-115 ring-2 ring-[#FAF7F5]'
                  : 'opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: c.value }}
            />
          ))}
          <input
            type="range"
            aria-label="Brush Thickness"
            min={2}
            max={12}
            step={0.5}
            value={strokeSize}
            onChange={(e) => setStrokeSize(Number(e.target.value))}
            className="w-16 accent-[#D4A373] cursor-pointer hidden sm:block"
          />
        </div>

        {/* Undo, Clear & Zoom Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-label="Zoom Out"
            onClick={() => {
              setZoomLevel((z) => Math.max(1, Number((z - 0.25).toFixed(2))));
              if (zoomLevel <= 1.25) setPanOffset({ x: 0, y: 0 });
            }}
            className="p-2 rounded-lg hover:bg-white/10 text-[var(--text-secondary)]"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom In"
            onClick={() => setZoomLevel((z) => Math.min(2, Number((z + 0.25).toFixed(2))))}
            className="p-2 rounded-lg hover:bg-white/10 text-[var(--text-secondary)]"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Undo Stroke"
            onClick={onUndoStroke}
            disabled={!canDraw || strokes.length === 0}
            className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-40 text-[var(--text-secondary)]"
            title="Undo Last Action"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Clear Whiteboard Slide"
            onClick={() => {
              onClearSlide();
              setSelectedStrokeId(null);
            }}
            disabled={!canDraw || strokes.length === 0}
            className="p-2 rounded-lg hover:bg-rose-500/20 disabled:opacity-40 text-rose-400"
            title="Clear Current Slide"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhiteboardPod;
