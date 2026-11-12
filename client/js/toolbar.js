// Barra de ferramentas ligada a um DrawingBoard

import { TOOLS } from './drawing.js';

const PALETTE = [
  '#000000', '#374151', '#6b7280', '#d1d5db', '#ffffff',
  '#7f1d1d', '#dc2626', '#f87171', '#fecaca', '#9a3412',
  '#f97316', '#fdba74', '#a16207', '#facc15', '#fef08a',
  '#14532d', '#16a34a', '#86efac', '#164e63', '#06b6d4',
  '#1e3a8a', '#2563eb', '#93c5fd', '#581c87', '#a855f7',
  '#d8b4fe', '#9d174d', '#ec4899', '#78350f', '#d6a77a',
];

export function createToolbar(board, root) {
  root.innerHTML = `
    <div class="tb-section tb-tools">
      ${Object.entries(TOOLS)
        .map(([id, t]) => `<button class="tool-btn" data-tool="${id}" title="${t.label} (${t.key.toUpperCase()})"><span class="tool-ico">${t.icon}</span><span class="tool-name">${t.label}</span></button>`)
        .join('')}
    </div>
    <div class="tb-section tb-colors">
      <div class="color-pair">
        <label class="color-well primary" title="Cor principal"><input type="color" data-color="1"></label>
        <button class="swap-btn" title="Trocar cores (X)">⇄</button>
        <label class="color-well secondary" title="Cor secundária (gradiente)"><input type="color" data-color="2"></label>
      </div>
      <div class="palette">${PALETTE.map((c) => `<button class="swatch" style="background:${c}" data-swatch="${c}" title="${c}"></button>`).join('')}</div>
      <p class="hint">Clique: cor principal · Botão direito: secundária</p>
    </div>
    <div class="tb-section tb-sliders">
      <label class="slider" data-for="size">Tamanho <output></output><input type="range" min="1" max="120" data-slider="size"></label>
      <label class="slider" data-for="opacity">Opacidade <output></output><input type="range" min="5" max="100" data-slider="opacity"></label>
      <label class="slider" data-for="tolerance">Tolerância <output></output><input type="range" min="0" max="160" data-slider="tolerance"></label>
      <div class="opt" data-for="gradient">
        <select data-opt="gradientType"><option value="linear">Linear</option><option value="radial">Radial</option></select>
        <select data-opt="gradientMode"><option value="region">Área clicada</option><option value="canvas">Tela toda</option></select>
      </div>
    </div>
    <div class="tb-section tb-history">
      <button data-act="undo" title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
      <button data-act="redo" title="Refazer (Ctrl+Y)">↷ Refazer</button>
      <button data-act="clear" class="danger" title="Limpar tela">🗑 Limpar</button>
    </div>
  `;

  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const c1 = $('[data-color="1"]');
  const c2 = $('[data-color="2"]');

  $$('.tool-btn').forEach((b) => b.addEventListener('click', () => board.setTool(b.dataset.tool)));
  c1.addEventListener('input', () => board.setColor(c1.value));
  c2.addEventListener('input', () => board.setColor2(c2.value));
  $('.swap-btn').addEventListener('click', () => board.swapColors());
  $$('.swatch').forEach((s) => {
    s.addEventListener('click', () => board.setColor(s.dataset.swatch));
    s.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      board.setColor2(s.dataset.swatch);
    });
  });

  const sizeIn = $('[data-slider="size"]');
  const opIn = $('[data-slider="opacity"]');
  const tolIn = $('[data-slider="tolerance"]');
  sizeIn.addEventListener('input', () => (board.size = +sizeIn.value));
  opIn.addEventListener('input', () => (board.opacity = +opIn.value / 100));
  tolIn.addEventListener('input', () => {
    board.tolerance = +tolIn.value;
    sync();
  });
  $$('[data-opt]').forEach((s) => s.addEventListener('change', () => (board[s.dataset.opt] = s.value)));

  $('[data-act="undo"]').addEventListener('click', () => board.undo());
  $('[data-act="redo"]').addEventListener('click', () => board.redo());
  $('[data-act="clear"]').addEventListener('click', () => board.clear());

  function sync() {
    const t = board.tool;
    const def = TOOLS[t];
    $$('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    c1.value = board.color;
    c2.value = board.color2;
    $('.color-well.primary').style.background = board.color;
    $('.color-well.secondary').style.background = board.color2;

    const showSize = def.size > 0;
    $('[data-for="size"]').hidden = !showSize;
    if (showSize) {
      sizeIn.max = def.max;
      sizeIn.value = board.size;
      $('[data-for="size"] output').textContent = `${board.size}px`;
    }
    const showOpacity = t !== 'picker' && t !== 'eraser';
    $('[data-for="opacity"]').hidden = !showOpacity;
    opIn.value = Math.round(board.opacity * 100);
    $('[data-for="opacity"] output').textContent = `${Math.round(board.opacity * 100)}%`;
    $('[data-for="tolerance"]').hidden = !(t === 'bucket' || (t === 'gradient' && board.gradientMode === 'region'));
    tolIn.value = board.tolerance;
    $('[data-for="tolerance"] output').textContent = board.tolerance;
    $('[data-for="gradient"]').hidden = t !== 'gradient';
    $('[data-act="undo"]').disabled = !board.canUndo;
    $('[data-act="redo"]').disabled = !board.canRedo;
  }

  $('[data-opt="gradientMode"]').addEventListener('change', sync);
  board.on('change', sync);
  sync();

  // atalhos de teclado
  window.addEventListener('keydown', (e) => {
    if (!root.isConnected || root.closest('[hidden]') || !board.enabled) return;
    if (e.target.matches('input[type="text"], input:not([type]), textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      e.shiftKey ? board.redo() : board.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      board.redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'x') return board.swapColors();
    if (k === '[') return (board.size = Math.max(1, board.size - 2));
    if (k === ']') return (board.size = Math.min(TOOLS[board.tool].max || 100, board.size + 2));
    const tool = Object.entries(TOOLS).find(([, t]) => t.key === k);
    if (tool) board.setTool(tool[0]);
  });

  return { sync };
}
