/**
 * Deterministic procedural artwork generator used by the seed script, so the demo catalogue ships
 * real high-resolution images (in varied aspect ratios) without depending on third-party hotlinks.
 */
import sharp from 'sharp';

let grainTile: Buffer | undefined;

/** Rasterises an artwork and overlays a subtle film-grain texture (tiled noise is far cheaper than an SVG filter). */
export async function renderArtwork(svg: string) {
  grainTile ??= await sharp({ create: { width: 256, height: 256, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .ensureAlpha(0.07)
    .png()
    .toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: grainTile, tile: true, blend: 'over' }]);
}
export type ArtStyle = 'colorfield' | 'geometric' | 'lines' | 'horizon' | 'monolith' | 'vessel' | 'noir' | 'chair' | 'lamp' | 'glass';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function artworkSvg(style: ArtStyle, w: number, h: number, seed: number, palette: string[]) {
  const r = rng(seed);
  const pick = () => palette[Math.floor(r() * palette.length)];
  const [a, b, c, d] = palette;
  let body = '';
  let defs = '';

  switch (style) {
    case 'colorfield': {
      defs += `<filter id="soft"><feGaussianBlur stdDeviation="${Math.min(w, h) * 0.012}"/></filter>`;
      body += `<rect width="${w}" height="${h}" fill="${a}"/>`;
      const bands = 2 + Math.floor(r() * 2);
      const pad = w * 0.08;
      let y = h * 0.07;
      const bandH = (h * 0.86 - (bands - 1) * h * 0.04) / bands;
      for (let i = 0; i < bands; i++) {
        body += `<rect x="${pad}" y="${y}" width="${w - pad * 2}" height="${bandH * (0.8 + r() * 0.4)}" rx="${w * 0.01}" fill="${[b, c, d][i % 3]}" opacity="${0.82 + r() * 0.15}" filter="url(#soft)"/>`;
        y += bandH + h * 0.04;
      }
      break;
    }
    case 'geometric': {
      body += `<rect width="${w}" height="${h}" fill="${a}"/>`;
      for (let i = 0; i < 7; i++) {
        const cx = r() * w, cy = r() * h, rad = Math.min(w, h) * (0.08 + r() * 0.28);
        body += r() > 0.5
          ? `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${pick()}" opacity="${0.75 + r() * 0.25}"/>`
          : `<rect x="${cx - rad}" y="${cy - rad / 2}" width="${rad * 2}" height="${rad}" fill="${pick()}" transform="rotate(${Math.floor(r() * 4) * 45} ${cx} ${cy})"/>`;
      }
      body += `<path d="M ${w * 0.1} ${h * 0.9} A ${w * 0.4} ${w * 0.4} 0 0 1 ${w * 0.9} ${h * 0.9}" fill="none" stroke="${d}" stroke-width="${w * 0.012}"/>`;
      break;
    }
    case 'lines': {
      body += `<rect width="${w}" height="${h}" fill="${a}"/>`;
      const n = 60 + Math.floor(r() * 40);
      const amp = h * (0.05 + r() * 0.08), freq = 1 + r() * 2.5, phase = r() * 6;
      for (let i = 0; i < n; i++) {
        const y0 = (h * (i + 0.5)) / n;
        let dPath = `M 0 ${y0}`;
        for (let x = 0; x <= w; x += w / 40) {
          const t = x / w;
          dPath += ` L ${x.toFixed(1)} ${(y0 + Math.sin(t * Math.PI * freq + phase + i * 0.08) * amp * Math.sin(t * Math.PI)).toFixed(1)}`;
        }
        body += `<path d="${dPath}" fill="none" stroke="${i % 9 === 0 ? c : b}" stroke-width="${w * 0.0016}" opacity="${0.55 + (i % 5) * 0.08}"/>`;
      }
      break;
    }
    case 'horizon': {
      defs += `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.62" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>
        <radialGradient id="sun"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${d}" stop-opacity="0"/></radialGradient>`;
      body += `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
      body += `<circle cx="${w * (0.3 + r() * 0.4)}" cy="${h * 0.6}" r="${Math.min(w, h) * 0.22}" fill="url(#sun)" opacity="0.9"/>`;
      for (let i = 0; i < 4; i++) {
        const base = h * (0.66 + i * 0.09);
        let p = `M 0 ${h} L 0 ${base}`;
        for (let x = 0; x <= w; x += w / 12) p += ` L ${x} ${base - r() * h * 0.06}`;
        body += `<path d="${p} L ${w} ${h} Z" fill="#0b0b0b" opacity="${0.35 + i * 0.18}"/>`;
      }
      break;
    }
    case 'monolith': {
      defs += `<radialGradient id="spot" cx="0.5" cy="0.35" r="0.7"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient>
        <linearGradient id="stone" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}"/><stop offset="0.45" stop-color="${d}"/><stop offset="1" stop-color="${c}" stop-opacity="0.6"/></linearGradient>`;
      body += `<rect width="${w}" height="${h}" fill="url(#spot)"/>`;
      const sw = w * (0.22 + r() * 0.12), sh = h * (0.5 + r() * 0.15);
      const x = (w - sw) / 2, y = h * 0.82 - sh;
      body += `<ellipse cx="${w / 2}" cy="${h * 0.83}" rx="${sw * 0.9}" ry="${h * 0.02}" fill="#000" opacity="0.6"/>`;
      body += `<path d="M ${x} ${y + sh} C ${x - sw * 0.1} ${y + sh * 0.4}, ${x + sw * 0.2} ${y}, ${x + sw / 2} ${y} C ${x + sw * 0.8} ${y}, ${x + sw * 1.1} ${y + sh * 0.4}, ${x + sw} ${y + sh} Z" fill="url(#stone)"/>`;
      body += `<ellipse cx="${w / 2}" cy="${y + sh * 0.42}" rx="${sw * 0.16}" ry="${sh * 0.12}" fill="${a}"/>`;
      break;
    }
    case 'vessel': {
      defs += `<linearGradient id="glaze" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}"/><stop offset="0.4" stop-color="${d}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
      body += `<rect width="${w}" height="${h}" fill="${a}"/><rect y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="${b}"/>`;
      const cx = w / 2, top = h * 0.25, bottom = h * 0.78, belly = w * (0.2 + r() * 0.1), neck = belly * (0.3 + r() * 0.25);
      body += `<path d="M ${cx - neck} ${top} C ${cx - neck} ${top + h * 0.12}, ${cx - belly * 1.4} ${top + h * 0.2}, ${cx - belly} ${bottom - h * 0.08} Q ${cx - belly * 0.8} ${bottom}, ${cx} ${bottom} Q ${cx + belly * 0.8} ${bottom}, ${cx + belly} ${bottom - h * 0.08} C ${cx + belly * 1.4} ${top + h * 0.2}, ${cx + neck} ${top + h * 0.12}, ${cx + neck} ${top} Z" fill="url(#glaze)"/>`;
      body += `<ellipse cx="${cx}" cy="${top}" rx="${neck}" ry="${h * 0.012}" fill="#0a0a0a"/>`;
      break;
    }
    case 'noir': {
      defs += `<linearGradient id="bw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8e8e8"/><stop offset="1" stop-color="#151515"/></linearGradient>`;
      body += `<rect width="${w}" height="${h}" fill="#0d0d0d"/>`;
      for (let i = 0; i < 9; i++) {
        const x = r() * w;
        body += `<rect x="${x}" y="0" width="${w * (0.01 + r() * 0.08)}" height="${h}" fill="url(#bw)" opacity="${0.15 + r() * 0.5}" transform="skewX(${-20 + r() * 40})"/>`;
      }
      body += `<circle cx="${w * 0.62}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.12}" fill="#f2f2f2" opacity="0.85"/>`;
      body += `<rect x="0" y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="#000" opacity="0.7"/>`;
      break;
    }
    case 'chair': {
      body += `<rect width="${w}" height="${h}" fill="${a}"/><rect y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="${b}"/>`;
      const s = Math.min(w, h);
      const x = w / 2 - s * 0.22, y = h * 0.8;
      body += `<ellipse cx="${w / 2}" cy="${y}" rx="${s * 0.3}" ry="${s * 0.02}" fill="#000" opacity="0.5"/>`;
      body += `<path d="M ${x} ${y} L ${x + s * 0.04} ${y - s * 0.28} L ${x + s * 0.4} ${y - s * 0.28} L ${x + s * 0.44} ${y}" fill="none" stroke="${d}" stroke-width="${s * 0.014}"/>`;
      body += `<path d="M ${x - s * 0.02} ${y - s * 0.3} Q ${x + s * 0.22} ${y - s * 0.24} ${x + s * 0.46} ${y - s * 0.3} L ${x + s * 0.44} ${y - s * 0.36} Q ${x + s * 0.22} ${y - s * 0.32} ${x} ${y - s * 0.36} Z" fill="${c}"/>`;
      body += `<path d="M ${x + s * 0.02} ${y - s * 0.36} C ${x - s * 0.02} ${y - s * 0.6}, ${x + s * 0.12} ${y - s * 0.72}, ${x + s * 0.22} ${y - s * 0.72} C ${x + s * 0.32} ${y - s * 0.72}, ${x + s * 0.46} ${y - s * 0.6}, ${x + s * 0.42} ${y - s * 0.36}" fill="${c}" opacity="0.92"/>`;
      break;
    }
    case 'lamp': {
      defs += `<radialGradient id="glow" cx="0.5" cy="0.45" r="0.5"><stop offset="0" stop-color="${d}" stop-opacity="0.9"/><stop offset="1" stop-color="${d}" stop-opacity="0"/></radialGradient>`;
      body += `<rect width="${w}" height="${h}" fill="${a}"/>`;
      body += `<circle cx="${w / 2}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.45}" fill="url(#glow)"/>`;
      body += `<line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h * 0.32}" stroke="${c}" stroke-width="${w * 0.004}"/>`;
      body += `<path d="M ${w * 0.32} ${h * 0.46} Q ${w / 2} ${h * 0.24} ${w * 0.68} ${h * 0.46} Z" fill="${c}"/>`;
      body += `<ellipse cx="${w / 2}" cy="${h * 0.46}" rx="${w * 0.18}" ry="${h * 0.012}" fill="${d}"/>`;
      break;
    }
    case 'glass': {
      defs += `<linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.9"/><stop offset="1" stop-color="${d}" stop-opacity="0.5"/></linearGradient>`;
      body += `<rect width="${w}" height="${h}" fill="${a}"/>`;
      for (let i = 0; i < 3; i++) {
        const cx = w * (0.3 + i * 0.2), rad = Math.min(w, h) * (0.12 + r() * 0.08), cy = h * 0.72 - rad;
        body += `<ellipse cx="${cx}" cy="${cy}" rx="${rad * 0.8}" ry="${rad * 1.3}" fill="url(#gl)" stroke="${b}" stroke-width="${w * 0.002}"/>`;
        body += `<ellipse cx="${cx - rad * 0.3}" cy="${cy - rad * 0.5}" rx="${rad * 0.12}" ry="${rad * 0.4}" fill="#fff" opacity="0.35"/>`;
      }
      body += `<rect y="${h * 0.72}" width="${w}" height="${h * 0.28}" fill="${b}" opacity="0.6"/>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${defs}</defs>${body}</svg>`;
}
