// Punto de entrada: carga, menús, salas, partidas y resultados.
import { World } from './render/world.js';
import { Sound } from './audio.js';
import { Game, escapeHtml } from './game.js';
import { LocalConnection, NetConnection, serverUrl, onlineAvailable } from './net.js';
import { loadProfile, saveProfile, xpForLevel, applyMatchXp, HAT_UNLOCKS, FUR_NAMES, FUR_UNLOCKS } from './profile.js';
import { TEAMS, DEFAULT_SETTINGS, F } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const profile = loadProfile();
const sound = new Sound();
sound.setSfx(profile.prefs.sfx);
sound.setMusic(profile.prefs.music);

let world = null;
let game = null;
let conn = null; // conexión online persistente
let local = null; // conexión local (bots)
let lobby = null;
let current = 'boot';
let menuLoop = null;
let lastBots = { ...DEFAULT_SETTINGS, ...(safeJson(localStorage.getItem('pvm_bots')) || {}) };
let lastResults = null;
let pendingJoin = null;

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ------------------------------------------------------------ utilidades UI
function show(id) {
  current = id;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id);
  if (id === 'menu') refreshMenu();
  if (id === 'custom') refreshCustom();
  if (id === 'settings') refreshSettings();
  if (id === 'bots') refreshBots();
  if (id === 'online') refreshOnline();
  if (['menu', 'custom', 'settings', 'bots', 'online', 'howto', 'lobby', 'results'].includes(id)) startMenuLoop();
}

let toastTimer = null;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'on' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

function bindSeg(seg, value, onPick) {
  for (const b of seg.querySelectorAll('button')) {
    b.classList.toggle('sel', String(b.dataset.v) === String(value));
    b.onclick = () => {
      sound.play('click');
      for (const x of seg.querySelectorAll('button')) x.classList.toggle('sel', x === b);
      onPick(b.dataset.v);
    };
  }
}

function profileInfo() {
  return { name: profile.name || 'Jugador', skin: profile.skin, level: profile.level };
}

// ------------------------------------------------------------ menú / vitrina 3D
function startMenuLoop() {
  if (menuLoop || !world || (game && game.running)) return;
  let last = performance.now();
  let angle = 0.25;
  let jumpT = 0;
  const loop = (t) => {
    if (game && game.running) { menuLoop = null; return; }
    menuLoop = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    angle += dt * 0.12;
    jumpT += dt;
    const customizing = current === 'custom';
    const focusTeam = profile.team;
    const hop = (jumpT % 4.5) < 0.32;
    const players = [
      { id: -1, x: 30.6, y: 18.2, face: Math.PI / 2 - 0.35, flags: hop && focusTeam === 0 ? F.AIR : 0 },
      { id: -2, x: 33.4, y: 18.2, face: Math.PI / 2 + 0.35, flags: hop && focusTeam === 1 ? F.AIR : 0 },
    ];
    let focus = { x: 32, y: 18.2 };
    let orbit = { angle: Math.sin(angle) * 0.5, dist: 7.5, height: 3.6, lookY: 0.9 };
    const portrait = window.innerHeight > window.innerWidth;
    if (customizing) {
      const cx = focusTeam === 0 ? 30.6 : 33.4;
      focus = { x: cx, y: 18.2 };
      orbit = { angle: Math.sin(angle * 2) * 0.6, dist: portrait ? 5.5 : 3.4, height: portrait ? 2.6 : 1.7, lookY: portrait ? 0.4 : 0.85, offsetX: portrait ? 0 : -1.1 };
    } else if (portrait) {
      orbit.dist = 11; orbit.height = 5;
    } else if (current === 'menu') {
      // en horizontal el panel ocupa la derecha: correr a los personajes a la izquierda
      orbit.offsetX = 2.6; orbit.lookY = 1.7; orbit.dist = 7; orbit.height = 3.4;
    }
    world.update(dt, { focus, orbit, players, flags: [{ state: 0 }, { state: 0 }], myBush: -1 });
    world.render();
  };
  menuLoop = requestAnimationFrame(loop);
}

