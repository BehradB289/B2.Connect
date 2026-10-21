export type FaviconBadgeStatus = 'idle' | 'connected' | 'recording' | 'attention';

/**
 * Dynamically renders the B2.Connect favicon on an offscreen 64x64 HTML5 Canvas
 * with high-contrast gold-rimmed typography and real-time status overlays.
 */
export function updateDynamicFavicon(status: FaviconBadgeStatus, unreadCount = 0): void {
  if (typeof document === 'undefined') return;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Deep Obsidian-Espresso Squircle Background
  ctx.fillStyle = '#0A0705';
  ctx.beginPath();
  ctx.roundRect(2, 2, 60, 60, 15);
  ctx.fill();

  // 2. Metallic Amber-Gold Border
  const grad = ctx.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#FDE68A');
  grad.addColorStop(0.5, '#D4A373');
  grad.addColorStop(1, '#B45309');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // 3. High-Contrast "B2" Typography with Dark Outline Guard
  ctx.font = '900 29px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#050302';
  ctx.strokeText('B2', 8, 43);

  const textGrad = ctx.createLinearGradient(0, 14, 0, 46);
  textGrad.addColorStop(0, '#FFFFFF');
  textGrad.addColorStop(0.7, '#FDE68A');
  textGrad.addColorStop(1, '#F59E0B');
  ctx.fillStyle = textGrad;
  ctx.fillText('B2', 8, 43);

  // 4. Signature Amber-Gold Dot (.)
  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.arc(51, 39, 4.8, 0, Math.PI * 2);
  ctx.fill();

  // 5. Dynamic Live Status Badge Overlay (Top-Right Corner)
  if (status !== 'idle' || unreadCount > 0) {
    let badgeColor = '#10B981'; // connected emerald
    if (status === 'recording') badgeColor = '#EF4444'; // recording red
    if (status === 'attention') badgeColor = '#F59E0B'; // hand raised / roll-call amber

    ctx.fillStyle = '#0A0705';
    ctx.beginPath();
    ctx.arc(52, 12, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(52, 12, 7.5, 0, Math.PI * 2);
    ctx.fill();
  }

  let link = document.getElementById('b2-dynamic-favicon') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = 'b2-dynamic-favicon';
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = canvas.toDataURL('image/png');
}
