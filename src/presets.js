export const PRESETS = [
  {
    id: 'last-train',
    name: 'Last Train',
    sub: 'Editorial · 8s',
    duration: 8,
    bg: '#f2eee5',
    ink: '#111110',
    accent: '#e23d28',
    art: { title: 'LAST\nTRAIN', num: '01', mark: 'line' }
  },
  {
    id: 'fold',
    name: 'Fold',
    sub: 'Paper · 10s',
    duration: 10,
    bg: '#eae3d6',
    ink: '#1a1714',
    accent: '#c65a3a',
    art: { title: 'FOLD', num: '02', mark: 'arc' }
  },
  {
    id: 'index-01',
    name: 'Index 01',
    sub: 'Swiss · 9s',
    duration: 9,
    bg: '#efeee8',
    ink: '#131410',
    accent: '#7b8461',
    art: { title: '01', num: '03', mark: 'circle' }
  },
  {
    id: 'halftone',
    name: 'Halftone',
    sub: 'Riso · 8s',
    duration: 8,
    bg: '#f2ede2',
    ink: '#17201d',
    accent: '#e4552e',
    art: { title: 'HALF\nTONE', num: '04', mark: 'dots' }
  },
  {
    id: 'specimen-04',
    name: 'Specimen 04',
    sub: 'Technical · 10s',
    duration: 10,
    bg: '#eee9dd',
    ink: '#1b1d1a',
    accent: '#cf3f27',
    art: { title: '04', num: '05', mark: 'cross' }
  },
  {
    id: 'quiet-sun',
    name: 'Quiet Sun',
    sub: 'Organic · 12s',
    duration: 12,
    bg: '#f2e8d5',
    ink: '#26211b',
    accent: '#b65336',
    art: { title: 'SUN', num: '06', mark: 'circle' }
  },
  {
    id: 'manifesto',
    name: 'Manifesto',
    sub: 'Constructivist · 8s',
    duration: 8,
    bg: '#e9e1d0',
    ink: '#14130f',
    accent: '#d33c22',
    art: { title: 'FORM\nFORCE', num: '07', mark: 'diag' }
  },
  {
    id: 'signal',
    name: 'Signal',
    sub: 'Cinematic · 10s',
    duration: 10,
    bg: '#14110c',
    ink: '#ece1cc',
    accent: '#dda05a',
    art: { title: 'SIG', num: '08', mark: 'line' }
  }
];

const cache = new Map();

export async function loadPreset(id) {
  if (cache.has(id)) return cache.get(id);
  const response = await fetch(`presets/${id}.html`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Could not load that preset.');
  const html = await response.text();
  cache.set(id, html);
  return html;
}

export function presetArtHtml(preset) {
  const marks = {
    line: `<i class="art-mark" style="left:0;right:0;top:62%;height:1px;border:0;background:currentColor;opacity:.5"></i>`,
    arc: `<i class="art-mark" style="right:-18px;top:-18px;width:64px;height:64px;border-radius:50%;transform:rotate(32deg);border-style:dashed"></i>`,
    circle: `<i class="art-mark" style="right:10px;bottom:12px;width:26px;height:26px;border-radius:50%;background:currentColor;border:0;opacity:.85"></i>`,
    dots: `<i class="art-mark" style="right:10px;bottom:10px;width:34px;height:24px;border:0;opacity:.55;background-image:radial-gradient(currentColor 1.2px, transparent 1.3px);background-size:6px 6px"></i>`,
    cross: `<i class="art-mark" style="left:14px;top:12px;width:14px;height:14px;border:0;opacity:.6;background:linear-gradient(currentColor,currentColor) center/1px 100% no-repeat,linear-gradient(currentColor,currentColor) center/100% 1px no-repeat"></i>`,
    diag: `<i class="art-mark" style="left:-6px;right:-6px;top:48%;height:7px;border:0;background:currentColor;transform:rotate(-19deg);opacity:.9"></i>`
  };
  return `
    <div class="preset-art" style="background:${preset.bg};color:${preset.ink}">
      <span class="art-num" style="color:${preset.accent}">${preset.art.num}</span>
      ${marks[preset.art.mark] || ''}
      <span class="art-type">${preset.art.title.replace('\n', '<br>')}</span>
    </div>`;
}