function stopMenuLoop() {
  if (menuLoop) cancelAnimationFrame(menuLoop);
  menuLoop = null;
}

function setShowcase() {
  world.setPlayers([
    { id: -1, name: 'Papoi', team: 0, skin: { ...profile.skin }, level: profile.level },
    { id: -2, name: 'Macaco', team: 1, skin: { ...profile.skin }, level: profile.level },
  ], profile.team === 0 ? -1 : -2, profile.team);
  // sin anillos en la vitrina
  for (const v of world.chars.values()) { v.ring.visible = false; if (v.ring2) v.ring2.visible = false; }
}

function refreshMenu() {
  $('menuLvl').textContent = profile.level;
  $('menuName').textContent = profile.name || 'Jugador';
  $('menuXp').style.width = `${Math.min(100, (profile.xp / xpForLevel(profile.level)) * 100)}%`;
  $('nameInput').value = profile.name;
}

// ------------------------------------------------------------ personalización
const HAT_ICONS = { none: '❌', gorra: '🧢', casco: '⛑️', fiesta: '🥳', flor: '🌸', pirata: '🏴‍☠️', vikingo: '🪖', corona: '👑' };
const FUR_SWATCH = ['#7a4a26', '#b07a32', '#77777e', '#3a2e28'];

function refreshCustom() {
  $('cLvl').textContent = profile.level;
  $('cName').textContent = profile.name || 'Jugador';
  const need = xpForLevel(profile.level);
  $('cXp').style.width = `${(profile.xp / need) * 100}%`;
  $('cXpTxt').textContent = `${profile.xp} / ${need} XP para nivel ${profile.level + 1}`;
  for (const b of $('cTeam').querySelectorAll('.team-card')) {
    b.classList.toggle('sel', +b.dataset.team === profile.team);
    b.onclick = () => { profile.team = +b.dataset.team; saveProfile(profile); sound.play('click'); setShowcase(); refreshCustom(); };
  }
  const hg = $('hatGrid');
  hg.innerHTML = '';
  for (const h of HAT_UNLOCKS) {
    const b = document.createElement('button');
    const locked = profile.level < h.level;
    b.className = (profile.skin.hat === h.id ? 'sel ' : '') + (locked ? 'locked' : '');
    b.dataset.lock = `Nivel ${h.level}`;
    b.innerHTML = `<span class="e">${HAT_ICONS[h.id]}</span>${h.name}`;
    b.onclick = () => {
      if (locked) { toast(`Se desbloquea en el nivel ${h.level}`); return; }
      profile.skin.hat = h.id; saveProfile(profile); sound.play('click'); setShowcase(); refreshCustom(); syncProfileOnline();
    };
    hg.appendChild(b);
  }
  $('eyesBox').classList.toggle('hidden', profile.team !== 0);
  $('furBox').classList.toggle('hidden', profile.team !== 1);
  const eyes = $('eyesSeg');
  for (const b of eyes.querySelectorAll('button')) {
    const one = b.dataset.v === '1';
    const locked = one && profile.level < 2;
    b.classList.toggle('sel', String(profile.skin.eyes) === b.dataset.v);
    b.textContent = one ? (locked ? 'Un ojo 🔒 Nv 2' : 'Un ojo') : 'Dos ojos';
    b.onclick = () => {
      if (locked) { toast('Se desbloquea en el nivel 2'); return; }
      profile.skin.eyes = +b.dataset.v; saveProfile(profile); sound.play('click'); setShowcase(); refreshCustom(); syncProfileOnline();
    };
  }
  const fg = $('furGrid');
  fg.innerHTML = '';
  FUR_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    const locked = profile.level < FUR_UNLOCKS[i];
    b.className = (profile.skin.fur === i ? 'sel ' : '') + (locked ? 'locked' : '');
    b.dataset.lock = `Nivel ${FUR_UNLOCKS[i]}`;
    b.innerHTML = `<span class="e" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${FUR_SWATCH[i]}"></span>${n}`;
    b.onclick = () => {
      if (locked) { toast(`Se desbloquea en el nivel ${FUR_UNLOCKS[i]}`); return; }
      profile.skin.fur = i; saveProfile(profile); sound.play('click'); setShowcase(); refreshCustom(); syncProfileOnline();
    };
    fg.appendChild(b);
  });
  const t = profile.totals;
  $('cStats').innerHTML = `<div><b>${profile.games}</b>partidas</div><div><b>${profile.wins}</b>victorias</div><div><b>${t.caps}</b>capturas</div>` +
    `<div><b>${t.tags}</b>atrapadas</div><div><b>${t.rescues}</b>rescates</div><div><b>${t.infects}</b>contagios</div>`;
}

