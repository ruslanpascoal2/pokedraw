// PokéDraw — servidor multiplayer
// Salas, rodadas, coleta de desenhos, votação cega e pódio.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3456;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const MAX_POKEMON = 151;
const MAX_PLAYERS = 12;
const REVEAL_SECONDS = 5;
const COLLECT_SECONDS = 5;
const VOTE_SECONDS = 40;
const RESULTS_SECONDS = 12;
const RECONNECT_GRACE_MS = 45_000;

// ---------- HTTP (health check + arquivos estáticos do cliente) ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let filePath = path.normalize(path.join(CLIENT_DIR, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (url.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 6e6, // desenhos chegam como dataURL
});

// ---------- Estado ----------

/** @type {Map<string, Room>} */
const rooms = new Map();

const AVATAR_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#64748b', '#84cc16', '#06b6d4', '#f43f5e'];

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeName(name) {
  return String(name || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Treinador';
}

class Room {
  constructor(code) {
    this.code = code;
    this.hostToken = null;
    /** @type {Map<string, {token,name,color,score,connected,socketId,removeTimer,joinedRound}>} */
    this.players = new Map();
    this.settings = { rounds: 3, drawTime: 90 };
    this.phase = 'lobby';
    this.round = 0;
    this.pokemonId = null;
    this.usedIds = new Set();
    this.entries = []; // { entryId, token, image }
    this.votes = new Map(); // voterToken -> entryId
    this.timer = null;
    this.deadline = null;
    this.durationMs = null;
    this.lastRound = null; // resultado da última rodada
  }

  get connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  publicPlayers() {
    return [...this.players.values()].map((p) => ({
      token: p.token,
      name: p.name,
      color: p.color,
      score: p.score,
      connected: p.connected,
      isHost: p.token === this.hostToken,
      submitted: this.phase === 'drawing' || this.phase === 'collecting' ? this.entries.some((e) => e.token === p.token) : undefined,
      voted: this.phase === 'voting' ? this.votes.has(p.token) : undefined,
    }));
  }

  state() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      settings: this.settings,
      players: this.publicPlayers(),
      hostToken: this.hostToken,
      // tempo relativo: evita problemas de relógio diferente entre servidor e cliente
      remainingMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      durationMs: this.durationMs,
      pokemonId: ['reveal', 'drawing', 'collecting', 'voting', 'results', 'final'].includes(this.phase) ? this.pokemonId : null,
    };
  }

  broadcast() {
    io.to(this.code).emit('room:state', this.state());
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setPhase(phase, seconds, next) {
    this.clearTimer();
    this.phase = phase;
    this.deadline = seconds ? Date.now() + seconds * 1000 : null;
    this.durationMs = seconds ? seconds * 1000 : null;
    if (seconds && next) this.timer = setTimeout(next, seconds * 1000);
  }

  pickPokemon() {
    if (this.usedIds.size >= MAX_POKEMON) this.usedIds.clear();
    let id;
    do {
      id = crypto.randomInt(1, MAX_POKEMON + 1);
    } while (this.usedIds.has(id));
    this.usedIds.add(id);
    return id;
  }

  startGame() {
    for (const p of this.players.values()) p.score = 0;
    this.round = 0;
    this.usedIds.clear();
    this.nextRound();
  }

  nextRound() {
    this.round += 1;
    this.pokemonId = this.pickPokemon();
    this.entries = [];
    this.votes = new Map();
    this.lastRound = null;
    this.setPhase('reveal', REVEAL_SECONDS, () => this.startDrawing());
    this.broadcast();
  }

  startDrawing() {
    this.setPhase('drawing', this.settings.drawTime, () => this.startCollecting());
    this.broadcast();
  }

  startCollecting() {
    // Pede para todos enviarem o desenho atual e espera alguns segundos
    this.setPhase('collecting', COLLECT_SECONDS, () => this.startVoting());
    io.to(this.code).emit('round:submitNow');
    this.broadcast();
    this.maybeFinishCollecting();
  }

  maybeFinishCollecting() {
    if (this.phase !== 'collecting') return;
    const pending = this.connectedPlayers.filter((p) => !this.entries.some((e) => e.token === p.token));
    if (pending.length === 0) this.startVoting();
  }

  submitDrawing(token, image) {
    if (!['drawing', 'collecting'].includes(this.phase)) return;
    if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > 5e6) return;
    const existing = this.entries.find((e) => e.token === token);
    if (existing) existing.image = image;
    else this.entries.push({ entryId: crypto.randomUUID().slice(0, 8), token, image });
    if (this.phase === 'drawing' && this.connectedPlayers.every((p) => this.entries.some((e) => e.token === p.token))) {
      // todos terminaram antes do tempo
      this.startCollecting();
      return;
    }
    this.broadcast();
    this.maybeFinishCollecting();
  }

  startVoting() {
    if (this.entries.length < 2) {
      // Sem desenhos suficientes para votar: vai direto para o resultado
      this.showResults();
      return;
    }
    shuffle(this.entries);
    this.setPhase('voting', VOTE_SECONDS, () => this.showResults());
    // Votação cega: só a imagem e um id aleatório. Cada jogador sabe apenas qual é o seu.
    const anonymous = this.entries.map((e) => ({ entryId: e.entryId, image: e.image }));
    for (const p of this.connectedPlayers) {
      const own = this.entries.find((e) => e.token === p.token);
      io.to(p.socketId).emit('round:voting', { entries: anonymous, ownEntryId: own ? own.entryId : null });
    }
    this.broadcast();
  }

  castVote(token, entryId) {
    if (this.phase !== 'voting') return;
    const entry = this.entries.find((e) => e.entryId === entryId);
    if (!entry || entry.token === token) return;
    this.votes.set(token, entryId);
    this.broadcast();
    const voters = this.connectedPlayers.filter((p) => {
      // quem só tem o próprio desenho para votar não precisa votar
      return this.entries.some((e) => e.token !== p.token);
    });
    if (voters.every((p) => this.votes.has(p.token))) this.showResults();
  }

  showResults() {
    const tally = new Map(this.entries.map((e) => [e.entryId, 0]));
    for (const entryId of this.votes.values()) tally.set(entryId, (tally.get(entryId) || 0) + 1);

    const ranking = this.entries
      .map((e) => {
        const p = this.players.get(e.token);
        return { entryId: e.entryId, token: e.token, name: p ? p.name : '???', color: p ? p.color : '#888', votes: tally.get(e.entryId) || 0, image: e.image };
      })
      .sort((a, b) => b.votes - a.votes);

    // posição com empates (1,1,3...)
    ranking.forEach((r, i) => {
      r.place = i > 0 && r.votes === ranking[i - 1].votes ? ranking[i - 1].place : i + 1;
    });

    for (const r of ranking) {
      const p = this.players.get(r.token);
      if (p) p.score += r.votes;
    }

    this.lastRound = { round: this.round, pokemonId: this.pokemonId, ranking };
    const isLast = this.round >= this.settings.rounds;
    this.setPhase('results', RESULTS_SECONDS, () => (isLast ? this.showFinal() : this.nextRound()));
    io.to(this.code).emit('round:results', { ...this.lastRound, isLast });
    this.broadcast();
  }

  showFinal() {
    this.setPhase('final', 0, null);
    io.to(this.code).emit('game:final', { standings: this.finalStandings() });
    this.broadcast();
  }

  finalStandings() {
    const standings = [...this.players.values()]
      .map((p) => ({ token: p.token, name: p.name, color: p.color, score: p.score }))
      .sort((a, b) => b.score - a.score);
    standings.forEach((s, i) => {
      s.place = i > 0 && s.score === standings[i - 1].score ? standings[i - 1].place : i + 1;
    });
    return standings;
  }

  backToLobby() {
    this.clearTimer();
    this.phase = 'lobby';
    this.deadline = null;
    this.round = 0;
    this.entries = [];
    this.votes = new Map();
    this.pokemonId = null;
    this.broadcast();
  }

  ensureHost() {
    const host = this.players.get(this.hostToken);
    if (host && host.connected) return;
    const next = this.connectedPlayers[0];
    if (next) this.hostToken = next.token;
  }

  removePlayer(token) {
    this.players.delete(token);
    this.votes.delete(token);
    if (this.players.size === 0) {
      this.clearTimer();
      rooms.delete(this.code);
      return;
    }
    this.ensureHost();
    if (this.phase !== 'lobby' && this.phase !== 'final' && this.connectedPlayers.length === 0) {
      this.backToLobby();
    }
    this.maybeFinishCollecting();
    this.broadcast();
  }
}

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  let current = null; // { room, token }

  function join(room, token, name) {
    let player = room.players.get(token);
    if (player) {
      // reconexão
      if (player.removeTimer) clearTimeout(player.removeTimer);
      player.removeTimer = null;
      player.connected = true;
      player.socketId = socket.id;
      player.name = name;
    } else {
      if (room.players.size >= MAX_PLAYERS) return { error: 'A sala está cheia.' };
      const used = new Set([...room.players.values()].map((p) => p.color));
      player = {
        token,
        name,
        color: AVATAR_COLORS.find((c) => !used.has(c)) || AVATAR_COLORS[room.players.size % AVATAR_COLORS.length],
        score: 0,
        connected: true,
        socketId: socket.id,
        removeTimer: null,
      };
      room.players.set(token, player);
    }
    if (!room.hostToken || !room.players.get(room.hostToken)?.connected) room.hostToken = token;
    socket.join(room.code);
    current = { room, token };
    room.broadcast();

    // Se entrou no meio da votação/resultado, manda o que precisa para acompanhar
    if (room.phase === 'voting') {
      const own = room.entries.find((e) => e.token === token);
      socket.emit('round:voting', { entries: room.entries.map((e) => ({ entryId: e.entryId, image: e.image })), ownEntryId: own ? own.entryId : null, myVote: room.votes.get(token) || null });
    } else if (room.phase === 'results' && room.lastRound) {
      socket.emit('round:results', { ...room.lastRound, isLast: room.round >= room.settings.rounds });
    } else if (room.phase === 'final') {
      socket.emit('game:final', { standings: room.finalStandings() });
    }
    return { ok: true, code: room.code, token };
  }

  socket.on('room:create', ({ name, token } = {}, ack) => {
    if (typeof ack !== 'function') return;
    leave();
    const room = new Room(makeRoomCode());
    rooms.set(room.code, room);
    ack(join(room, String(token || crypto.randomUUID()), sanitizeName(name)));
  });

  socket.on('room:join', ({ code, name, token } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return ack({ error: 'Sala não encontrada.' });
    if (current && current.room !== room) leave();
    ack(join(room, String(token || crypto.randomUUID()), sanitizeName(name)));
  });

  socket.on('room:settings', (settings = {}) => {
    if (!current) return;
    const { room, token } = current;
    if (room.hostToken !== token || room.phase !== 'lobby') return;
    room.settings = {
      rounds: clampInt(settings.rounds, 1, 10, room.settings.rounds),
      drawTime: clampInt(settings.drawTime, 30, 300, room.settings.drawTime),
    };
    room.broadcast();
  });

  socket.on('game:start', (_, ack) => {
    if (!current) return;
    const { room, token } = current;
    const reply = typeof ack === 'function' ? ack : () => {};
    if (room.hostToken !== token) return reply({ error: 'Só o anfitrião pode iniciar.' });
    if (room.phase !== 'lobby' && room.phase !== 'final') return reply({ error: 'O jogo já começou.' });
    if (room.connectedPlayers.length < 2) return reply({ error: 'São necessários pelo menos 2 jogadores.' });
    room.startGame();
    reply({ ok: true });
  });

  socket.on('game:lobby', () => {
    if (!current) return;
    const { room, token } = current;
    if (room.hostToken === token) room.backToLobby();
  });

  socket.on('round:submit', ({ image } = {}) => {
    if (!current) return;
    current.room.submitDrawing(current.token, image);
  });

  socket.on('round:vote', ({ entryId } = {}) => {
    if (!current) return;
    current.room.castVote(current.token, entryId);
  });

  socket.on('room:leave', () => leave());

  socket.on('disconnect', () => {
    if (!current) return;
    const { room, token } = current;
    const player = room.players.get(token);
    if (!player || player.socketId !== socket.id) return;
    player.connected = false;
    room.ensureHost();
    room.maybeFinishCollecting();
    room.broadcast();
    player.removeTimer = setTimeout(() => room.removePlayer(token), room.phase === 'lobby' ? 10_000 : RECONNECT_GRACE_MS);
  });

  function leave() {
    if (!current) return;
    const { room, token } = current;
    socket.leave(room.code);
    const player = room.players.get(token);
    if (player && player.removeTimer) clearTimeout(player.removeTimer);
    current = null;
    room.removePlayer(token);
  }
});

server.listen(PORT, () => {
  console.log(`PokéDraw rodando em http://localhost:${PORT}`);
});
