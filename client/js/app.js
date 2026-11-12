import { DrawingBoard } from './drawing.js';
import { createToolbar } from './toolbar.js';
import { artworkUrl, pokemonName, loadNames, randomPokemonId, preload } from './pokemon.js';
import { SERVER_URL } from './config.js';
import { burst } from './confetti.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Estado global ----------

const board = new DrawingBoard($('board'));
createToolbar(board, $('toolbar'));
loadNames();

function storage(kind, key, fallback) {
  try {
    return window[kind].getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(kind, key, value) {
  try {
    window[kind].setItem(key, value);
  } catch {}
}

let token = storage('sessionStorage', 'pokedraw.token', null);
if (!token) {
  token = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  store('sessionStorage', 'pokedraw.token', token);
}

let mode = null; // 'multi' | 'training'
let socket = null;
let room = null; // último room:state
let roundKey = null;
let submitted = false;
let voting = null; // { entries, ownEntryId }
let myVote = null;
let results = null;
let finalData = null;
let deadline = null;
let duration = null;

// ---------- Utilidades de UI ----------

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `screen-${name}`));
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function banner(msg) {
  const b = $('conn-banner');
  b.hidden = !msg;
  if (msg) b.textContent = msg;
}

function overlay(html) {
  const o = $('board-overlay');
  o.hidden = !html;
  if (html) o.innerHTML = html;
}

function renderTimer(el, left, total) {
  const secs = Math.ceil(left / 1000);
  el.querySelector('.timer-num').textContent = left == null ? '∞' : secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : secs;
  el.querySelector('.timer-bar i').style.width = left == null || !total ? '100%' : `${Math.max(0, (left / total) * 100)}%`;
  el.classList.toggle('warn', left != null && secs <= 10);
}

function setRefImages(id, revealed = false) {
  const url = artworkUrl(id);
  for (const img of [$('reveal-img'), $('draw-ref'), $('vote-ref')]) {
    img.src = url;
  }
  $('draw-ref').classList.toggle('silhouette', !revealed);
}

function playerLi(p, opts = {}) {
  const tags = [];
  if (p.isHost) tags.push('<span title="Anfitrião">👑</span>');
  if (p.token === token) tags.push('<span class="you">você</span>');
  let status = '';
  if (opts.status && p.submitted !== undefined) status = p.submitted ? '<span class="ok">✓ pronto</span>' : '<span class="muted">desenhando…</span>';
  if (opts.status && p.voted !== undefined) status = p.voted ? '<span class="ok">✓ votou</span>' : '<span class="muted">votando…</span>';
  return `<li class="${p.connected ? '' : 'offline'}">
    <span class="avatar" style="background:${p.color}">${esc(p.name.charAt(0).toUpperCase())}</span>
    <span class="pname">${esc(p.name)} ${tags.join(' ')}</span>
    ${opts.score ? `<span class="score">${p.score} ⭐</span>` : ''}
    ${status}
  </li>`;
}

// ---------- Início ----------

const params = new URLSearchParams(location.search);
$('home-name').value = storage('localStorage', 'pokedraw.name', '');
if (params.get('room')) $('home-code').value = params.get('room').toUpperCase();

function myName() {
  let name = $('home-name').value.trim();
  if (!name) {
    name = `Treinador${Math.floor(Math.random() * 900 + 100)}`;
    $('home-name').value = name;
  }
  store('localStorage', 'pokedraw.name', name);
  return name;
}

$('home-code').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')));
$('home-code').addEventListener('keydown', (e) => e.key === 'Enter' && $('btn-join').click());

$('btn-create').addEventListener('click', async () => {
  const name = myName();
  await connect();
  enterRoom();
  socket.emit('room:create', { name, token }, (res) => {
    if (res?.error) return failRoom(res.error);
    history.replaceState(null, '', `${location.pathname}?room=${res.code}`);
  });
});