function syncProfileOnline() {
  if (conn && !conn.closed) conn.send({ t: 'hello', ...profileInfo() });
}

// ------------------------------------------------------------ ajustes
function refreshSettings() {
  for (const seg of document.querySelectorAll('[data-pref]')) {
    const k = seg.dataset.pref;
    const v = k === 'quality' ? profile.prefs.quality : profile.prefs[k] ? 1 : 0;
    bindSeg(seg, v, (val) => {
      if (k === 'quality') {
        profile.prefs.quality = +val;
        saveProfile(profile);
        toast('Aplicando calidad…');
        setTimeout(() => location.reload(), 400);
        return;
      }
      profile.prefs[k] = val === '1';
      saveProfile(profile);
      if (k === 'sfx') sound.setSfx(profile.prefs.sfx);
      if (k === 'music') { sound.setMusic(profile.prefs.music); if (profile.prefs.music) sound.startMusic(); }
    });
  }
}

function fullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => {
      try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* */ }
    }).catch(() => {});
  }
}

// ------------------------------------------------------------ partida contra bots
function refreshBots() {
  for (const b of $('botsTeam').querySelectorAll('.team-card')) {
    b.classList.toggle('sel', +b.dataset.team === profile.team);
    b.onclick = () => { profile.team = +b.dataset.team; saveProfile(profile); sound.play('click'); setShowcase(); refreshBots(); };
  }
  for (const seg of $('bots').querySelectorAll('[data-opt]')) {
    const k = seg.dataset.opt;
    bindSeg(seg, lastBots[k], (v) => { lastBots[k] = +v; localStorage.setItem('pvm_bots', JSON.stringify(lastBots)); });
  }
}

function startBots() {
  sound.unlock();
  if (isTouch()) fullscreen();
  if (local) local.close();
  local = new LocalConnection();
  local.onMessage((m) => dispatch(m, local));
  local.hello(profileInfo());
  local.create(profile.team, { ...lastBots, bots: true });
  local.send({ t: 'start' });
}

// ------------------------------------------------------------ online
function refreshOnline() {
  const ok = onlineAvailable();
  $('onlineNote').textContent = ok
    ? 'Tip: comparte el link de invitación por WhatsApp y tus amigos entran directo a tu sala.'
    : 'El modo online necesita el servidor del juego (ver README). En esta versión solo puedes jugar contra bots.';
  for (const id of ['btnCreate', 'btnJoin', 'btnQuick']) $(id).disabled = !ok;
}

function ensureConn() {
  if (conn && !conn.closed) return conn;
  conn = new NetConnection(serverUrl());
  conn.onMessage((m) => dispatch(m, conn));
  conn.onClose = () => {
    if (game && game.running && !game.conn.isLocal) {
      toast('Se perdió la conexión con el servidor', true);
      game.destroy();
      game = null;
      show('menu');
    } else if (current === 'lobby') {
      toast('Se perdió la conexión con el servidor', true);
      show('menu');
    }
    conn = null;
  };
  conn.ready.catch(() => { toast('No se pudo conectar al servidor', true); });
  conn.send({ t: 'hello', ...profileInfo() });
  return conn;
}

function createRoom() {
  sound.unlock();
  const c = ensureConn();
  const s = safeJson(localStorage.getItem('pvm_online')) || {};
  c.send({ t: 'create', team: profile.team, settings: { ...DEFAULT_SETTINGS, ...s } });
}

function joinRoom(code) {
  sound.unlock();
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { toast('El código tiene 4 letras', true); return; }
  ensureConn().send({ t: 'join', code, team: profile.team });
}

