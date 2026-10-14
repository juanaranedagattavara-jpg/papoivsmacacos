// Constantes de juego compartidas entre servidor y cliente.
// Unidades: metros y segundos.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // ticks entre snapshots (15 Hz)

export const PAPOIS = 0;
export const MACACOS = 1;

export const TEAMS = [
  {
    id: PAPOIS,
    name: 'Papois',
    color: '#FFC928',
    colorHex: 0xffc928,
    dark: '#2b5aa8',
    weapon: 'Rayo Congelador',
    ability: 'Pistola de Pedos',
    mutant: 'Papoi Morado',
    serum: 'Suero PX-41',
  },
  {
    id: MACACOS,
    name: 'Macacos',
    color: '#3DDC84',
    colorHex: 0x3ddc84,
    dark: '#6b3d1e',
    weapon: 'Coco Bomba',
    ability: 'Salto de Liana',
    mutant: 'Macaco Salvaje',
    serum: 'Virus Simio',
  },
];

export const PLAYER = {
  radius: 0.55,
  mutantRadius: 0.75,
  speed: [5.6, 5.6], // misma base; los Macacos compensan con salto y nado
  carrySpeed: 0.96,
  stealBoost: 3, // adrenalina al robar la bandera (s)
  waterSpeed: [0.6, 0.8], // los Macacos nadan mejor
  slowFactor: 0.5,
  mutantSpeed: 1.22,
  boostSpeed: 1.3,
  groupBonus: 0.06, // Papois: +6% por aliado cercano (máx 2)
  groupRange: 4,
};

export const WEAPONS = [
  // Papois: Rayo Congelador
  { kind: 'ice', speed: 21, range: 11.5, radius: 0.32, cooldown: 1.4, freeze: 1.05 },
  // Macacos: Coco Bomba
  { kind: 'coco', speed: 17.5, range: 9.5, radius: 0.38, cooldown: 1.15, stun: 0.85, knock: 7 },
];

export const ABILITIES = [
  // Papois: Pistola de Pedos -> nube que empuja y ralentiza + propulsión propia
  { kind: 'fart', cooldown: 7.5, radius: 3.4, life: 3.6, knock: 12, slow: 0.5, boost: 2 },
  // Macacos: Salto de Liana -> dash aéreo, deja cáscara de plátano
  { kind: 'leap', cooldown: 5.5, time: 0.32, carryTime: 0.2, speed: 15, peelLife: 14, peelMax: 3, slip: 0.75, slipSpeed: 8 },
];

export const MUTATION = {
  transform: 0.6,
  duration: 7,
  contagionMin: 3.5,
  contagionCooldown: 12,
  shockRadius: 3.6,
  shockKnock: 13,
  lungeSpeed: 17,
  lungeTime: 0.22,
  lungeCooldown: 1.1,
  knockdown: 1.5,
};

export const ULT = {
  passive: 1 / 360,
  tag: 0.07,
  rescue: 0.12,
  rescueEach: 0.04,
  hit: 0.012,
  serum: 0.35,
  carry: 0.02,
  capture: 0.25,
  ret: 0.08,
  brote: 0.4,
};

export const RULES = {
  jailTime: 8,
  respawnShield: 2,
  rescueShield: 3,
  dropReturn: 12,
  flagGrab: 1.35,
  baseRadius: 2.8,
  flagZone: 3.4, // los defensores no pueden pisar el círculo de su propia bandera
  stealShield: 1.5,
  carrierSlow: 1.1, // congelar/aturdir al portador sólo lo ralentiza
  jailRadius: 2.2,
  ccImmune: 0.8,
  carrierTagStun: 1.2,
  serumEvery: 22,
  serumMax: 2,
  serumRadius: 1.1,
  broteAt: 60,
  overtime: 60,
  countdown: 3.5,
};

export const DEFAULT_SETTINGS = {
  teamSize: 4,
  duration: 300,
  capsToWin: 3,
  difficulty: 1,
  bots: true,
  classic: false,
};

export const LIMITS = {
  maxPlayers: 10,
  maxTeam: 5,
  nameLen: 14,
};

// Flags de estado en snapshots
export const F = {
  JAILED: 1,
  FROZEN: 2,
  STUNNED: 4,
  SLOWED: 8,
  SHIELD: 16,
  AIR: 32,
  MUTANT: 64,
  TRANSFORM: 128,
  CARRY: 256,
  DASH: 512,
  BOOST: 1024,
  BUSH: 2048,
  WATER: 4096,
  MOVING: 8192,
};

export const EMOTES = ['¡Bello!', '¡Ayuda!', '¡Voy por la bandera!', '¡Defiendan!', '¡Libérenme!', '¡Bananaaa!', '¡Bien hecho!', '¡Cuidado!'];

export const PAPOI_NAMES = ['Tito', 'Bidu', 'Pepo', 'Gogle', 'Tuki', 'Lalo', 'Bananín', 'Chicho', 'Pipo', 'Moco', 'Toto', 'Yeyo'];
export const MACACO_NAMES = ['Coco', 'Kiko', 'Bongo', 'Tití', 'Simón', 'Pancho', 'Chita', 'Mandril', 'Rafiki', 'Moncho', 'Lulo', 'Taca'];
