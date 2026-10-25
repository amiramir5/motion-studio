const PATHS = {
  logo: '<path d="M5 5.2h6.4v4.1H5z"/><path d="M12.7 5.2H20v4.1h-7.3z"/><path d="M5 10.6h9.1v4.1H5z"/><path d="M15.4 10.6H20v4.1h-4.6z"/><path d="M5 16h4.6v4.1H5z"/><path d="M10.9 16H20v4.1h-9.1z"/>',
  spark: '<path d="M12 3.2c.6 3.5 2.2 5.3 5.8 6.1-3.6.8-5.2 2.6-5.8 6.1-.6-3.5-2.2-5.3-5.8-6.1 3.6-.8 5.2-2.6 5.8-6.1Z"/><path d="M18.6 15.4c.26 1.5.95 2.28 2.5 2.63-1.55.35-2.24 1.12-2.5 2.63-.27-1.5-.96-2.28-2.5-2.63 1.54-.35 2.23-1.12 2.5-2.63Z"/>',
  play: '<path d="M8.4 5.6 18 12l-9.6 6.4V5.6Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.4"/>',
  replay: '<path d="M4.5 10.5V5.8"/><path d="M4.5 5.8h4.7"/><path d="M4.9 5.9A8 8 0 1 1 4 12"/>',
  export: '<path d="M12 3.8v11.4"/><path d="m7.6 11 4.4 4.4L16.4 11"/><path d="M4.4 17.4v1.3a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-1.3"/>',
  code: '<path d="m8.6 8-4 4 4 4"/><path d="m15.4 8 4 4-4 4"/><path d="m13.4 4.8-2.8 14.4"/>',
  library: '<rect x="3.6" y="5" width="16.8" height="14" rx="2.4"/><path d="M3.6 9.4h16.8"/><path d="M8 5v4.4M16 5v4.4"/><path d="m10 13.2 4 2.3-4 2.3v-4.6Z" fill="currentColor" stroke="none"/>',
  settings: '<path d="M4 7.2h9.4M17.4 7.2h2.6M4 16.8h2.6M10.6 16.8H20"/><circle cx="15.4" cy="7.2" r="2.1"/><circle cx="8.6" cy="16.8" r="2.1"/>',
  plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
  close: '<path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4"/>',
  chevronDown: '<path d="m7 9.6 5 5 5-5"/>',
  chevronRight: '<path d="m9.6 6.8 5.2 5.2-5.2 5.2"/>',
  pencil: '<path d="M4.6 19.4h3.1L19 8.1a1.9 1.9 0 0 0 0-2.7l-.4-.4a1.9 1.9 0 0 0-2.7 0L4.6 16.3v3.1Z"/><path d="m14.6 6.9 2.5 2.5"/>',
  copy: '<rect x="8.4" y="8.4" width="11" height="11" rx="2.1"/><path d="M15.6 8.2V6.6a2.1 2.1 0 0 0-2.1-2.1H6.6a2.1 2.1 0 0 0-2.1 2.1v6.9a2.1 2.1 0 0 0 2.1 2.1h1.6"/>',
  trash: '<path d="M4.8 6.9h14.4"/><path d="M9.5 6.9V4.8h5v2.1"/><path d="M6.7 6.9l.8 12.1a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.8-12.1"/><path d="M10.3 10.5v6.4M13.7 10.5v6.4"/>',
  check: '<path d="m5.4 12.4 4.2 4.2 9-9"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5.2"/><path d="M12 7.9h.01" stroke-width="2.4"/>',
  film: '<rect x="3.3" y="4.8" width="17.4" height="14.4" rx="2.4"/><path d="M7.6 4.8v14.4M16.4 4.8v14.4"/><path d="M3.3 9.4h4.3M3.3 14.6h4.3M16.4 9.4h4.3M16.4 14.6h4.3"/>',
  refresh: '<path d="M19.6 10.6A7.8 7.8 0 1 0 19 15.8"/><path d="M19.6 4.9v5.7h-5.7"/>',
  download: '<path d="M12 3.8v11.4"/><path d="m7.6 11 4.4 4.4L16.4 11"/><path d="M4.4 19.4h15.2"/>',
  link: '<path d="M10.4 13.6a3.9 3.9 0 0 0 5.5 0l2.3-2.3a3.9 3.9 0 0 0-5.5-5.5l-1.1 1.1"/><path d="M13.6 10.4a3.9 3.9 0 0 0-5.5 0l-2.3 2.3a3.9 3.9 0 0 0 5.5 5.5l1.1-1.1"/>',
  grid: '<rect x="4.2" y="4.2" width="6" height="6" rx="1.2"/><rect x="13.8" y="4.2" width="6" height="6" rx="1.2"/><rect x="4.2" y="13.8" width="6" height="6" rx="1.2"/><rect x="13.8" y="13.8" width="6" height="6" rx="1.2"/>',
  warning: '<path d="M12 4.4 20.2 19H3.8L12 4.4Z"/><path d="M12 10v4.1"/><path d="M12 16.9h.01" stroke-width="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4v5l3.1 1.8"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  expand: '<path d="M9 4.5H5.8A1.3 1.3 0 0 0 4.5 5.8V9"/><path d="M15 4.5h3.2a1.3 1.3 0 0 1 1.3 1.3V9"/><path d="M9 19.5H5.8a1.3 1.3 0 0 1-1.3-1.3V15"/><path d="M15 19.5h3.2a1.3 1.3 0 0 0 1.3-1.3V15"/>',
  layers: '<path d="m12 4.2 8 4.1-8 4.1-8-4.1 8-4.1Z"/><path d="m4 12.3 8 4.1 8-4.1"/><path d="m4 16.2 8 4.1 8-4.1"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  reset: '<path d="M4.3 11.4A7.8 7.8 0 1 1 6 17.2"/><path d="M4.3 5.4v6h6"/>',
  key: '<circle cx="8.2" cy="12" r="3.4"/><path d="M11.6 12H20M17.2 12v3M14.4 12v2.2"/>',
  bolt: '<path d="M13.2 3.6 5.8 13h5.1l-.9 7.4 7.4-9.4h-5.1l.9-7.4Z"/>'
};

export function icon(name, size = 18, extra = '') {
  const path = PATHS[name] || PATHS.spark;
  const stroke = name === 'logo' ? 'none' : 'currentColor';
  const fill = name === 'logo' ? 'currentColor' : 'none';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${extra}">${path}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size) || 18);
  });
}
