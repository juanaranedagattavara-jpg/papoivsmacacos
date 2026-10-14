// Perfil local: nombre, apariencia, nivel/XP, logros y preferencias.
const KEY = 'pvm_profile_v1';

export const HAT_UNLOCKS = [
  { id: 'none', name: 'Sin gorro', level: 1 },
  { id: 'gorra', name: 'Gorra', level: 2 },
  { id: 'casco', name: 'Casco minero', level: 3 },
  { id: 'fiesta', name: 'Gorro de fiesta', level: 4 },
  { id: 'flor', name: 'Flor', level: 5 },
  { id: 'pirata', name: 'Pirata', level: 7 },
  { id: 'vikingo', name: 'Vikingo', level: 9 },
  { id: 'corona', name: 'Corona', level: 12 },
];

export const FUR_NAMES = ['Café', 'Dorado', 'Gris', 'Negro'];
export const FUR_UNLOCKS = [1, 1, 3, 6];

const DEFAULT = {
  name: '',
  team: 0,
  skin: { hat: 'none', eyes: 2, fur: 0 },
  xp: 0,
  level: 1,
  games: 0,
  wins: 0,
  totals: { caps: 0, tags: 0, rescues: 0, hits: 0, steals: 0, infects: 0 },
  prefs: { sfx: true, music: true, vibrate: true, voices: true, quality: null, tips: true },
  best: { caps: 0, tags: 0 },
};

export function xpForLevel(level) {
  return 250 + (level - 1) * 120;
}

export function loadProfile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { p = null; }
  p = { ...structuredClone(DEFAULT), ...(p || {}) };
  p.skin = { ...DEFAULT.skin, ...(p.skin || {}) };
  p.prefs = { ...DEFAULT.prefs, ...(p.prefs || {}) };
  p.totals = { ...DEFAULT.totals, ...(p.totals || {}) };
  p.best = { ...DEFAULT.best, ...(p.best || {}) };
  if (p.prefs.quality === null) p.prefs.quality = guessQuality();
  return p;
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* modo privado */ }
}

function guessQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (!mobile) return 2;
  if (mem >= 6 && cores >= 8) return 2;
  if (mem >= 3) return 1;
  return 0;
}

// Calcula la XP de una partida y la aplica. Devuelve el detalle para mostrarlo.
export function applyMatchXp(profile, results, meId, myTeam) {
  const me = results.players.find((p) => p.id === meId);
  const s = me ? me.stats : { caps: 0, tags: 0, rescues: 0, hits: 0, steals: 0, infects: 0, returns: 0 };
  const won = results.winner === myTeam;
  const draw = results.winner === -1;
  const lines = [
    ['Partida jugada', 60],
    [won ? '¡Victoria!' : draw ? 'Empate' : 'Derrota (¡buen intento!)', won ? 120 : draw ? 50 : 20],
  ];
  if (s.caps) lines.push([`Capturas ×${s.caps}`, s.caps * 50]);
  if (s.steals) lines.push([`Robos ×${s.steals}`, s.steals * 15]);
  if (s.tags) lines.push([`Atrapadas ×${s.tags}`, s.tags * 12]);
  if (s.rescues) lines.push([`Rescates ×${s.rescues}`, s.rescues * 18]);
  if (s.returns) lines.push([`Banderas recuperadas ×${s.returns}`, s.returns * 15]);
  if (s.hits) lines.push([`Impactos ×${s.hits}`, s.hits * 3]);
  if (s.infects) lines.push([`Contagios ×${s.infects}`, s.infects * 10]);
  const mvp = [...results.players].sort((a, b) => b.mvp - a.mvp)[0];
  if (mvp && mvp.id === meId) lines.push(['MVP de la partida', 80]);
  const gained = lines.reduce((a, l) => a + l[1], 0);

  const before = { level: profile.level, xp: profile.xp };
  profile.xp += gained;
  const unlocked = [];
  while (profile.xp >= xpForLevel(profile.level)) {
    profile.xp -= xpForLevel(profile.level);
    profile.level++;
    for (const h of HAT_UNLOCKS) if (h.level === profile.level) unlocked.push(`Gorro: ${h.name}`);
    FUR_UNLOCKS.forEach((lv, i) => { if (lv === profile.level) unlocked.push(`Pelaje de Macaco: ${FUR_NAMES[i]}`); });
    if (profile.level === 2) unlocked.push('Papoi de un ojo');
  }
  profile.games++;
  if (won) profile.wins++;
  for (const k of Object.keys(profile.totals)) profile.totals[k] += s[k] || 0;
  profile.best.caps = Math.max(profile.best.caps, s.caps || 0);
  profile.best.tags = Math.max(profile.best.tags, s.tags || 0);
  saveProfile(profile);
  return { lines, gained, before, after: { level: profile.level, xp: profile.xp }, unlocked, won, draw };
}
