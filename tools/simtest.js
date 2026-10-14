// Prueba headless: partidas completas sólo con bots. Verifica que el juego "funciona"
// (hay capturas, atrapadas, rescates, mutaciones) y mide el costo de CPU por tick.
import { Room } from '../shared/room.js';
import { PHASE } from '../shared/sim.js';

const games = +(process.argv[2] || 4);
let totals = {};
let wins = [0, 0, 0];
let worstTick = 0;
let totalTicks = 0;
let totalMs = 0;

for (let g = 0; g < games; g++) {
  const sent = [];
  const room = new Room('TEST', {
    send: (id, msg) => sent.push(msg),
    settings: { teamSize: 5, duration: 300, capsToWin: 3, difficulty: g % 3, bots: true },
  });
  room.join('observer', { name: 'Obs', team: 0 });
  // el observador se vuelve bot al salir: así ambos equipos son 100% bots
  room.startMatch();
  room.leave('observer');
  const sim = room.sim;
  const counts = {};
  let ticks = 0;
  while (room.sim && ticks < 30 * 60 * 12) {
    for (const ev of room.sim.events) counts[ev[0]] = (counts[ev[0]] || 0) + 1;
    const t0 = performance.now();
    room.tick();
    const dt = performance.now() - t0;
    worstTick = Math.max(worstTick, dt);
    totalMs += dt;
    ticks++;
  }
  totalTicks += ticks;
  if (sim.phase !== PHASE.ENDED) throw new Error('La partida no terminó');
  wins[sim.winner === -1 ? 2 : sim.winner]++;
  for (const k in counts) totals[k] = (totals[k] || 0) + counts[k];
  console.log(`Partida ${g + 1} (dif ${g % 3}): ganador=${['Papois', 'Macacos', 'Empate'][sim.winner === -1 ? 2 : sim.winner]} ` +
    `marcador=${sim.score.join('-')} duración=${(ticks / 30).toFixed(0)}s ` +
    `tags=${counts.tag || 0} rescates=${counts.rescue || 0} robos=${counts.steal || 0} mutaciones=${counts.mutate || 0} ` +
    `contagios=${counts.infect || 0} congelados=${counts.freeze || 0} aturdidos=${counts.stun || 0} resbalones=${counts.slip || 0} sueros=${counts.serum || 0}`);
}
console.log('Victorias Papois/Macacos/Empates:', wins.join(' / '));
console.log('Totales de eventos:', totals);
console.log(`Tick promedio ${(totalMs / totalTicks).toFixed(3)} ms, peor ${worstTick.toFixed(2)} ms`);
if (!totals.cap) { console.error('ERROR: ninguna captura en todas las partidas'); process.exit(1); }
if (!totals.tag) { console.error('ERROR: nadie fue atrapado'); process.exit(1); }
console.log('OK');
