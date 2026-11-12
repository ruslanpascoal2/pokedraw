// Motor de desenho do PokéDraw
// Ferramentas: lápis, pincel duro, pincel suave, aquarela, óleo, borracha, balde, gradiente e conta-gotas.

const TAU = Math.PI * 2;

export const TOOLS = {
  pencil: { label: 'Lápis', icon: '✏️', key: 'p', size: 3, opacity: 0.9, spacing: 0.2, max: 20 },
  hard: { label: 'Pincel duro', icon: '🖌️', key: 'b', size: 12, opacity: 1, spacing: 0.08, max: 120 },
  soft: { label: 'Pincel suave', icon: '☁️', key: 's', size: 36, opacity: 0.6, spacing: 0.1, max: 200 },
  watercolor: { label: 'Aquarela', icon: '💧', key: 'w', size: 34, opacity: 0.7, spacing: 0.12, max: 160 },
  oil: { label: 'Tinta a óleo', icon: '🎨', key: 'o', size: 22, opacity: 1, spacing: 0, max: 120 },
  eraser: { label: 'Borracha', icon: '🧽', key: 'e', size: 24, opacity: 1, spacing: 0.08, max: 200 },
  bucket: { label: 'Balde', icon: '🪣', key: 'g', size: 0, opacity: 1 },
  gradient: { label: 'Gradiente', icon: '🌈', key: 'd', size: 0, opacity: 1 },
  picker: { label: 'Conta-gotas', icon: '💉', key: 'i', size: 0, opacity: 1 },
};

const BG = '#ffffff';
const MAX_UNDO = 25;

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

const rgba = ([r, g, b], a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeCanvas(w, h, className) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  if (className) c.className = className;
  return c;
}

function makeNoise(ctx, size = 128) {
  const c = makeCanvas(size, size);
  const nctx = c.getContext('2d');
  const img = nctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i + 3] = Math.random() < 0.5 ? Math.random() * 255 : 0;
  }
  nctx.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

