import React, { useEffect, useRef } from 'react';
import type { RainIntensity, ThemeMode } from '../types/classroom';

/**
 * User-Gesture-Safe Procedural Web Audio Rain & Chime Synthesizer
 * Zero external MP3 dependencies — generates soothing rain-on-glass acoustics
 * using Pink/Brown noise buffers and dual Biquad bandpass/lowpass filters.
 */
class ProceduralRainAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private lowpassFilter: BiquadFilterNode | null = null;
  private bandpassFilter: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private isPlaying = false;
  private currentIntensity: RainIntensity = 'drizzle';
  private currentVolume = 0.35;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setRainConfig(intensity: RainIntensity, volume: number): void {
    this.currentIntensity = intensity;
    this.currentVolume = Math.max(0, Math.min(1, volume));

    if (intensity === 'off' || this.currentVolume <= 0.001) {
      this.stopRain();
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.isPlaying) {
      this.startRainNodes(ctx);
    }

    if (this.lowpassFilter && this.bandpassFilter && this.masterGain) {
      const now = ctx.currentTime;
      const targetFreq = intensity === 'storm' ? 1350 : 780;
      const gainMultiplier = intensity === 'storm' ? 0.55 : 0.32;
      this.lowpassFilter.frequency.setTargetAtTime(targetFreq, now, 0.15);
      this.bandpassFilter.frequency.setTargetAtTime(intensity === 'storm' ? 920 : 540, now, 0.15);
      this.masterGain.gain.setTargetAtTime(this.currentVolume * gainMultiplier, now, 0.15);
    }
  }

  private startRainNodes(ctx: AudioContext): void {
    try {
      const bufferSize = ctx.sampleRate * 3;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);

      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = output[i];
        output[i] *= 2.4;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 620;
      bandpass.Q.value = 0.65;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 850;

      const gain = ctx.createGain();
      gain.gain.value = this.currentVolume * 0.32;

      source.connect(bandpass);
      bandpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(ctx.destination);

      source.start(0);
      this.noiseSource = source;
      this.bandpassFilter = bandpass;
      this.lowpassFilter = lowpass;
      this.masterGain = gain;
      this.isPlaying = true;
    } catch {
      this.isPlaying = false;
    }
  }

  public stopRain(): void {
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
        this.noiseSource.disconnect();
      } catch {
        // Ignore already stopped
      }
      this.noiseSource = null;
    }
    this.isPlaying = false;
  }

  public playChime(type: 'timer' | 'rollcall' | 'hand'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    if (type === 'timer') {
      osc.frequency.setValueAtTime(528, now);
      osc.frequency.exponentialRampToValueAtTime(792, now + 0.35);
    } else if (type === 'rollcall') {
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.14);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  }
}

export const rainAudioEngine = new ProceduralRainAudioEngine();

interface RainDrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
}

interface BokehOrb {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
  driftX: number;
  driftY: number;
}

export interface RainBackdropProps {
  intensity: RainIntensity;
  theme: ThemeMode;
}

export const RainBackdropCanvas: React.FC<RainBackdropProps> = ({ intensity, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const isMobile = width < 768;
    const dropCount =
      intensity === 'off' ? 0 : intensity === 'storm' ? (isMobile ? 45 : 95) : isMobile ? 24 : 52;

    const drops: RainDrop[] = Array.from({ length: dropCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: 14 + Math.random() * 18,
      speed: (intensity === 'storm' ? 9 : 4.5) + Math.random() * 4,
      opacity: 0.08 + Math.random() * 0.16,
    }));

    const bokehColors =
      theme === 'daylight'
        ? ['rgba(212, 163, 115, 0.12)', 'rgba(156, 107, 59, 0.08)', 'rgba(230, 204, 178, 0.14)']
        : ['rgba(212, 163, 115, 0.09)', 'rgba(156, 107, 59, 0.07)', 'rgba(243, 229, 216, 0.05)'];

    const orbs: BokehOrb[] = Array.from({ length: isMobile ? 4 : 7 }, (_, idx) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 90 + Math.random() * 130,
      color: bokehColors[idx % bokehColors.length],
      alpha: 0.06 + Math.random() * 0.06,
      driftX: (Math.random() - 0.5) * 0.2,
      driftY: (Math.random() - 0.5) * 0.15,
    }));

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = canvas.width = Math.max(1, entry.contentRect.width);
        height = canvas.height = Math.max(1, entry.contentRect.height);
      }
    });
    ro.observe(canvas.parentElement || document.body);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      for (const orb of orbs) {
        orb.x += orb.driftX;
        orb.y += orb.driftY;
        if (orb.x < -orb.radius) orb.x = width + orb.radius;
        if (orb.x > width + orb.radius) orb.x = -orb.radius;
        if (orb.y < -orb.radius) orb.y = height + orb.radius;
        if (orb.y > height + orb.radius) orb.y = -orb.radius;

        const grad = ctx.createRadialGradient(orb.x, orb.y, 8, orb.x, orb.y, orb.radius);
        grad.addColorStop(0, orb.color);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (intensity !== 'off') {
        ctx.strokeStyle =
          theme === 'daylight' ? 'rgba(127, 85, 57, 0.22)' : 'rgba(230, 204, 178, 0.22)';
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';

        for (const drop of drops) {
          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y);
          ctx.lineTo(drop.x - drop.length * 0.18, drop.y + drop.length);
          ctx.stroke();

          drop.y += drop.speed;
          drop.x -= drop.speed * 0.18;

          if (drop.y > height) {
            drop.y = -drop.length;
            drop.x = Math.random() * (width + 100);
          }
        }
      }

      animationFrameId = window.requestAnimationFrame(render);
    };

    animationFrameId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      ro.disconnect();
    };
  }, [intensity, theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 w-full h-full"
    />
  );
};