$('btn-join').addEventListener('click', async () => {
  const code = $('home-code').value.trim();
  if (code.length !== 4) return toast('Digite o código de 4 letras da sala.');
  const name = myName();
  await connect();
  enterRoom();
  socket.emit('room:join', { code, name, token }, (res) => {
    if (res?.error) return failRoom(res.error);
    history.replaceState(null, '', `${location.pathname}?room=${res.code}`);
  });
});

// o servidor manda o room:state antes do ack, então o modo precisa estar ativo antes de emitir
function enterRoom() {
  mode = 'multi';
  document.body.className = 'mode-multi';
}

function failRoom(msg) {
  mode = null;
  document.body.className = '';
  toast(msg);
}

function leaveRoom() {
  socket?.emit('room:leave');
  room = null;
  mode = null;
  roundKey = null;
  deadline = null;
  document.body.className = '';
  history.replaceState(null, '', location.pathname);
  show('home');
}

// ---------- Conexão ----------

function connect() {
  if (socket?.connected) return Promise.resolve();
  if (!socket) {
    if (typeof io === 'undefined') {
      toast('Não foi possível carregar o Socket.IO. Verifique sua conexão.');
      return new Promise(() => {});
    }
    socket = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    socket.on('connect', () => {
      banner(null);
      // reconexão: volta para a mesma sala com o mesmo token (mantém pontos)
      if (room && mode === 'multi') {
        socket.emit('room:join', { code: room.code, name: myName(), token }, (res) => {
          if (res?.error) {
            toast('A sala não existe mais.');
            leaveRoom();
          }
        });
      }
    });
    socket.on('disconnect', () => mode === 'multi' && banner('Conexão perdida. Reconectando…'));
    socket.on('connect_error', () => banner('Conectando ao servidor… (o servidor gratuito pode levar até 1 minuto para acordar)'));
    socket.on('room:state', onState);
    socket.on('round:voting', onVoting);
    socket.on('round:results', onResults);
    socket.on('game:final', onFinal);
    socket.on('round:submitNow', () => submitDrawing());
  }
  const slow = setTimeout(() => !socket.connected && banner('Conectando ao servidor… (o servidor gratuito pode levar até 1 minuto para acordar)'), 1500);
  return new Promise((resolve) => {
    socket.once('connect', () => {
      clearTimeout(slow);
      banner(null);
      resolve();
    });
  });
}

// ---------- Estado da sala ----------

function onState(state) {
  if (mode !== 'multi') return;
  room = state;
  deadline = state.remainingMs != null ? Date.now() + state.remainingMs : null;
  duration = state.durationMs;

  const key = state.pokemonId ? `${state.round}-${state.pokemonId}` : null;
  if (key && key !== roundKey) {
    roundKey = key;
    newRound(state.pokemonId);
  }

  renderPlayers();

  switch (state.phase) {
    case 'lobby':
      roundKey = null;
      renderLobby();
      show('lobby');
      break;
    case 'reveal':
      $('reveal-round').textContent = `Rodada ${state.round} de ${state.settings.rounds}`;
      show('reveal');
      break;
    case 'drawing':
      $('draw-label').textContent = `Rodada ${state.round} de ${state.settings.rounds}`;
      board.setEnabled(!submitted);
      if (!submitted) overlay(null);
      show('draw');
      break;
    case 'collecting':
      if (!submitted) submitDrawing();
      overlay('<div class="ov-box"><div class="spinner"></div><p>Tempo esgotado! Recolhendo os desenhos…</p></div>');
      show('draw');
      break;
    case 'voting':
      renderVote();
      show('vote');
      break;
    case 'results':
      if (results) show('results');
      break;
    case 'final':
      renderFinalButtons();
      if (finalData) show('final');
      break;
  }
}

function newRound(id) {
  board.reset();
  board.setEnabled(true);
  board.setGuide(null);
  overlay(null);
  submitted = false;
  voting = null;
  myVote = null;
  results = null;
  finalData = null;
  setRefImages(id);
  $('draw-title').textContent = 'Quem é esse Pokémon?';
  renderMultiActions();
  preload(id);
}

function renderPlayers() {
  if (!room) return;
  $('draw-players').innerHTML = room.players.map((p) => playerLi(p, { status: true, score: true })).join('');
}