function renderLobby() {
  if (!lobby) return;
  $('lobbyCode').textContent = lobby.code;
  const isHost = lobby.host === lobby.you;
  for (const t of [0, 1]) {
    const ul = $('lt' + t);
    const list = lobby.players.filter((p) => p.team === t);
    ul.innerHTML = list.map((p) => `<li class="${p.id === lobby.you ? 'me' : ''}"><span class="mini-lvl">${p.level}</span>${escapeHtml(p.name)}${p.id === lobby.host ? '<span class="host">👑</span>' : ''}</li>`).join('');
    const bots = lobby.settings.bots ? Math.max(0, Math.max(lobby.settings.teamSize, ...[0, 1].map((x) => lobby.players.filter((p) => p.team === x).length)) - list.length) : 0;
    for (let i = 0; i < bots; i++) ul.innerHTML += '<li class="bot">🤖 Bot</li>';
  }
  for (const seg of document.querySelectorAll('[data-lopt]')) {
    const k = seg.dataset.lopt;
    const v = typeof lobby.settings[k] === 'boolean' ? (lobby.settings[k] ? 1 : 0) : lobby.settings[k];
    seg.classList.toggle('disabled', !isHost);
    bindSeg(seg, v, (val) => {
      const s = { [k]: k === 'bots' || k === 'classic' ? val === '1' : +val };
      conn.send({ t: 'settings', settings: s });
      localStorage.setItem('pvm_online', JSON.stringify({ ...lobby.settings, ...s }));
    });
  }
  $('classicHint').classList.toggle('hidden', !lobby.settings.classic);
  $('lobbyStart').classList.toggle('hidden', !isHost);
  $('lobbyWait').classList.toggle('hidden', isHost);
  $('lobbyWait').textContent = lobby.phase === 'match' ? 'Partida en curso… entrando' : 'Esperando a que el anfitrión empiece…';
}

function inviteLink() {
  return `${location.origin}${location.pathname}?sala=${lobby?.code || ''}`;
}

async function share(text, url) {
  try {
    if (navigator.share) { await navigator.share({ title: 'Papois vs Macacos', text, url }); return; }
  } catch { return; }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('¡Link copiado! Pégalo en WhatsApp');
  } catch {
    toast(url);
  }
}

// ------------------------------------------------------------ despacho de mensajes
function dispatch(m, source) {
  if (game && game.running && game.conn === source) game.onMessage(m);
  switch (m.t) {
    case 'lobby':
      if (source === local) {
        // el modo bots inicia directo; ignorar lobby
        return;
      }
      lobby = m;
      if (current === 'online' || current === 'lobby' || (current === 'menu' && pendingJoin)) {
        pendingJoin = null;
        if (current !== 'lobby') show('lobby');
        renderLobby();
      }
      break;
    case 'start':
      startGame(m, source);
      break;
    case 'error':
      if (!(game && game.running)) toast(m.msg, true);
      break;
    default:
      break;
  }
}

function startGame(start, source) {
  if (game && game.running) {
    // reconexión a mitad de partida (roster actualizado)
    if (game.conn === source) return;
    game.destroy();
  }
  stopMenuLoop();
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('show');
  current = 'game';
  sound.unlock();
  maybeRotateHint();
  game = new Game({
    world, conn: source, start, profile, sound, toast,
    onEnd: (results, meId, team) => onGameEnd(results, meId, team, source),
    onQuit: () => {
      if (source === local) { local.close(); local = null; show('menu'); }
      else { conn.send({ t: 'leave' }); lobby = null; show('menu'); }
      setShowcase();
      game = null;
    },
  });
}

function maybeRotateHint() {
  const r = $('rotate');
  if (isTouch() && window.innerHeight > window.innerWidth && !sessionStorage.getItem('pvm_rot')) {
    r.classList.remove('hidden');
  }
}

function isTouch() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }

