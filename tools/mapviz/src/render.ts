/** Renders a generated map to a standalone SVG. */

import type { GeneratedMap } from '@www/engine';

/** Twelve hues separated for deuteranopia/protanopia as well as normal vision. */
export const PLAYER_COLOURS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9a6324',
];

export interface RenderOptions {
  size?: number;
  showLabels?: boolean;
  showStormWaves?: boolean;
}

export function renderMapSvg(map: GeneratedMap, options: RenderOptions = {}): string {
  const size = options.size ?? 900;
  const showLabels = options.showLabels ?? true;
  const showStorm = options.showStormWaves ?? true;

  const extent = map.radius * 1.18;
  const view = `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;

  const capitalOf = new Map<number, number>();
  const startOf = new Map<number, number>();
  for (const start of map.starts) {
    capitalOf.set(start.capital, start.slot);
    startOf.set(start.capital, start.slot);
    for (const id of start.extra) startOf.set(id, start.slot);
  }

  const regionById = new Map(map.regions.map((region) => [region.id, region]));
  const waveCount = map.collapseWaves.length;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${size}" height="${size}" role="img">`,
  );
  parts.push(
    `<rect x="${-extent}" y="${-extent}" width="${extent * 2}" height="${extent * 2}" fill="#0f1420"/>`,
  );

  // Territories, filled by region, tinted toward the rim by storm wave.
  parts.push('<g stroke="#0f1420" stroke-width="28" stroke-linejoin="round">');
  for (const territory of map.territories) {
    if (territory.polygon.length < 3) continue;
    const region = regionById.get(territory.regionId);
    const hue = region?.hue ?? 0;
    const owner = startOf.get(territory.id);

    // Territories that burn early are drawn darker, so the storm's path reads
    // at a glance rather than needing an animation to understand.
    const doomed = showStorm && territory.wave >= 0;
    const lightness = doomed ? 22 + (territory.wave / Math.max(1, waveCount)) * 8 : 46;
    const saturation = owner === undefined ? 26 : 52;
    const fill =
      owner === undefined
        ? `hsl(${hue} ${saturation}% ${lightness}%)`
        : PLAYER_COLOURS[owner % PLAYER_COLOURS.length];

    const points = territory.polygon.map(([x, y]) => `${x},${y}`).join(' ');
    parts.push(
      `<polygon points="${points}" fill="${fill}" fill-opacity="${owner === undefined ? 0.85 : 0.9}"/>`,
    );
  }
  parts.push('</g>');

  // Sea lanes: the long-range surprise vector.
  const centroid = new Map(map.territories.map((t) => [t.id, t.centroid]));
  parts.push(
    '<g stroke="#7fd4ff" stroke-width="45" stroke-dasharray="120 90" fill="none" opacity="0.85">',
  );
  for (const edge of map.edges) {
    if (edge.kind !== 'sea') continue;
    const a = centroid.get(edge.a)!;
    const b = centroid.get(edge.b)!;
    // Bow the lane outward so overlapping lanes stay distinguishable.
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const bow = 1.25;
    parts.push(`<path d="M ${a[0]} ${a[1]} Q ${mx * bow} ${my * bow} ${b[0]} ${b[1]}"/>`);
  }
  parts.push('</g>');

  // Capitals.
  parts.push('<g>');
  for (const [id, slot] of capitalOf) {
    const [x, y] = centroid.get(id)!;
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${map.radius * 0.032}" fill="${PLAYER_COLOURS[slot % PLAYER_COLOURS.length]}" stroke="#fff" stroke-width="40"/>`,
    );
  }
  parts.push('</g>');

  if (showLabels) {
    const fontSize = Math.round(map.radius * 0.028);
    parts.push(
      `<g font-family="ui-sans-serif, system-ui, sans-serif" font-size="${fontSize}" fill="#f2f5fa" text-anchor="middle" paint-order="stroke" stroke="#0f1420" stroke-width="${fontSize * 0.3}">`,
    );
    for (const territory of map.territories) {
      const [x, y] = territory.centroid;
      parts.push(`<text x="${x}" y="${y - fontSize * 0.9}">${escapeXml(territory.name)}</text>`);
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