function isHost() {
  return room && room.hostToken === token;
}

// ---------- Lobby ----------

function renderLobby() {
  $('lobby-code').textContent = room.code;
  const online = room.players.filter((p) => p.connected).length;
  $('lobby-count').textContent = `${online}/12`;
  $('lobby-players').innerHTML = room.players.map((p) => playerLi(p)).join('');
  $('set-rounds').value = room.settings.rounds;
  $('set-time').value = room.settings.drawTime;
  $('set-rounds').disabled = $('set-time').disabled = !isHost();
  $('btn-start').hidden = !isHost();
  $('btn-start').disabled = online < 2;
  $('lobby-host-note').textContent = isHost()
    ? online < 2
      ? 'Convide pelo menos mais 1 treinador para começar.'
      : 'Tudo pronto! Você é o anfitrião.'
    : 'Aguardando o anfitrião começar a partida…';
}

function sendSettings() {
  socket.emit('room:settings', { rounds: $('set-rounds').value, drawTime: $('set-time').value });
}
$('set-rounds').addEventListener('change', sendSettings);
$('set-time').addEventListener('change', sendSettings);

$('btn-start').addEventListener('click', () => {
  socket.emit('game:start', null, (res) => res?.error && toast(res.error));
});
$('btn-leave').addEventListener('click', leaveRoom);
$('btn-copy-link').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link de convite copiado!');
  } catch {
    prompt('Copie o link:', link);
  }
});

// ---------- Desenho (multiplayer) ----------

function renderMultiActions() {
  $('draw-actions').innerHTML = `<button id="btn-done" class="btn btn-primary">✅ Pronto!</button>`;
  $('btn-done').addEventListener('click', () => {
    if (confirm('Enviar seu desenho agora? Você não poderá mais editá-lo.')) submitDrawing();
  });
}

function submitDrawing() {
  if (submitted || mode !== 'multi' || !room) return;
  if (!['drawing', 'collecting'].includes(room.phase)) return;
  submitted = true;
  board.setEnabled(false);
  socket.emit('round:submit', { image: board.toDataURL('image/jpeg', 0.82) });
  overlay('<div class="ov-box"><p class="big">🎨 Desenho enviado!</p><p>Aguardando os outros treinadores…</p></div>');
  const btn = $('btn-done');
  if (btn) btn.disabled = true;
}

// ---------- Votação ----------

function onVoting(data) {
  voting = data;
  myVote = data.myVote || null;
  renderVote();
}