// ------------------------------------------------------------ resultados
function onGameEnd(results, meId, team, source) {
  game = null;
  lastResults = { results, meId, team, local: source === local };
  const xp = applyMatchXp(profile, results, meId, team);
  setShowcase();
  show('results');
  const banner = $('resBanner');
  banner.textContent = xp.draw ? '¡EMPATE!' : xp.won ? '¡VICTORIA!' : 'DERROTA';
  banner.className = 'res-banner ' + (xp.draw ? 'draw' : xp.won ? 'win' : 'lose');
  $('resScore').innerHTML = `<span class="t-papois">${results.score[0]}</span> <span class="vs">-</span> <span class="t-macacos">${results.score[1]}</span>`;
  const sorted = [...results.players].sort((a, b) => a.team - b.team || b.mvp - a.mvp);
  const mvp = [...results.players].sort((a, b) => b.mvp - a.mvp)[0];
  $('resMvp').innerHTML = mvp ? `⭐ MVP: <b>${escapeHtml(mvp.name)}</b> (${TEAMS[mvp.team].name})` : '';
  $('resTable').innerHTML = '<table><tr><th>Jugador</th><th title="Capturas">🏆</th><th title="Robos">🚩</th><th title="Atrapadas">✋</th><th title="Rescates">🔓</th><th title="Impactos">🎯</th><th title="Contagios">🦠</th></tr>' +
    sorted.map((p) => `<tr class="t${p.team} ${p.id === meId ? 'me' : ''}"><td>${p.bot ? '🤖 ' : ''}${escapeHtml(p.name)}</td><td>${p.stats.caps}</td><td>${p.stats.steals}</td><td>${p.stats.tags}</td><td>${p.stats.rescues}</td><td>${p.stats.hits}</td><td>${p.stats.infects}</td></tr>`).join('') + '</table>';
  // XP animada
  const need0 = xpForLevel(xp.before.level);
  $('resLvl').textContent = xp.before.level;
  $('resXpBar').style.transition = 'none';
  $('resXpBar').style.width = `${(xp.before.xp / need0) * 100}%`;
  $('resXpTxt').textContent = `+${xp.gained} XP`;
  $('resXpLines').innerHTML = xp.lines.map((l, i) => `<li style="animation-delay:${0.15 * i}s">${l[0]}<b>+${l[1]}</b></li>`).join('');
  $('resUnlocks').innerHTML = '';
  setTimeout(() => {
    $('resXpBar').style.transition = '';
    if (xp.after.level > xp.before.level) {
      $('resXpBar').style.width = '100%';
      setTimeout(() => {
        $('resLvl').textContent = xp.after.level;
        $('resXpBar').style.transition = 'none';
        $('resXpBar').style.width = '0%';
        sound.play('levelup');
        toast(`¡Subiste a nivel ${xp.after.level}!`);
        setTimeout(() => {
          $('resXpBar').style.transition = '';
          $('resXpBar').style.width = `${(xp.after.xp / xpForLevel(xp.after.level)) * 100}%`;
          $('resUnlocks').innerHTML = xp.unlocked.map((u) => `<div>🎁 Desbloqueaste: <b>${u}</b></div>`).join('');
        }, 60);
      }, 1300);
    } else {
      $('resXpBar').style.width = `${(xp.after.xp / xpForLevel(xp.after.level)) * 100}%`;
    }
  }, 400);
  $('resAgain').textContent = lastResults.local ? 'Jugar otra vez' : 'Volver a la sala';
  $('resShare').onclick = () => {
    const me = results.players.find((p) => p.id === meId);
    const txt = xp.won
      ? `¡Gané ${results.score[team]}-${results.score[1 - team]} con los ${TEAMS[team].name} en Papois vs Macacos! ${me?.stats.caps ? `Hice ${me.stats.caps} capturas 🚩.` : ''} ¿Te atreves?`
      : `Jugué Papois vs Macacos con los ${TEAMS[team].name}. ¡Ven a jugar conmigo!`;
    const url = !lastResults.local && lobby ? inviteLink() : location.origin + location.pathname;
    share(txt, url);
  };
}