export class DrawingBoard {
  constructor(container, { width = 800, height = 600 } = {}) {
    this.width = width;
    this.height = height;
    this.container = container;
    container.classList.add('board');
    container.style.aspectRatio = `${width} / ${height}`;

    this.paint = makeCanvas(width, height, 'board-layer board-paint');
    this.stroke = makeCanvas(width, height, 'board-layer board-stroke');
    this.preview = makeCanvas(width, height, 'board-layer board-preview');
    this.guide = document.createElement('img');
    this.guide.className = 'board-layer board-guide';
    this.guide.alt = '';
    this.guide.hidden = true;
    this.cursor = document.createElement('div');
    this.cursor.className = 'board-cursor';
    container.append(this.paint, this.stroke, this.preview, this.guide, this.cursor);

    this.pctx = this.paint.getContext('2d', { willReadFrequently: true });
    this.sctx = this.stroke.getContext('2d');
    this.vctx = this.preview.getContext('2d');
    this.tmp = makeCanvas(width, height);
    this.tctx = this.tmp.getContext('2d');
    this.noise = makeNoise(this.sctx);

    this.tool = 'hard';
    this.color = '#1f2937';
    this.color2 = '#facc15';
    this.settings = Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, { size: t.size, opacity: t.opacity }]));
    this.tolerance = 40;
    this.gradientType = 'linear';
    this.gradientMode = 'region';
    this.enabled = true;
    this.undoStack = [];
    this.redoStack = [];
    this.drawing = null;
    this.listeners = {};

    this.pctx.fillStyle = BG;
    this.pctx.fillRect(0, 0, width, height);
    this._bindEvents();
  }

  // ---------- API pública ----------

  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }

  _emit(evt, data) {
    (this.listeners[evt] || []).forEach((fn) => fn(data));
  }

  setTool(tool) {
    if (!TOOLS[tool]) return;
    this.tool = tool;
    this.container.dataset.tool = tool;
    this._emit('change', 'tool');
  }

  get size() {
    return this.settings[this.tool].size;
  }
  set size(v) {
    this.settings[this.tool].size = v;
    this._emit('change', 'size');
  }
  get opacity() {
    return this.settings[this.tool].opacity;
  }
  set opacity(v) {
    this.settings[this.tool].opacity = v;
    this._emit('change', 'opacity');
  }

  setColor(hex) {
    this.color = hex;
    this._emit('change', 'color');
  }

  setColor2(hex) {
    this.color2 = hex;
    this._emit('change', 'color');
  }

  swapColors() {
    [this.color, this.color2] = [this.color2, this.color];
    this._emit('change', 'color');
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.container.classList.toggle('locked', !enabled);
    if (!enabled && this.drawing) this._finish();
  }

  setGuide(url, opacity = 0.25) {
    if (url) {
      this.guide.src = url;
      this.guide.style.opacity = opacity;
      this.guide.hidden = false;
    } else {
      this.guide.hidden = true;
    }
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.pctx.fillStyle = BG;
    this.pctx.fillRect(0, 0, this.width, this.height);
    this._emit('change', 'history');
  }

  clear() {
    this._saveUndo();
    this.pctx.fillStyle = BG;
    this.pctx.fillRect(0, 0, this.width, this.height);
    this._emit('change', 'history');
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.pctx.getImageData(0, 0, this.width, this.height));
    this.pctx.putImageData(this.undoStack.pop(), 0, 0);
    this._emit('change', 'history');
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.pctx.getImageData(0, 0, this.width, this.height));
    this.pctx.putImageData(this.redoStack.pop(), 0, 0);
    this._emit('change', 'history');
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  toDataURL(type = 'image/jpeg', quality = 0.85) {
    return this.paint.toDataURL(type, quality);
  }

  // ---------- Eventos ----------

  _bindEvents() {
    const el = this.container;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('pointerleave', () => (this.cursor.style.display = 'none'));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _pos(e) {
    const r = this.paint.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.width) / r.width,
      y: ((e.clientY - r.top) * this.height) / r.height,
      p: e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.1, 1) : 1,
    };
  }

  _updateCursor(e) {
    const usesSize = TOOLS[this.tool].size > 0;
    if (!usesSize || !this.enabled) {
      this.cursor.style.display = 'none';
      return;
    }
    const r = this.paint.getBoundingClientRect();
    const scale = r.width / this.width;
    const d = Math.max(4, this.size * scale);
    this.cursor.style.display = 'block';
    this.cursor.style.width = this.cursor.style.height = `${d}px`;
    this.cursor.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
  }

  _down(e) {
    if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    this.container.setPointerCapture(e.pointerId);
    const pt = this._pos(e);

    if (this.tool === 'picker' || e.altKey) {
      this._pick(pt);
      return;
    }
    if (this.tool === 'bucket') {
      this._saveUndo();
      this._fill(pt);
      this._emit('change', 'history');
      return;
    }
    this._saveUndo();
    if (this.tool === 'gradient') {
      this._gradientBegin(pt);
      return;
    }
    this._strokeBegin(pt);
  }

  _move(e) {
    this._updateCursor(e);
    if (!this.drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const pt = this._pos(ev);
      if (this.drawing.tool === 'gradient') this._gradientMove(pt);
      else this._strokeMove(this.drawing, pt);
    }
  }

  _up() {
    if (this.drawing) this._finish();
  }

  _finish() {
    if (this.drawing.tool === 'gradient') this._gradientEnd();
    else this._strokeEnd();
    this._emit('change', 'history');
  }

  _saveUndo() {
    this.undoStack.push(this.pctx.getImageData(0, 0, this.width, this.height));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  // ---------- Pinceladas ----------

  _strokeBegin(pt) {
    const tool = this.tool;
    const s = this.settings[tool];
    const st = {
      tool,
      size: s.size,
      opacity: s.opacity,
      color: tool === 'eraser' ? BG : this.color,
      rgb: hexToRgb(tool === 'eraser' ? BG : this.color),
      last: pt,
      carry: 0,
    };
    this.drawing = st;

    if (tool === 'oil') {
      this._oilBegin(st);
      this._oilMove(st, pt);
      return;
    }
    // As demais ferramentas pintam num buffer separado, que é aplicado ao soltar.
    // Assim a opacidade é uniforme dentro da mesma pincelada.
    this.sctx.clearRect(0, 0, this.width, this.height);
    this.stroke.style.opacity = tool === 'watercolor' ? s.opacity * 0.8 : s.opacity;
    this.stroke.style.mixBlendMode = tool === 'watercolor' ? 'multiply' : 'normal';
    this._stamp(st, pt);
  }

  _strokeMove(st, pt) {
    if (st.tool === 'oil') {
      this._oilMove(st, pt);
      return;
    }
    const dx = pt.x - st.last.x;
    const dy = pt.y - st.last.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return;
    const spacing = Math.max(0.5, st.size * TOOLS[st.tool].spacing);
    let t = spacing - st.carry;
    while (t <= d) {
      const k = t / d;
      this._stamp(st, { x: st.last.x + dx * k, y: st.last.y + dy * k, p: st.last.p + (pt.p - st.last.p) * k });
      t += spacing;
    }
    st.carry = d - (t - spacing);
    st.last = pt;
  }

  _stamp(st, p) {
    const c = this.sctx;
    const r = Math.max(0.5, (st.size * p.p) / 2);
    switch (st.tool) {
      case 'pencil':
      case 'hard':
      case 'eraser': {
        c.fillStyle = st.color;
        c.beginPath();
        c.arc(p.x, p.y, Math.max(0.6, r), 0, TAU);
        c.fill();
        break;
      }
      case 'soft': {
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, rgba(st.rgb, 0.3));
        g.addColorStop(0.5, rgba(st.rgb, 0.15));
        g.addColorStop(1, rgba(st.rgb, 0));
        c.fillStyle = g;
        c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        break;
      }
      case 'watercolor': {
        // manchas irregulares, levemente deslocadas
        const rr = r * (0.8 + Math.random() * 0.4);
        const x = p.x + (Math.random() - 0.5) * r * 0.35;
        const y = p.y + (Math.random() - 0.5) * r * 0.35;
        const g = c.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, rgba(st.rgb, 0.16));
        g.addColorStop(0.75, rgba(st.rgb, 0.13));
        g.addColorStop(1, rgba(st.rgb, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, rr, 0, TAU);
        c.fill();
        break;
      }
    }
  }

  _strokeEnd() {
    const st = this.drawing;
    this.drawing = null;
    if (st.tool === 'oil') return;

    const m = this.pctx;
    if (st.tool === 'pencil') {
      // textura de grafite
      this._erodeWithNoise(0.45);
      m.save();
      m.globalAlpha = st.opacity;
      m.drawImage(this.stroke, 0, 0);
      m.restore();
    } else if (st.tool === 'watercolor') {
      this._commitWatercolor(st);
    } else {
      m.save();
      m.globalAlpha = st.opacity;
      m.drawImage(this.stroke, 0, 0);
      m.restore();
    }
    this.sctx.clearRect(0, 0, this.width, this.height);
    this.stroke.style.opacity = 1;
    this.stroke.style.mixBlendMode = 'normal';
  }

  _erodeWithNoise(alpha) {
    const c = this.sctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = alpha;
    c.fillStyle = this.noise;
    c.fillRect(0, 0, this.width, this.height);
    c.restore();
  }

  _commitWatercolor(st) {
    // granulação do papel
    this._erodeWithNoise(0.22);

    // borda molhada: pigmento acumula na borda da mancha
    const t = this.tctx;
    t.clearRect(0, 0, this.width, this.height);
    t.drawImage(this.stroke, 0, 0);
    t.save();
    t.globalCompositeOperation = 'destination-out';
    t.filter = `blur(${clamp(st.size / 8, 2, 8)}px)`;
    t.drawImage(this.stroke, 0, 0);
    t.restore();

    // multiply: as camadas se misturam como pigmento transparente
    const m = this.pctx;
    m.save();
    m.globalCompositeOperation = 'multiply';
    m.globalAlpha = st.opacity * 0.85;
    m.filter = 'blur(0.7px)';
    m.drawImage(this.stroke, 0, 0);
    m.filter = 'none';
    m.globalAlpha = st.opacity * 0.7;
    m.drawImage(this.tmp, 0, 0);
    m.restore();
  }

  // ---------- Tinta a óleo: cerdas que misturam com a tinta da tela ----------

  _oilBegin(st) {
    const n = Math.round(clamp(st.size * 0.9, 8, 56));
    st.base = st.rgb.slice();
    st.load = 1;
    st.dir = { x: 1, y: 0 };
    st.bristles = Array.from({ length: n }, () => ({
      u: Math.random() * 2 - 1, // posição ao longo da largura do pincel
      v: (Math.random() * 2 - 1) * 0.3, // pequena profundidade
      w: 0.12 + Math.random() * 0.2, // espessura relativa
      shade: (Math.random() - 0.5) * 0.22,
      prev: null,
    }));
  }

  _oilMove(st, pt) {
    const dx = pt.x - st.last.x;
    const dy = pt.y - st.last.y;
    const d = Math.hypot(dx, dy);
    if (st.bristles[0].prev && d < 1) return;

    if (d > 0) {
      const nx = st.dir.x * 0.75 + (dx / d) * 0.25;
      const ny = st.dir.y * 0.75 + (dy / d) * 0.25;
      const len = Math.hypot(nx, ny) || 1;
      st.dir = { x: nx / len, y: ny / len };
    }

    // o pincel "pega" um pouco da tinta que já está na tela
    const sx = clamp(Math.round(pt.x), 0, this.width - 1);
    const sy = clamp(Math.round(pt.y), 0, this.height - 1);
    const px = this.pctx.getImageData(sx, sy, 1, 1).data;
    st.rgb = mix(st.rgb, [px[0], px[1], px[2]], 0.05 * clamp(d / 4, 0, 1));
    st.rgb = mix(st.rgb, st.base, 0.015 * st.load);
    st.load = Math.max(0.2, st.load - d / 3000);

    const r = (st.size * pt.p) / 2;
    const nrm = { x: -st.dir.y, y: st.dir.x };
    const m = this.pctx;
    m.save();
    m.lineCap = 'round';
    for (const b of st.bristles) {
      const pos = {
        x: pt.x + nrm.x * b.u * r + st.dir.x * b.v * r,
        y: pt.y + nrm.y * b.u * r + st.dir.y * b.v * r,
      };
      // pincel seco: algumas cerdas falham quando a tinta acaba
      if (b.prev && Math.random() < st.load + 0.45) {
        const shade = b.shade > 0 ? mix(st.rgb, [255, 255, 255], b.shade) : mix(st.rgb, [0, 0, 0], -b.shade);
        m.strokeStyle = rgba(shade, st.opacity * (0.55 + 0.45 * st.load));
        m.lineWidth = Math.max(1, r * b.w * 2);
        m.beginPath();
        m.moveTo(b.prev.x, b.prev.y);
        m.lineTo(pos.x, pos.y);
        m.stroke();
      }
      b.prev = pos;
    }
    m.restore();
    st.last = pt;
  }

  // ---------- Balde ----------

  _floodMask(x0, y0) {
    const W = this.width;
    const H = this.height;
    const d = this.pctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    x0 = clamp(Math.floor(x0), 0, W - 1);
    y0 = clamp(Math.floor(y0), 0, H - 1);
    const o0 = (y0 * W + x0) * 4;
    const tr = d[o0];
    const tg = d[o0 + 1];
    const tb = d[o0 + 2];
    const tol = this.tolerance;
    const match = (i) => {
      const o = i * 4;
      return Math.abs(d[o] - tr) <= tol && Math.abs(d[o + 1] - tg) <= tol && Math.abs(d[o + 2] - tb) <= tol;
    };

    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      let i = y * W + x;
      while (x >= 0 && !mask[i] && match(i)) {
        x--;
        i--;
      }
      x++;
      i++;
      let up = false;
      let down = false;
      while (x < W && !mask[i] && match(i)) {
        mask[i] = 1;
        if (y > 0) {
          const j = i - W;
          if (!mask[j] && match(j)) {
            if (!up) {
              stack.push(x, y - 1);
              up = true;
            }
          } else up = false;
        }
        if (y < H - 1) {
          const j = i + W;
          if (!mask[j] && match(j)) {
            if (!down) {
              stack.push(x, y + 1);
              down = true;
            }
          } else down = false;
        }
        x++;
        i++;
      }
    }

    // expande 1px para cobrir o anti-aliasing das linhas, sem engolir traços finos
    const edgeTol = Math.min(255, tol + 90);
    const nearTarget = (i) => {
      const o = i * 4;
      return Math.abs(d[o] - tr) <= edgeTol && Math.abs(d[o + 1] - tg) <= edgeTol && Math.abs(d[o + 2] - tb) <= edgeTol;
    };
    const out = mask.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (mask[i] || !nearTarget(i)) continue;
        if ((x > 0 && mask[i - 1]) || (x < W - 1 && mask[i + 1]) || (y > 0 && mask[i - W]) || (y < H - 1 && mask[i + W])) out[i] = 1;
      }
    }
    return out;
  }

  _fill(pt) {
    const mask = this._floodMask(pt.x, pt.y);
    const img = this.pctx.getImageData(0, 0, this.width, this.height);
    const d = img.data;
    const [r, g, b] = hexToRgb(this.color);
    const a = this.settings.bucket.opacity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      d[o] += (r - d[o]) * a;
      d[o + 1] += (g - d[o + 1]) * a;
      d[o + 2] += (b - d[o + 2]) * a;
      d[o + 3] = 255;
    }
    this.pctx.putImageData(img, 0, 0);
  }

  _maskCanvas(mask) {
    const c = makeCanvas(this.width, this.height);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.width, this.height);
    for (let i = 0; i < mask.length; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ---------- Gradiente ----------

  _gradientBegin(pt) {
    this.drawing = {
      tool: 'gradient',
      start: pt,
      end: pt,
      mask: this.gradientMode === 'region' ? this._maskCanvas(this._floodMask(pt.x, pt.y)) : null,
    };
    this._gradientPreview();
  }

  _gradientMove(pt) {
    this.drawing.end = pt;
    this._gradientPreview();
  }

  _gradientLayer() {
    const { start, end, mask } = this.drawing;
    const t = this.tctx;
    t.clearRect(0, 0, this.width, this.height);
    const dist = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
    const g = this.gradientType === 'radial' ? t.createRadialGradient(start.x, start.y, 0, start.x, start.y, dist) : t.createLinearGradient(start.x, start.y, end.x, end.y);
    g.addColorStop(0, this.color);
    g.addColorStop(1, this.color2);
    t.fillStyle = g;
    t.fillRect(0, 0, this.width, this.height);
    if (mask) {
      t.save();
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(mask, 0, 0);
      t.restore();
    }
    return this.tmp;
  }

  _gradientPreview() {
    const v = this.vctx;
    const { start, end } = this.drawing;
    v.clearRect(0, 0, this.width, this.height);
    v.save();
    v.globalAlpha = this.settings.gradient.opacity;
    v.drawImage(this._gradientLayer(), 0, 0);
    v.restore();
    v.save();
    v.strokeStyle = '#fff';
    v.lineWidth = 3;
    v.setLineDash([6, 4]);
    v.beginPath();
    v.moveTo(start.x, start.y);
    v.lineTo(end.x, end.y);
    v.stroke();
    v.strokeStyle = '#111';
    v.lineWidth = 1;
    v.stroke();
    for (const p of [start, end]) {
      v.setLineDash([]);
      v.fillStyle = '#fff';
      v.beginPath();
      v.arc(p.x, p.y, 5, 0, TAU);
      v.fill();
      v.stroke();
    }
    v.restore();
  }

  _gradientEnd() {
    const layer = this._gradientLayer();
    const m = this.pctx;
    m.save();
    m.globalAlpha = this.settings.gradient.opacity;
    m.drawImage(layer, 0, 0);
    m.restore();
    this.vctx.clearRect(0, 0, this.width, this.height);
    this.drawing = null;
  }

  // ---------- Conta-gotas ----------

  _pick(pt) {
    const x = clamp(Math.round(pt.x), 0, this.width - 1);
    const y = clamp(Math.round(pt.y), 0, this.height - 1);
    const d = this.pctx.getImageData(x, y, 1, 1).data;
    this.setColor(rgbToHex([d[0], d[1], d[2]]));
  }
}
