/* =========================================================
 * 生日快乐交响曲 —— Patatap 风格互动祝福页
 * 每个键 = 一段声音 + 一个专属动画
 * 声音来源：assets/song.mp3 运行时切片（Web Audio API）
 * ========================================================= */
(() => {
  'use strict';

  /* ---------------- 基础 ---------------- */
  const canvas = document.getElementById('stage');
  const g = canvas.getContext('2d');
  let W = 0, H = 0;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hsla = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a})`;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  // 确定性伪随机：同一个键每次长一样的样子，形成肌肉记忆
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  /* ---------------- 键位 ---------------- */
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const NUMBERS = '12345678'.split('');
  const VISUALS = ['ring', 'pop', 'bars', 'tri', 'confetti', 'star', 'balloon', 'ripple', 'arc', 'notes', 'slide', 'firework'];
  // 五声音阶（C 大调宫商角徵羽 + 高八度），怎么按都和谐
  const PENTA_FREQS = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
  const PENTA_ALL = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];

  const PADS = {};
  LETTERS.forEach((ch, i) => {
    const col = i % 7, row = Math.floor(i / 7) % 3;
    PADS[ch] = {
      kind: 'sample',
      idx: i,
      visual: VISUALS[(i * 5) % VISUALS.length],
      x: (col + .5) / 7,
      y: (row + .5) / 3 * .78 + .07,
      jx: (hash(i * 3 + 1) - .5) * .07,
      jy: (hash(i * 7 + 2) - .5) * .09,
      hue: (i * 137.508) % 360,
      seg: null,
    };
  });
  NUMBERS.forEach((ch, i) => {
    PADS[ch] = { kind: 'pluck', idx: 26 + i, visual: 'balloon', freq: PENTA_FREQS[i], x: (i + .5) / 8, y: .9, jx: 0, jy: 0, hue: (i * 137.508 + 45) % 360, seg: null };
  });
  PADS[' '] = { kind: 'chorus', idx: 34, visual: 'banner', x: .5, y: .5, jx: 0, jy: 0, hue: 330, seg: null };

  // 音频解码完成后，把整首歌切成 26 片分给字母键（按 A→Z 顺序 ≈ 按顺序敲 ≈ 放完整首）
  function assignSegments(dur) {
    const usable = Math.max(1, dur * .97 - 1.8);
    LETTERS.forEach((ch, i) => {
      const len = .55 + hash(i * 11 + 5) * 1.05;
      const start = ((i + hash(i * 13 + 7) * .7) / 26) * usable;
      PADS[ch].seg = { start: Math.min(start, dur - len - .1), len, rate: .92 + hash(i * 17 + 9) * .2 };
    });
    PADS[' '].seg = { start: dur * .5, len: 2.6, rate: 1 };
  }

  /* ---------------- 音频 ---------------- */
  let actx = null, master = null, songBuffer = null, noiseBuf = null;
  let audioFailed = false, muted = false, melodyPlaying = false, melodyEnd = 0;
  const melodyQ = [];

  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { audioFailed = true; return; }
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : .9;
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(actx.destination);
    // 0.5s 白噪声，备用打击乐
    const len = Math.floor(actx.sampleRate * .5);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 加载并解码整首歌
    fetch('assets/song.mp3')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(ab => actx.decodeAudioData(ab))
      .then(buf => { songBuffer = buf; assignSegments(buf.duration); setLoading(false); })
      .catch(() => { audioFailed = true; setLoading(false); hudMsg('音频加载失败，已切换为合成音色 🎹'); });
  }

  // 播放歌曲切片，带淡入淡出防爆音；返回是否成功
  function playSample(seg) {
    if (!songBuffer) return false;
    const t0 = actx.currentTime + .001;
    const src = actx.createBufferSource();
    src.buffer = songBuffer;
    src.playbackRate.value = seg.rate;
    const gn = actx.createGain();
    const dur = seg.len / seg.rate;
    gn.gain.setValueAtTime(0, t0);
    gn.gain.linearRampToValueAtTime(1, t0 + .012);
    gn.gain.setValueAtTime(1, t0 + dur * .7);
    gn.gain.linearRampToValueAtTime(.0001, t0 + dur);
    src.connect(gn); gn.connect(master);
    src.start(t0, seg.start, seg.len + .05);
    src.stop(t0 + dur + .05);
    return true;
  }

  // 合成拨弦音（数字键 / 生日歌旋律）
  function pluck(freq, when, dur = .55, vol = .5) {
    const t0 = when ?? actx.currentTime + .001;
    const o1 = actx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = freq;
    const o2 = actx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g2 = actx.createGain(); g2.gain.value = .18;
    const gn = actx.createGain();
    gn.gain.setValueAtTime(0, t0);
    gn.gain.linearRampToValueAtTime(vol, t0 + .008);
    gn.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
    o1.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(master);
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + dur + .05); o2.stop(t0 + dur + .05);
  }

  // 备用打击乐（歌曲加载前 / 失败时）
  function perc(freq, dur = .16, vol = .5) {
    const t0 = actx.currentTime + .001;
    const s = actx.createBufferSource(); s.buffer = noiseBuf;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.1;
    const gn = actx.createGain();
    gn.gain.setValueAtTime(vol, t0);
    gn.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
    s.connect(bp); bp.connect(gn); gn.connect(master);
    s.start(t0); s.stop(t0 + dur + .02);
  }

  function playPad(pad) {
    if (!actx) return;
    if (pad.kind === 'pluck') { pluck(pad.freq, null, .55, .5); return; }
    if (pad.kind === 'chorus') {
      if (!(pad.seg && playSample(pad.seg))) playMelody();
      return;
    }
    // 字母键：优先歌曲切片，否则合成打击乐兜底
    if (pad.seg && playSample(pad.seg)) return;
    perc(280 + hash(pad.idx * 3) * 2300, .13 + hash(pad.idx) * .12, .5);
    if (pad.idx % 3 === 0) pluck(PENTA_ALL[pad.idx % PENTA_ALL.length], null, .35, .22);
  }

  /* ---------------- 生日歌自动演奏（回车） ---------------- */
  const NOTE_FREQ = { G4: 392.00, A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99 };
  // 《祝你生日快乐》旋律（C 大调，单位：拍）
  const MELODY = [
    ['G4', .75], ['G4', .25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
    ['G4', .75], ['G4', .25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
    ['G4', .75], ['G4', .25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 1.5],
    ['F5', .75], ['F5', .25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 2],
  ];

  function playMelody() {
    if (!actx || melodyPlaying) return;
    melodyPlaying = true;
    melodyQ.length = 0;
    const beat = .46;
    let t = actx.currentTime + .1;
    let i = 0;
    for (const [n, b] of MELODY) {
      const d = b * beat;
      pluck(NOTE_FREQ[n], t, Math.max(.5, d * 1.15), .42);
      melodyQ.push({ t, i: i++ });
      t += d;
    }
    melodyEnd = t;
  }

  /* ---------------- 动画系统 ---------------- */
  const anims = [];   // 舞台层
  const fx = [];      // 前景层（横幅等，最后画）

  function addAnim(list, life, step) { if (list.length < 170) list.push({ t: 0, life, step }); }

  function glow(x, y, hue) {
    addAnim(anims, .45, (dt, t) => {
      const p = easeOutCubic(t / .45);
      const r = 30 + 150 * p;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, hsla(hue, 90, 65, .3 * (1 - p)));
      gr.addColorStop(1, hsla(hue, 90, 65, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    });
  }

  function vRing(x, y, hue) {
    const rMax = Math.min(W, H) * rand(.3, .44);
    addAnim(anims, .85, (dt, t) => {
      const p = easeOutCubic(t / .85);
      g.strokeStyle = hsla(hue, 92, 64, 1 - p);
      g.lineWidth = 14 * (1 - p) + 1.5;
      g.beginPath(); g.arc(x, y, 12 + rMax * p, 0, TAU); g.stroke();
      if (t > .1) {
        const p2 = easeOutCubic((t - .1) / .75);
        g.strokeStyle = hsla(hue, 92, 72, (1 - p2) * .55);
        g.lineWidth = 6 * (1 - p2) + 1;
        g.beginPath(); g.arc(x, y, 10 + rMax * .62 * p2, 0, TAU); g.stroke();
      }
    });
  }

  function vPop(x, y, hue, seed) {
    const R = (38 + hash(seed) * 40) * Math.min(1, Math.min(W, H) / 700 + .35);
    addAnim(anims, .95, (dt, t) => {
      const s = easeOutBack(Math.min(1, t / .32));
      const alpha = t < .55 ? 1 : 1 - easeOutCubic((t - .55) / .4);
      g.fillStyle = hsla(hue, 88, 62, .95 * alpha);
      g.beginPath(); g.arc(x, y, Math.max(0, R * s), 0, TAU); g.fill();
      g.fillStyle = hsla(hue, 88, 82, .5 * alpha);
      g.beginPath(); g.arc(x - R * .3 * s, y - R * .32 * s, R * .2 * s, 0, TAU); g.fill();
    });
  }

  function vBars(x, y, hue, seed) {
    const n = 5, bw = 9, gap = 7;
    const hs = Array.from({ length: n }, (_, i) => 30 + hash(seed * 9 + i) * 90);
    addAnim(anims, 1.0, (dt, t) => {
      const alpha = t < .6 ? 1 : 1 - easeOutCubic((t - .6) / .4);
      g.fillStyle = hsla(hue, 88, 62, .95 * alpha);
      const up = easeOutCubic(Math.min(1, t / .3));
      hs.forEach((h, i) => {
        const bh = h * up * (t > .55 ? 1 - (t - .55) / .5 : 1);
        g.fillRect(x - (n * bw + (n - 1) * gap) / 2 + i * (bw + gap), y - bh, bw, bh);
      });
    });
  }

  function vTri(x, y, hue, seed) {
    const R = 52 + hash(seed * 3) * 40;
    addAnim(anims, .95, (dt, t) => {
      const s = easeOutBack(Math.min(1, t / .4));
      const alpha = t < .5 ? 1 : 1 - (t - .5) / .45;
      const rot = hash(seed) * TAU + t * 2.2;
      g.fillStyle = hsla(hue, 88, 62, .9 * alpha);
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rot - Math.PI / 2 + k * TAU / 3;
        const px = x + Math.cos(a) * R * s, py = y + Math.sin(a) * R * s;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    });
  }

  function vConfetti(x, y, hue, count = 26) {
    const parts = Array.from({ length: count }, () => {
      const a = rand(0, TAU), sp = rand(260, 720);
      return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160, w: rand(6, 12), h: rand(4, 8), rot: rand(0, TAU), vr: rand(-9, 9), hue: (hue + rand(-45, 45) + 360) % 360, die: rand(.9, 1.6) };
    });
    addAnim(anims, 1.7, (dt, t) => {
      for (const p of parts) {
        if (t > p.die) continue;
        p.vy += 880 * dt; p.vx *= (1 - 1.4 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const alpha = clamp(1 - (t - (p.die - .45)) / .45, 0, 1);
        g.save();
        g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = hsla(p.hue, 90, 62, alpha);
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.cos(p.rot * 1.7))));
        g.restore();
      }
    });
  }

  function vStar(x, y, hue, seed) {
    const R = 42 + hash(seed * 5) * 34;
    const rot0 = hash(seed) * TAU;
    addAnim(anims, 1.0, (dt, t) => {
      const s = easeOutBack(Math.min(1, t / .3));
      const alpha = t < .55 ? 1 : 1 - (t - .55) / .45;
      const rot = rot0 + 3.4 * easeOutCubic(t / 1.0);
      g.fillStyle = hsla(hue, 92, 66, .95 * alpha);
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = (k % 2 ? R * .45 : R) * s;
        const a = rot - Math.PI / 2 + k * Math.PI / 5;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    });
  }

  function vBalloon(x, y, hue, seed) {
    const s = 24 + hash(seed) * 18, vy = rand(115, 175), ph = rand(0, TAU);
    addAnim(anims, 4.5, (dt, t) => {
      const bx = x + Math.sin(t * 2 + ph) * 24, by = y - vy * t;
      if (by < -s * 3) return false;
      g.strokeStyle = hsla(hue, 60, 80, .55);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(bx, by + s);
      g.quadraticCurveTo(bx + Math.sin(t * 3 + ph) * 10, by + s * 2, bx, by + s * 2.9);
      g.stroke();
      g.fillStyle = hsla(hue, 85, 60, .95);
      g.beginPath(); g.ellipse(bx, by, s * .78, s, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(bx - s * .18, by + s); g.lineTo(bx + s * .18, by + s); g.lineTo(bx, by + s * 1.28); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.beginPath(); g.ellipse(bx - s * .28, by - s * .35, s * .16, s * .26, -.5, 0, TAU); g.fill();
    });
  }

  function vRipple(x, y, hue) {
    addAnim(anims, 1.0, (dt, t) => {
      for (let k = 0; k < 3; k++) {
        const tt = t - k * .13;
        if (tt <= 0) continue;
        const p = easeOutCubic(tt / .85);
        g.strokeStyle = hsla(hue, 88, 66, (1 - p) * .8);
        g.lineWidth = 4 * (1 - p) + .8;
        g.beginPath(); g.arc(x, y, 8 + Math.min(W, H) * .3 * p, 0, TAU); g.stroke();
      }
    });
  }

  function vArc(x, y, hue, seed) {
    const R = 74 + hash(seed * 7) * 56, a0 = hash(seed) * TAU;
    addAnim(anims, .9, (dt, t) => {
      const p = easeOutCubic(t / .9);
      const head = a0 + p * 2.4, span = .95 * (1 - p * .5);
      g.lineCap = 'round';
      g.strokeStyle = hsla(hue, 90, 64, 1 - p);
      g.lineWidth = 12 * (1 - p) + 2;
      g.beginPath(); g.arc(x, y, R, head - span, head); g.stroke();
      g.lineCap = 'butt';
    });
  }

  function vNotes(x, y, hue, seed) {
    const glyphs = ['♪', '♫', '♩'];
    const ns = Array.from({ length: 3 }, (_, k) => ({ dx: (hash(seed + k) - .5) * 90, sp: rand(80, 150), size: rand(20, 42), ph: rand(0, TAU), ch: glyphs[k % glyphs.length] }));
    addAnim(anims, 1.3, (dt, t) => {
      const alpha = 1 - easeOutCubic(t / 1.3);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const n of ns) {
        g.font = `${n.size}px system-ui`;
        g.fillStyle = hsla(hue, 85, 78, alpha);
        g.fillText(n.ch, x + n.dx + Math.sin(t * 3 + n.ph) * 14, y - n.sp * t);
      }
    });
  }

  function vSlide(x, y, hue, seed) {
    const vertical = hash(seed * 11) > .5;
    const bw = 26 + hash(seed * 13) * 30;
    const span = (vertical ? H : W) * .85;
    addAnim(anims, .85, (dt, t) => {
      const grow = easeOutCubic(Math.min(1, t / .35));
      const alpha = t < .45 ? .92 : .92 * (1 - (t - .45) / .4);
      g.fillStyle = hsla(hue, 88, 62, alpha);
      if (vertical) g.fillRect(x - bw / 2, y - span * grow / 2, bw, span * grow);
      else g.fillRect(x - span * grow / 2, y - bw / 2, span * grow, bw);
    });
  }

  function vFirework(x, y, hue) {
    const parts = Array.from({ length: 34 }, () => {
      const a = rand(0, TAU), sp = rand(150, 500);
      return { x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, hue: (hue + rand(-35, 35) + 360) % 360, die: rand(.65, 1.15) };
    });
    addAnim(anims, 1.25, (dt, t) => {
      for (const p of parts) {
        if (t > p.die) continue;
        p.px = p.x; p.py = p.y;
        p.vy += 480 * dt; p.vx *= (1 - .8 * dt); p.vy *= (1 - .35 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        const alpha = clamp(1 - (t - (p.die - .4)) / .4, 0, 1);
        g.strokeStyle = hsla(p.hue, 92, 68, alpha);
        g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(p.px, p.py); g.lineTo(p.x, p.y); g.stroke();
      }
    });
  }

  // 空格大横幅：HAPPY BIRTHDAY + 名字
  function showBanner() {
    addAnim(fx, 2.6, (dt, t) => {
      const s = easeOutBack(Math.min(1, t / .5));
      const alpha = t < 2.0 ? 1 : 1 - (t - 2.0) / .6;
      const fs = Math.min(W * .085, 92);
      const cy = H * .42;
      g.save();
      g.translate(W / 2, cy);
      g.scale(s, s);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const grad = g.createLinearGradient(0, -fs * 1.2, 0, fs * 1.6);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(.55, '#ffd166');
      grad.addColorStop(1, '#ff8fab');
      g.globalAlpha = alpha;
      g.font = `900 ${fs}px system-ui, sans-serif`;
      g.fillStyle = grad;
      g.fillText('HAPPY BIRTHDAY', 0, 0);
      g.font = `600 ${fs * .34}px system-ui, sans-serif`;
      g.fillStyle = 'rgba(255,255,255,.92)';
      g.fillText(BANNER_SUB, 0, fs * .82);
      g.restore();
      g.globalAlpha = 1;
    });
    // 全屏彩带雨
    const parts = Array.from({ length: 72 }, () => ({
      x: rand(0, W), y: rand(-H * .25, -12), vy: rand(140, 300), vx: rand(-40, 40),
      w: rand(6, 13), h: rand(4, 9), rot: rand(0, TAU), vr: rand(-8, 8),
      hue: rand(0, 360), die: rand(1.6, 2.5),
    }));
    addAnim(fx, 2.6, (dt, t) => {
      for (const p of parts) {
        if (t > p.die) continue;
        p.x += (p.vx + Math.sin(t * 4 + p.rot) * 40) * dt;
        p.y += p.vy * dt; p.rot += p.vr * dt;
        const alpha = clamp(1 - (t - (p.die - .5)) / .5, 0, 1);
        g.save();
        g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = hsla(p.hue, 88, 64, alpha);
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
    });
  }

  const VIS_FN = { ring: vRing, pop: vPop, bars: vBars, tri: vTri, confetti: vConfetti, star: vStar, balloon: vBalloon, ripple: vRipple, arc: vArc, notes: vNotes, slide: vSlide, firework: vFirework };
  function spawnVisual(type, x, y, hue, seed) {
    const fn = VIS_FN[type] || vRing;
    fn(x, y, hue, seed);
  }

  /* ---------------- 背景 ---------------- */
  let bgGrad = null, stars = [];
  function buildBackground() {
    bgGrad = g.createRadialGradient(W * .5, H * .4, 60, W * .5, H * .5, Math.max(W, H) * .78);
    bgGrad.addColorStop(0, '#171b36');
    bgGrad.addColorStop(1, '#0a0c1a');
    stars = Array.from({ length: Math.round(W * H / 15000) }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: rand(.4, 1.6), ph: rand(0, TAU), sp: rand(.5, 1.8),
    }));
  }

  let lastW = 0, lastH = 0, lastDpr = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    lastW = W; lastH = H; lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // 显式锁定 CSS 尺寸：位图再怎么变，显示永远和视口 1:1，坐标系不会错位
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildBackground();
  }
  window.addEventListener('resize', resize);
  resize();

  // 某些嵌入环境改视口时不发 resize 事件，每帧廉价自检一次
  function viewportChanged() {
    return window.innerWidth !== lastW || window.innerHeight !== lastH ||
      Math.min(window.devicePixelRatio || 1, 2) !== lastDpr;
  }

  /* ---------------- 触发 ---------------- */
  // 专属定制，不复用：改这里即可换人
  const NAME = '崔师傅';
  const FROM = '汪师傅和桃桃桃';
  const BANNER_SUB = `${FROM}祝${NAME}生日快乐 🎂`;

  const lastHit = Object.create(null);
  function trigger(key, px, py) {
    const pad = PADS[key];
    if (!pad) return;
    const nowT = performance.now();
    if (lastHit[key] && nowT - lastHit[key] < 60) return;
    lastHit[key] = nowT;
    playPad(pad);
    const x = px ?? (pad.x + pad.jx) * W;
    const y = py ?? (pad.y + pad.jy) * H;
    glow(x, y, pad.hue);
    if (pad.visual === 'banner') showBanner();
    else spawnVisual(pad.visual, x, y, pad.hue, pad.idx);
  }

  function start() {
    if (started) return;
    started = true;
    document.getElementById('intro').classList.add('hide');
    document.getElementById('hud').classList.add('show');
    setLoading(true);
    initAudio();
  }

  function setLoading(on) { document.getElementById('loading').hidden = !on; }

  let msgTimer = 0;
  function hudMsg(text) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  /* ---------------- 输入 ---------------- */
  let started = false;

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') e.preventDefault();
    const key = e.key === ' ' ? ' ' : e.key.toUpperCase();
    if (!started) { start(); if (PADS[key]) trigger(key); return; }
    if (e.key === 'Enter') { playMelody(); return; }
    if (PADS[key]) trigger(key);
  });

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return;
    if (!started) { start(); return; }
    // 触摸 / 点击 = 随机键，位置就在指尖
    const keys = Object.keys(PADS).filter(k => k !== ' ');
    trigger(keys[Math.floor(Math.random() * keys.length)], e.clientX, e.clientY);
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const muteBtn = document.getElementById('mute');
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (actx && master) master.gain.linearRampToValueAtTime(muted ? 0 : .9, actx.currentTime + .06);
    muteBtn.blur();
  });

  /* ---------------- 主循环 ---------------- */
  let melodyBannerShown = false;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (viewportChanged()) resize();

    g.fillStyle = bgGrad;
    g.fillRect(0, 0, W, H);

    const tt = now / 1000;
    for (const s of stars) {
      g.globalAlpha = .22 + .3 * (0.5 + 0.5 * Math.sin(tt * s.sp + s.ph));
      g.fillStyle = '#dfe6ff';
      g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;

    // 自动演奏：按音频时钟吐气球 + 音符
    if (actx && melodyQ.length) {
      const ct = actx.currentTime;
      while (melodyQ.length && melodyQ[0].t <= ct) {
        const ev = melodyQ.shift();
        const x = ((ev.i % 12) + .5) / 12 * W;
        const hue = (ev.i * 137.508 + 25) % 360;
        if (anims.length < 165) {
          vBalloon(x, H * .95, hue, ev.i * 7 + 1);
          vNotes(x, H * .8, hue, ev.i * 13 + 3);
        }
      }
      if (!melodyQ.length && actx.currentTime > melodyEnd) {
        melodyPlaying = false;
        if (!melodyBannerShown) { melodyBannerShown = true; showBanner(); setTimeout(() => (melodyBannerShown = false), 4000); }
      }
    }

    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt;
      if (a.t >= a.life || a.step(dt, a.t) === false) anims.splice(i, 1);
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const a = fx[i];
      a.t += dt;
      if (a.t >= a.life || a.step(dt, a.t) === false) fx.splice(i, 1);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------------- 首屏文案 ---------------- */
  document.getElementById('name-line').textContent = `祝${NAME}生日快乐 🎂`;
  document.title = `🎂 ${FROM}祝${NAME}生日快乐`;
})();