// ------------------------------------------------------------ eventos de la UI
function bindUi() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    sound.unlock();
    sound.play('click');
    const dest = go.dataset.go;
    if ((dest === 'bots' || dest === 'online') && !profile.name) {
      const v = $('nameInput').value.trim();
      if (v) { profile.name = v.slice(0, 14); saveProfile(profile); }
    }
    show(dest);
    if (profile.prefs.music) sound.startMusic();
  });
  $('nameInput').addEventListener('change', () => {
    profile.name = $('nameInput').value.trim().slice(0, 14);
    saveProfile(profile);
    refreshMenu();
    syncProfileOnline();
  });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('botsStart').onclick = () => { sound.play('click'); startBots(); };
  $('btnCreate').onclick = () => { sound.play('click'); createRoom(); };
  $('btnJoin').onclick = () => { sound.play('click'); joinRoom($('codeInput').value); };
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
  $('btnQuick').onclick = () => { sound.play('click'); sound.unlock(); ensureConn().send({ t: 'quick' }); };
  $('lobbyLeave').onclick = () => { sound.play('click'); conn?.send({ t: 'leave' }); lobby = null; show('online'); };
  $('lobbyStart').onclick = () => { sound.play('click'); if (isTouch()) fullscreen(); conn?.send({ t: 'start' }); };
  $('btnShare').onclick = () => share(`¡Únete a mi sala de Papois vs Macacos! Código: ${lobby?.code}`, inviteLink());
  for (const b of document.querySelectorAll('[data-join-team]')) {
    b.onclick = () => { sound.play('click'); conn?.send({ t: 'team', team: +b.dataset.joinTeam }); };
  }
  $('resAgain').onclick = () => {
    sound.play('click');
    if (lastResults?.local) startBots();
    else if (lobby) { show('lobby'); renderLobby(); }
    else show('menu');
  };
  $('resMenu').onclick = () => {
    sound.play('click');
    if (!lastResults?.local && conn) { conn.send({ t: 'leave' }); lobby = null; }
    if (local) { local.close(); local = null; }
    show('menu');
  };
  $('btnFullscreen').onclick = () => fullscreen();
  $('rotateOk').onclick = () => { $('rotate').classList.add('hidden'); sessionStorage.setItem('pvm_rot', '1'); };
  window.addEventListener('resize', () => {
    world?.resize();
    if (window.innerWidth > window.innerHeight) $('rotate').classList.add('hidden');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sound.stopMusic();
    else if (profile.prefs.music && sound.ctx) sound.startMusic();
  });
  // desbloquear audio al primer toque
  window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
}

// ------------------------------------------------------------ arranque
async function boot() {
  const fill = $('bootFill');
  const msg = $('bootMsg');
  const step = (p, t) => { fill.style.width = p + '%'; msg.textContent = t; return new Promise((r) => setTimeout(r, 30)); };
  await step(15, 'Preparando el laboratorio…');
  await step(35, 'Plantando la selva…');
  try {
    world = new World($('game'), profile.prefs.quality);
  } catch (e) {
    console.error(e);
    msg.textContent = 'Tu navegador no soporta WebGL. Prueba con Chrome o Safari actualizados.';
    return;
  }
  window.__pvm = { get world() { return world; }, get game() { return game; } };
  await step(75, 'Despertando a los Papois y Macacos…');
  setShowcase();
  world.update(0.016, { focus: { x: 32, y: 18 }, orbit: { angle: 0, dist: 8, height: 4 }, players: [], flags: [{ state: 0 }, { state: 0 }], myBush: -1 });
  world.render();
  await step(100, '¡Listo!');
  bindUi();
  const params = new URLSearchParams(location.search);
  const sala = params.get('sala');
  if (window.PVM_STANDALONE) document.body.classList.add('standalone');
  show('menu');
  if (sala && onlineAvailable()) {
    pendingJoin = sala;
    $('codeInput').value = sala.toUpperCase();
    toast(`Te invitaron a la sala ${sala.toUpperCase()}. Escribe tu nombre y toca “Jugar con amigos”.`);
    if (profile.name) { show('online'); joinRoom(sala); }
  }
  // registrar service worker (offline + instalar app)
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.PVM_STANDALONE) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
