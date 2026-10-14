# 🍌 Papois vs Macacos — Captura la Bandera

Juego multijugador **para celular** (y PC) de *captura la bandera* en 3D: **Papois** (inspirados en los minions) contra **Macacos** (monos). Se juega en el navegador, sin instalar nada, con amigos en tiempo real o contra bots.

- 🎮 **Multijugador en tiempo real** (hasta 10 jugadores, 5 vs 5) con salas por código y link de invitación para WhatsApp.
- 🤖 **Bots con IA** que defienden, atacan, rescatan, escoltan y mutan. Rellenan los equipos si faltan amigos.
- 📱 **Controles táctiles**: joystick, disparo con apuntado automático (o manual arrastrando), habilidad y mutación.
- 🧪 **Mutación** al estilo de la película: Papoi Morado y Macaco Salvaje, con **contagio** entre aliados.
- 🌴 Gráficos 3D (Three.js) con luces, sombras, agua, partículas y personajes animados, todo generado por código (sin descargar imágenes).
- 🔊 Sonido y música sintetizados en vivo (sin archivos), vibración y voces en los mensajes rápidos.
- ⭐ Progresión: niveles, XP, gorros y pelajes desbloqueables, MVP y estadísticas.
- 📶 Modo offline contra bots (funciona sin internet una vez cargado).

---

## 📜 Reglas (basadas en el juego clásico)