function renderVote() {
  if (!room) return;
  const voters = room.players.filter((p) => p.connected);
  const done = room.players.filter((p) => p.voted).length;
  $('vote-status').textContent = `${done}/${voters.length} votaram`;
  if (!voting) {
    $('vote-grid').innerHTML = '<p class="muted center">Carregando desenhos…</p>';
    return;
  }
  $('vote-grid').innerHTML = voting.entries
    .map((e, i) => {
      const own = e.entryId === voting.ownEntryId;
      const chosen = e.entryId === myVote;
      return `<button class="vote-card ${own ? 'own' : ''} ${chosen ? 'chosen' : ''}" data-entry="${e.entryId}" ${own ? 'disabled' : ''}>
        <img src="${e.image}" alt="Desenho ${i + 1}" />
        <span class="vote-label">${own ? 'Seu desenho' : chosen ? '⭐ Seu voto' : `Desenho #${i + 1}`}</span>
      </button>`;
    })
    .join('');
  $('vote-grid')
    .querySelectorAll('.vote-card:not(.own)')
    .forEach((c) =>
      c.addEventListener('click', () => {
        myVote = c.dataset.entry;
        socket.emit('round:vote', { entryId: myVote });
        renderVote();
      }),
    );
}

// ---------- Resultado da rodada ----------

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function podiumHtml(items, { image, value }) {
  // ordem visual: 2º, 1º, 3º
  const order = [items[1], items[0], items[2]];
  const heights = ['second', 'first', 'third'];
  return order
    .map((it, i) => {
      if (!it) return `<div class="podium-col empty ${heights[i]}"></div>`;
      return `<div class="podium-col ${heights[i]} p${Math.min(it.place, 3)}">
        ${image ? `<img class="podium-img" src="${image(it)}" alt="" />` : `<span class="avatar big" style="background:${it.color}">${esc(it.name.charAt(0).toUpperCase())}</span>`}
        <p class="podium-name"><span class="dot" style="background:${it.color}"></span>${esc(it.name)}</p>
        <p class="podium-value">${value(it)}</p>
        <div class="podium-block"><span>${MEDALS[it.place] || it.place + 'º'}</span></div>
      </div>`;
    })
    .join('');
}

async function onResults(data) {
  if (mode !== 'multi') return;
  results = data;
  $('results-art').src = artworkUrl(data.pokemonId);
  $('results-name').textContent = '...';
  $('results-round').textContent = `Rodada ${data.round}${room ? ` de ${room.settings.rounds}` : ''}`;
  const r = data.ranking;
  const votes = (it) => `${it.votes} voto${it.votes === 1 ? '' : 's'}`;
  if (!r.length) {
    $('results-podium').innerHTML = '<p class="muted center">Ninguém enviou desenho nesta rodada 😅</p>';
    $('results-rest').innerHTML = '';
  } else {
    $('results-podium').innerHTML = podiumHtml(r.slice(0, 3), { image: (it) => it.image, value: votes });
    $('results-rest').innerHTML = r
      .slice(3)
      .map((it) => `<figure><img src="${it.image}" alt="" /><figcaption>${it.place}º · ${esc(it.name)} · ${votes(it)}</figcaption></figure>`)
      .join('');
  }
  show('results');
  burst();
  $('results-name').textContent = await pokemonName(data.pokemonId);
}

// ---------- Pódio final ----------

function onFinal(data) {
  if (mode !== 'multi') return;
  finalData = data;
  const s = data.standings;
  const pts = (it) => `${it.score} ⭐`;
  $('final-podium').innerHTML = podiumHtml(s.slice(0, 3), { value: pts });
  $('final-rest').innerHTML = s
    .slice(3)
    .map((it) => `<li><span>${it.place}º</span> <span class="dot" style="background:${it.color}"></span> ${esc(it.name)} <b>${pts(it)}</b></li>`)
    .join('');
  renderFinalButtons();
  show('final');
  burst(240);
}

function renderFinalButtons() {
  const host = isHost();
  $('btn-final-again').hidden = !host;
  $('btn-final-lobby').textContent = host ? 'Voltar ao lobby' : 'Sair da sala';
  $('final-note').textContent = host ? '' : 'Aguardando o anfitrião decidir a próxima partida…';
}

$('btn-final-again').addEventListener('click', () => socket.emit('game:start', null, (res) => res?.error && toast(res.error)));
$('btn-final-lobby').addEventListener('click', () => (isHost() ? socket.emit('game:lobby') : leaveRoom()));

// ---------- Modo treino ----------

const training = { id: null, revealed: false, guide: false, seconds: 0, deadline: null };

function renderTrainingActions() {
  $('draw-actions').innerHTML = `
    <select id="tr-time" title="Tempo">
      <option value="0">⏱ Sem tempo</option><option value="60">1 min</option><option value="90">1:30</option>
      <option value="120">2 min</option><option value="180">3 min</option><option value="300">5 min</option>
    </select>
    <button id="tr-guide" class="btn btn-small btn-ghost" title="Mostra a silhueta transparente sobre a tela">📐 Guia</button>
    <button id="tr-reveal" class="btn btn-small btn-secondary">👁 Revelar</button>
    <button id="tr-next" class="btn btn-small btn-primary">🔀 Novo Pokémon</button>
    <button id="tr-save" class="btn btn-small btn-ghost">💾 Salvar</button>
    <button id="tr-exit" class="btn btn-small btn-ghost">🏠 Sair</button>`;
  $('tr-time').value = training.seconds;
  $('tr-time').addEventListener('change', (e) => {
    training.seconds = +e.target.value;
    startTrainingTimer();
  });
  $('tr-guide').addEventListener('click', () => {
    training.guide = !training.guide;
    $('tr-guide').classList.toggle('active', training.guide);
    board.setGuide(training.guide ? artworkUrl(training.id) : null);
  });
  $('tr-reveal').addEventListener('click', revealTraining);
  $('tr-next').addEventListener('click', () => {
    if (board.canUndo && !confirm('Começar outro Pokémon? O desenho atual será perdido (salve antes se quiser).')) return;
    nextTraining();
  });
  $('tr-save').addEventListener('click', async () => {
    const a = document.createElement('a');
    a.href = board.toDataURL('image/png');
    a.download = `pokedraw-${training.revealed ? (await pokemonName(training.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-') : training.id}.png`;
    a.click();
  });
  $('tr-exit').addEventListener('click', () => {
    mode = null;
    training.deadline = null;
    document.body.className = '';
    board.setGuide(null);
    show('home');
  });
}

async function revealTraining() {
  training.revealed = true;
  $('draw-ref').classList.remove('silhouette');
  $('draw-title').textContent = `É o ${await pokemonName(training.id)}!`;
}

function startTrainingTimer() {
  training.deadline = training.seconds ? Date.now() + training.seconds * 1000 : null;
  board.setEnabled(true);
  overlay(null);
}

function nextTraining() {
  training.id = randomPokemonId(training.id);
  training.revealed = false;
  board.reset();
  setRefImages(training.id);
  $('draw-title').textContent = 'Quem é esse Pokémon?';
  board.setGuide(training.guide ? artworkUrl(training.id) : null);
  preload(randomPokemonId());
  startTrainingTimer();
}

function trainingTimeUp() {
  training.deadline = null;
  board.setEnabled(false);
  overlay(`<div class="ov-box"><p class="big">⏰ Tempo esgotado!</p>
    <div class="ov-actions">
      <button class="btn btn-small btn-ghost" data-ov="more">Continuar desenhando</button>
      <button class="btn btn-small btn-secondary" data-ov="reveal">Revelar</button>
      <button class="btn btn-small btn-primary" data-ov="next">Novo Pokémon</button>
    </div></div>`);
  const o = $('board-overlay');
  o.querySelector('[data-ov="more"]').onclick = () => {
    board.setEnabled(true);
    overlay(null);
  };
  o.querySelector('[data-ov="reveal"]').onclick = () => {
    revealTraining();
    board.setEnabled(true);
    overlay(null);
  };
  o.querySelector('[data-ov="next"]').onclick = nextTraining;
}

$('btn-training').addEventListener('click', () => {
  mode = 'training';
  document.body.className = 'mode-training';
  $('draw-label').textContent = 'Modo treino';
  renderTrainingActions();
  show('draw');
  nextTraining();
});

// ---------- Relógio ----------

let lastMode = null;
setInterval(() => {
  if (mode === 'multi' && lastMode !== 'multi') renderMultiActions();
  lastMode = mode;

  if (mode === 'training') {
    const left = training.deadline ? Math.max(0, training.deadline - Date.now()) : null;
    renderTimer($('draw-timer'), left, training.seconds * 1000);
    if (left === 0) trainingTimeUp();
    return;
  }
  if (mode !== 'multi' || !room) return;
  const left = deadline ? Math.max(0, deadline - Date.now()) : 0;
  const secs = Math.ceil(left / 1000);
  if (room.phase === 'drawing' || room.phase === 'collecting') renderTimer($('draw-timer'), left, duration);
  if (room.phase === 'voting') renderTimer($('vote-timer'), left, duration);
  if (room.phase === 'reveal') $('reveal-count').textContent = secs;
  if (room.phase === 'results' && results) $('results-next').textContent = results.isLast ? `Pódio final em ${secs}s…` : `Próxima rodada em ${secs}s…`;
}, 200);

// Se veio por link de convite, foca no nome
if (params.get('room')) $('home-name').focus();
show('home');