Investigué las reglas tradicionales de *capture the flag* ([Wikipedia](https://en.wikipedia.org/wiki/Capture_the_flag), guías de [Scouts](https://fringe.davesource.com/Fringe/Entertainment/Games/Outdoors/Capture_The_Flag) y de [educación física](https://www.physicaleducationupdate.com/public/268.cfm)) y cómo lo adaptan los videojuegos ([Unreal Tournament](https://strategywiki.org/wiki/Unreal_Tournament_3/Capture_the_Flag), [Halo](https://earth.gamerguides.com/halo-infinite/guide/multiplayer/game-modes/how-to-play-the-capture-the-flag-game-mode)). El juego combina lo mejor de ambos:

| Regla | Cómo funciona |
|---|---|
| **Objetivo** | Robar la bandera enemiga y llevarla a tu base. Gana el primero en llegar a las capturas pedidas (3 por defecto) o quien tenga más al terminar el tiempo. |
| **Territorios** | El río divide el mapa. En **tu lado** estás a salvo y **atrapas** a los intrusos tocándolos. En el lado enemigo eres vulnerable. |
| **Jaula** | Si te atrapan vas a la jaula enemiga. Un aliado que toque la jaula **libera a todos** ("¡fuga!"). Si nadie llega, sales solo a los 8 s. |
| **Portador** | Al robar la bandera tienes 1,5 s de escudo y adrenalina. Los congelamientos solo lo frenan (hay que **tocarlo**). Si lo atrapan, la bandera cae: su equipo la puede recoger y el rival la devuelve tocándola (o vuelve sola en 12 s). |
| **Zona protegida** | Nadie puede pararse sobre su propia bandera (círculo de rayas): no se puede "acampar". |
| **Empate** | Si al final van empatados: **¡Gol de oro!** 60 s más, la próxima captura gana. |
| **Regla clásica (opcional)** | Solo puedes anotar si tu bandera está en tu base (como en Unreal/Halo). Se activa en el lobby. |

### Equipos y habilidades

| | **Papois** 🟡 | **Macacos** 🟢 |
|---|---|---|
| Ataque | **Rayo Congelador**: congela 1 s (largo alcance) | **Coco Bomba**: aturde y empuja (recarga más rápida) |
| Habilidad | **Pistola de Pedos**: nube que empuja, frena a los enemigos y te propulsa | **Salto de Liana**: salto esquivando ataques; deja una **cáscara de plátano** que hace resbalar |
| Pasiva | **Fuerza en grupo**: +6 % de velocidad por cada aliado cerca | **Ágiles**: nadan mucho más rápido en el río |
| Mutación | **Papoi Morado** (Suero PX-41) | **Macaco Salvaje** (Virus Simio) |

### ☣️ Mutación e infección
- La barra se carga jugando (atrapar, rescatar, acertar, llevar la bandera) y tomando **Sueros** que aparecen en los puentes.
- Al mutar: más grande, más rápido, **inmune**, y derribas a quien toques. En tu territorio (o si es el portador) lo mandas a la jaula.
- **Contagio**: si tocas a un aliado, también muta. ¡Hordas moradas o salvajes!
- Los mutantes **no pueden llevar la bandera** → hay que coordinar: unos despejan, otro roba.
- **¡Brote!**: en el último minuto todos reciben carga de mutación y aparecen más sueros.

### Controles
- **Celular**: joystick a la izquierda (aparece donde tocas). Botón grande = atacar (toca para **apuntado automático**, arrastra para apuntar tú). Botón verde/amarillo = habilidad. ☣️ = mutar. 💬 = mensajes rápidos.
- **PC**: `WASD`/flechas, clic o `Espacio` para disparar hacia el mouse, `Shift` habilidad, `Q` mutar, `1-8` mensajes.

---

## 🚀 Cómo jugarlo

### 1) En tu computador (y con amigos en la misma WiFi)
Requiere [Node.js 18+](https://nodejs.org).

```bash
npm install
npm start
```

Abre `http://localhost:3000`. En la consola aparece la dirección de tu red (por ejemplo `http://192.168.1.20:3000`): tus amigos la abren en su celular, conectados a la misma WiFi, y entran a tu sala.

### 2) Publicarlo en internet gratis (Render)
1. Sube este repositorio a GitHub (ya está).
2. Entra a [render.com](https://render.com) → **New → Blueprint** → elige este repo. Render lee `render.yaml` y crea el servicio.
3. En 2-3 minutos tendrás una URL tipo `https://papois-vs-macacos.onrender.com`. ¡Compártela!

> El plan gratis de Render "duerme" el servidor tras 15 min sin uso; la primera visita tarda ~50 s en despertar. Para eventos o muchos jugadores conviene el plan pagado (≈7 USD/mes) o un VPS.
> También hay un `Dockerfile` para Railway, Fly.io o cualquier VPS. **Vercel/Netlify no sirven** para el multijugador porque no mantienen conexiones WebSocket.

### 3) En la nube de Claude (sin servidor propio)
El juego también está publicado como página de Claude (Artifact). Ahí se juega contra bots y **con amigos**:
- Quien toca **Crear sala** es el anfitrión: su navegador corre el motor del juego y lo transmite por la capacidad `room` de Claude. Debe mantener el juego abierto en pantalla.
- Los demás entran desde **Jugar con amigos** (aparece la lista de salas abiertas) o escribiendo el código.
- Solo pueden unirse personas con acceso a la página en Claude: compártela desde el botón **Compartir** de Claude. Un link público sirve para jugar contra bots, pero no para entrar a salas.

Para regenerar esa versión: `npm run cloud` (crea `dist/cloud/index.html` + `dist/cloud/game.js`).

### 4) Versión de un solo archivo (solo bots, sin servidor)
```bash
npm run standalone   # genera dist/papois-vs-macacos.html
```

---

## 🧱 Cómo está hecho

```
shared/      Lógica compartida (corre igual en servidor y navegador)
  constants.js   Balance: velocidades, armas, mutación, reglas  ← ajusta aquí
  map.js         Mapa simétrico, colisiones, río, arbustos
  sim.js         Motor autoritativo a 30 Hz (reglas, combate, banderas, jaula)
  nav.js         Navegación A* para bots
  bots.js        IA: roles, rescates, intercepción, escolta, habilidades
  room.js        Sala: lobby, inicio, unión a mitad de partida, snapshots
server/index.js  Servidor HTTP + WebSocket (salas por código, partida rápida)
client/cloud.js  Multijugador en la nube de Claude (anfitrión + invitados vía `room`)
client/          Navegador
  main.js        Menús, salas, resultados, progresión
  game.js        Predicción del jugador local + interpolación + eventos
  input.js       Joystick y botones táctiles, teclado y mouse
  hud.js         Marcador, minimapa, etiquetas, avisos
  audio.js       Sonidos y música sintetizados (WebAudio)
  render/        Three.js: personajes, escenario, efectos, cámara
tools/           build (esbuild), simulación de prueba, simulador de `room` para pruebas
```

- **Servidor autoritativo**: el servidor decide todo (evita trampas y desincronización). El cliente **predice** tu movimiento para que responda al instante aunque haya lag, y **interpola** a los demás.
- **Modo bots offline**: la misma sala corre dentro del navegador, sin servidor.
- **Pruebas**: `npm test` juega partidas completas solo con bots y verifica que haya capturas y atrapadas. Lo usé para equilibrar el juego (por ejemplo, la mutación al principio causaba el 80 % de las atrapadas y los Macacos ganaban 3 de cada 4).

---

## 💡 Ideas para seguir
- Más mapas (fábrica de bananas, volcán) y modos (todos contra todos, "infección" donde los atrapados se convierten).
- Ranking semanal y logros compartibles (útil para crecer por redes sociales).
- Chat de voz con WebRTC entre compañeros de equipo.
- Analítica (Amplitude/GA4): duración de partidas, abandono, qué equipo gana más → para ajustar el balance con datos reales.

## ⚖️ Nota legal
Los Minions, Gru y el Suero PX-41 pertenecen a Illumination/Universal. Este es un proyecto de fans sin fines comerciales: los personajes son diseños propios "inspirados" y los nombres son genéricos. **Si quieres monetizarlo o publicarlo en tiendas**, cambia la apariencia (overoles, gafas) y las referencias para evitar problemas de propiedad intelectual.
