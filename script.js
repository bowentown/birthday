/* =========================================================
 * 生日快乐交响曲 —— Patatap 风格互动祝福页（精细版）
 * 每个键 = 一段声音 + 一个专属动画
 * 声音：assets/song.mp3 运行时切片 + WebAudio 算法混响
 * 视觉：双画布（背景星空 / 动画层辉光拖尾）+ canvas-confetti
 * 彩带库：canvas-confetti（ISC License，见 assets/vendor/）
 * ========================================================= */
(() => {
  'use strict';

  /* ---------------- 专属定制，不复用：改这里即可换人 ---------------- */
  const NAME = '崔师傅';
  const FROM = '汪师傅和桃桃桃';

  /* ---------------- 基础 ---------------- */
  const bgCanvas = document.getElementById('stage');   // 背景层：星空
  const fxCanvas = document.getElementById('fx');      // 动画层：辉光拖尾
  const gB = bgCanvas.getContext('2d');
  const gF = fxCanvas.getContext('2d');
  let W = 0, H = 0;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hsla = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a})`;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  // 确定性伪随机：同一个键每次长一样的样子，形成肌肉记忆
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const paletteFor = hue => [hslToHex(hue, 90, 62), hslToHex((hue + 45) % 360, 90, 64), hslToHex((hue + 90) % 360, 85, 72), '#ffffff'];

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
  let actx = null, master = null, reverb = null, songBuffer = null, noiseBuf = null;
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
    // 算法混响：2 秒指数衰减的立体声脉冲响应
    const irLen = Math.floor(actx.sampleRate * 1.8);
    const ir = actx.createBuffer(2, irLen, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.8);
    }
    reverb = actx.createConvolver();
    reverb.buffer = ir;
    const wet = actx.createGain();
    wet.gain.value = .5;
    reverb.connect(wet);
    wet.connect(comp);
    // 0.5s 白噪声，备用打击乐
    const len = Math.floor(actx.sampleRate * .5);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 加载并解码整首歌（带进度百分比，加载完成会明确提示）
    loadSong();
  }

  async function loadSong() {
    try {
      const r = await fetch('assets/song.m4a');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = +r.headers.get('Content-Length') || 0;
      let ab;
      if (r.body && total) {
        const reader = r.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          setLoadingText(`🎵 正在加载你的歌 ${Math.min(99, Math.round(got / total * 100))}%`);
        }
        ab = await new Response(new Blob(chunks)).arrayBuffer();
      } else {
        ab = await r.arrayBuffer();
      }
      const buf = await actx.decodeAudioData(ab);
      songBuffer = buf;
      assignSegments(buf.duration);
      setLoading(false);
      hudMsg('🎧 你的歌已就位，尽情敲！');
    } catch (e) {
      audioFailed = true;
      setLoading(false);
      hudMsg('音频加载失败，已切换为合成音色 🎹');
    }
  }

  // 按指定比例把声音送进混响
  function sendReverb(node, amt) {
    const g = actx.createGain();
    g.gain.value = amt;
    node.connect(g);
    g.connect(reverb);
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
    sendReverb(gn, .12);
    src.start(t0, seg.start, seg.len + .05);
    src.stop(t0 + dur + .05);
    return true;
  }

  // 合成拨弦音（数字键 / 生日歌旋律），带混响更空灵
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
    sendReverb(gn, .45);
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
    sendReverb(gn, .3);
    s.start(t0); s.stop(t0 + dur + .02);
  }

  function playPad(pad) {
    if (!actx) return;
    if (pad.kind === 'pluck') { pluck(pad.freq, null, .55, .5); return; }
    if (pad.kind === 'chorus') {
      if (!(pad.seg && playSample(pad.seg))) playMelody();
      return;
    }
    // 字母键：优先歌曲切片，否则合成打击乐兜底（并明确告知歌还在加载）
    if (pad.seg && playSample(pad.seg)) return;
    if (!audioFailed && !songBuffer) hintFallback();
    perc(280 + hash(pad.idx * 3) * 2300, .13 + hash(pad.idx) * .12, .5);
    if (pad.idx % 3 === 0) pluck(PENTA_ALL[pad.idx % PENTA_ALL.length], null, .35, .22);
  }

  let lastFallbackMsg = 0;
  function hintFallback() {
    const now = performance.now();
    if (now - lastFallbackMsg < 6000) return;
    lastFallbackMsg = now;
    hudMsg('歌曲还在路上，先来段合成音 🎹');
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

  /* ---------------- 动画系统（fx 层，辉光拖尾） ---------------- */
  const anims = [];   // 舞台层
  const fxAnims = []; // 前景层（横幅等，最后画）

  function addAnim(list, life, step) { if (list.length < 170) list.push({ t: 0, life, step }); }

  // 需要辉光质感的动画用加法混合画（画完自行复位）
  function lighter(on) { gF.globalCompositeOperation = on ? 'lighter' : 'source-over'; }

  function glow(x, y, hue) {
    addAnim(anims, .45, (dt, t) => {
      const p = easeOutCubic(t / .45);
      const r = 30 + 150 * p;
      const gr = gF.createRadialGradient(x, y, 0, x, y, r);
      lighter(true);
      gr.addColorStop(0, hsla(hue, 90, 65, .3 * (1 - p)));
      gr.addColorStop(1, hsla(hue, 90, 65, 0));
      gF.fillStyle = gr;
      gF.beginPath(); gF.arc(x, y, r, 0, TAU); gF.fill();
      lighter(false);
    });
  }

  function vRing(x, y, hue) {
    const rMax = Math.min(W, H) * rand(.3, .44);
    addAnim(anims, .85, (dt, t) => {
      lighter(true);
      const p = easeOutCubic(t / .85);
      gF.strokeStyle = hsla(hue, 92, 64, 1 - p);
      gF.lineWidth = 14 * (1 - p) + 1.5;
      gF.beginPath(); gF.arc(x, y, 12 + rMax * p, 0, TAU); gF.stroke();
      if (t > .1) {
        const p2 = easeOutCubic((t - .1) / .75);
        gF.strokeStyle = hsla(hue, 92, 72, (1 - p2) * .55);
        gF.lineWidth = 6 * (1 - p2) + 1;
        gF.beginPath(); gF.arc(x, y, 10 + rMax * .62 * p2, 0, TAU); gF.stroke();
      }
      lighter(false);
    });
  }

  function vPop(x, y, hue, seed) {
    const R = (38 + hash(seed) * 40) * Math.min(1, Math.min(W, H) / 700 + .35);
    addAnim(anims, .95, (dt, t) => {
      const s = easeOutBack(Math.min(1, t / .32));
      const alpha = t < .55 ? 1 : 1 - easeOutCubic((t - .55) / .4);
      gF.fillStyle = hsla(hue, 88, 62, .95 * alpha);
      gF.beginPath(); gF.arc(x, y, Math.max(0, R * s), 0, TAU); gF.fill();
      gF.fillStyle = hsla(hue, 88, 82, .5 * alpha);
      gF.beginPath(); gF.arc(x - R * .3 * s, y - R * .32 * s, R * .2 * s, 0, TAU); gF.fill();
    });
  }

  function vBars(x, y, hue, seed) {
    const n = 5, bw = 9, gap = 7;
    const hs = Array.from({ length: n }, (_, i) => 30 + hash(seed * 9 + i) * 90);
    addAnim(anims, 1.0, (dt, t) => {
      const alpha = t < .6 ? 1 : 1 - easeOutCubic((t - .6) / .4);
      gF.fillStyle = hsla(hue, 88, 62, .95 * alpha);
      const up = easeOutCubic(Math.min(1, t / .3));
      hs.forEach((h, i) => {
        const bh = h * up * (t > .55 ? 1 - (t - .55) / .5 : 1);
        gF.fillRect(x - (n * bw + (n - 1) * gap) / 2 + i * (bw + gap), y - bh, bw, bh);
      });
    });
  }

  function vTri(x, y, hue, seed) {
    const R = 52 + hash(seed * 3) * 40;
    addAnim(anims, .95, (dt, t) => {
      const s = easeOutBack(Math.min(1, t / .4));
      const alpha = t < .5 ? 1 : 1 - (t - .5) / .45;
      const rot = hash(seed) * TAU + t * 2.2;
      gF.fillStyle = hsla(hue, 88, 62, .9 * alpha);
      gF.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rot - Math.PI / 2 + k * TAU / 3;
        const px = x + Math.cos(a) * R * s, py = y + Math.sin(a) * R * s;
        k ? gF.lineTo(px, py) : gF.moveTo(px, py);
      }
      gF.closePath(); gF.fill();
    });
  }

  // 彩带：交给 canvas-confetti（更真实的物理与配色）；库未加载时退回简版
  function vConfetti(x, y, hue) {
    if (typeof window.confetti !== 'function') { fallbackBurst(x, y, hue); return; }
    window.confetti({
      particleCount: 36, spread: 70, startVelocity: 36,
      origin: { x: x / W, y: y / H },
      colors: paletteFor(hue),
      scalar: rand(.7, 1.15), ticks: 150, gravity: .9,
      zIndex: 6, disableForReducedMotion: true,
    });
  }

  function fallbackBurst(x, y, hue) {
    const parts = Array.from({ length: 26 }, () => {
      const a = rand(0, TAU), sp = rand(260, 720);
      return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160, w: rand(6, 12), h: rand(4, 8), rot: rand(0, TAU), vr: rand(-9, 9), hue: (hue + rand(-45, 45) + 360) % 360, die: rand(.9, 1.6) };
    });
    addAnim(anims, 1.7, (dt, t) => {
      for (const p of parts) {
        if (t > p.die) continue;
        p.vy += 880 * dt; p.vx *= (1 - 1.4 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const alpha = clamp(1 - (t - (p.die - .45)) / .45, 0, 1);
        gF.save();
        gF.translate(p.x, p.y); gF.rotate(p.rot);
        gF.fillStyle = hsla(p.hue, 90, 62, alpha);
        gF.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.cos(p.rot * 1.7))));
        gF.restore();
      }
    });
  }

  function vStar(x, y, hue, seed) {
    const R = 42 + hash(seed * 5) * 34;
    const rot0 = hash(seed) * TAU;
    addAnim(anims, 1.0, (dt, t) => {
      lighter(true);
      const s = easeOutBack(Math.min(1, t / .3));
      const alpha = t < .55 ? 1 : 1 - (t - .55) / .45;
      const rot = rot0 + 3.4 * easeOutCubic(t / 1.0);
      gF.fillStyle = hsla(hue, 92, 66, .95 * alpha);
      gF.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = (k % 2 ? R * .45 : R) * s;
        const a = rot - Math.PI / 2 + k * Math.PI / 5;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        k ? gF.lineTo(px, py) : gF.moveTo(px, py);
      }
      gF.closePath(); gF.fill();
      lighter(false);
    });
  }

  function vBalloon(x, y, hue, seed) {
    const s = 24 + hash(seed) * 18, vy = rand(115, 175), ph = rand(0, TAU);
    addAnim(anims, 4.5, (dt, t) => {
      const bx = x + Math.sin(t * 2 + ph) * 24, by = y - vy * t;
      if (by < -s * 3) return false;
      gF.strokeStyle = hsla(hue, 60, 80, .55);
      gF.lineWidth = 1.2;
      gF.beginPath();
      gF.moveTo(bx, by + s);
      gF.quadraticCurveTo(bx + Math.sin(t * 3 + ph) * 10, by + s * 2, bx, by + s * 2.9);
      gF.stroke();
      gF.fillStyle = hsla(hue, 85, 60, .95);
      gF.beginPath(); gF.ellipse(bx, by, s * .78, s, 0, 0, TAU); gF.fill();
      gF.beginPath(); gF.moveTo(bx - s * .18, by + s); gF.lineTo(bx + s * .18, by + s); gF.lineTo(bx, by + s * 1.28); gF.closePath(); gF.fill();
      gF.fillStyle = 'rgba(255,255,255,.4)';
      gF.beginPath(); gF.ellipse(bx - s * .28, by - s * .35, s * .16, s * .26, -.5, 0, TAU); gF.fill();
    });
  }

  function vRipple(x, y, hue) {
    addAnim(anims, 1.0, (dt, t) => {
      lighter(true);
      for (let k = 0; k < 3; k++) {
        const tt = t - k * .13;
        if (tt <= 0) continue;
        const p = easeOutCubic(tt / .85);
        gF.strokeStyle = hsla(hue, 88, 66, (1 - p) * .8);
        gF.lineWidth = 4 * (1 - p) + .8;
        gF.beginPath(); gF.arc(x, y, 8 + Math.min(W, H) * .3 * p, 0, TAU); gF.stroke();
      }
      lighter(false);
    });
  }

  function vArc(x, y, hue, seed) {
    const R = 74 + hash(seed * 7) * 56, a0 = hash(seed) * TAU;
    addAnim(anims, .9, (dt, t) => {
      lighter(true);
      gF.lineCap = 'round';
      const p = easeOutCubic(t / .9);
      const head = a0 + p * 2.4, span = .95 * (1 - p * .5);
      gF.strokeStyle = hsla(hue, 90, 64, 1 - p);
      gF.lineWidth = 12 * (1 - p) + 2;
      gF.beginPath(); gF.arc(x, y, R, head - span, head); gF.stroke();
      gF.lineCap = 'butt';
      lighter(false);
    });
  }

  function vNotes(x, y, hue, seed) {
    const glyphs = ['♪', '♫', '♩'];
    const ns = Array.from({ length: 3 }, (_, k) => ({ dx: (hash(seed + k) - .5) * 90, sp: rand(80, 150), size: rand(20, 42), ph: rand(0, TAU), ch: glyphs[k % glyphs.length] }));
    addAnim(anims, 1.3, (dt, t) => {
      lighter(true);
      const alpha = 1 - easeOutCubic(t / 1.3);
      gF.textAlign = 'center'; gF.textBaseline = 'middle';
      for (const n of ns) {
        gF.font = `${n.size}px system-ui`;
        gF.fillStyle = hsla(hue, 85, 78, alpha);
        gF.fillText(n.ch, x + n.dx + Math.sin(t * 3 + n.ph) * 14, y - n.sp * t);
      }
      lighter(false);
    });
  }

  function vSlide(x, y, hue, seed) {
    const vertical = hash(seed * 11) > .5;
    const bw = 26 + hash(seed * 13) * 30;
    const span = (vertical ? H : W) * .85;
    addAnim(anims, .85, (dt, t) => {
      const grow = easeOutCubic(Math.min(1, t / .35));
      const alpha = t < .45 ? .92 : .92 * (1 - (t - .45) / .4);
      gF.fillStyle = hsla(hue, 88, 62, alpha);
      if (vertical) gF.fillRect(x - bw / 2, y - span * grow / 2, bw, span * grow);
      else gF.fillRect(x - span * grow / 2, y - bw / 2, span * grow, bw);
    });
  }

  function vFirework(x, y, hue) {
    const parts = Array.from({ length: 34 }, () => {
      const a = rand(0, TAU), sp = rand(150, 500);
      return { x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, hue: (hue + rand(-35, 35) + 360) % 360, die: rand(.65, 1.15) };
    });
    addAnim(anims, 1.25, (dt, t) => {
      lighter(true);
      for (const p of parts) {
        if (t > p.die) continue;
        p.px = p.x; p.py = p.y;
        p.vy += 480 * dt; p.vx *= (1 - .8 * dt); p.vy *= (1 - .35 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        const alpha = clamp(1 - (t - (p.die - .4)) / .4, 0, 1);
        gF.strokeStyle = hsla(p.hue, 92, 68, alpha);
        gF.lineWidth = 2.2;
        gF.beginPath(); gF.moveTo(p.px, p.py); gF.lineTo(p.x, p.y); gF.stroke();
      }
      lighter(false);
    });
  }

  const VIS_FN = { ring: vRing, pop: vPop, bars: vBars, tri: vTri, confetti: vConfetti, star: vStar, balloon: vBalloon, ripple: vRipple, arc: vArc, notes: vNotes, slide: vSlide, firework: vFirework };
  function spawnVisual(type, x, y, hue, seed) {
    const fn = VIS_FN[type] || vRing;
    fn(x, y, hue, seed);
  }

  /* ---------------- 大横幅：逐字弹跳登场 ---------------- */
  const BANNER_SUB = `${FROM}祝${NAME}生日快乐 🎂`;

  function megaConfetti() {
    if (typeof window.confetti !== 'function') return;
    const gold = ['#ffd166', '#ff8fab', '#8ecae6', '#ffffff'];
    window.confetti({ particleCount: 90, spread: 78, origin: { x: .5, y: .55 }, colors: gold, scalar: 1.1, ticks: 180, zIndex: 6, disableForReducedMotion: true });
    window.confetti({ particleCount: 55, angle: 60, spread: 60, origin: { x: 0, y: .75 }, colors: gold, ticks: 180, zIndex: 6, disableForReducedMotion: true });
    window.confetti({ particleCount: 55, angle: 120, spread: 60, origin: { x: 1, y: .75 }, colors: gold, ticks: 180, zIndex: 6, disableForReducedMotion: true });
  }

  function showBanner() {
    const txt = 'HAPPY BIRTHDAY';
    addAnim(fxAnims, 3.0, (dt, t) => {
      const fs = Math.min(W * .08, 88);
      gF.textAlign = 'left'; gF.textBaseline = 'middle';
      gF.font = `900 ${fs}px system-ui, sans-serif`;
      const sp = fs * .08;
      let total = 0;
      for (const ch of txt) total += gF.measureText(ch).width + sp;
      let x = W / 2 - (total - sp) / 2;
      const cy = H * .40;
      const alphaOut = t < 2.3 ? 1 : Math.max(0, 1 - (t - 2.3) / .7);
      for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        const w = gF.measureText(ch).width;
        const at = i * .05;
        const p = t > at ? easeOutBack(Math.min(1, (t - at) / .35)) : 0;
        if (p > 0) {
          gF.save();
          gF.translate(x + w / 2, cy);
          gF.scale(p, p);
          gF.globalAlpha = alphaOut;
          gF.shadowColor = 'rgba(255,209,102,.9)';
          gF.shadowBlur = 26;
          const grad = gF.createLinearGradient(0, -fs * .55, 0, fs * .55);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(.55, '#ffd166');
          grad.addColorStop(1, '#ff8fab');
          gF.fillStyle = grad;
          gF.fillText(ch, -w / 2, 0);
          gF.restore();
        }
        x += w + sp;
      }
      const sp2 = t > .55 ? Math.min(1, (t - .55) / .4) : 0;
      if (sp2 > 0) {
        gF.globalAlpha = alphaOut * sp2;
        gF.font = `600 ${fs * .3}px system-ui, sans-serif`;
        gF.textAlign = 'center';
        gF.shadowBlur = 0;
        gF.fillStyle = 'rgba(255,255,255,.95)';
        gF.fillText(BANNER_SUB, W / 2, cy + fs * .85);
      }
      gF.globalAlpha = 1;
    });
    megaConfetti();
  }

  /* ---------------- 背景层：星空 + 流星 ---------------- */
  let bgGrad = null, stars = [];
  const meteor = { active: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0 };

  function buildBackground() {
    bgGrad = gB.createRadialGradient(W * .5, H * .4, 60, W * .5, H * .5, Math.max(W, H) * .78);
    bgGrad.addColorStop(0, '#171b36');
    bgGrad.addColorStop(1, '#0a0c1a');
    stars = Array.from({ length: Math.round(W * H / 15000) }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: rand(.4, 1.6), ph: rand(0, TAU), sp: rand(.5, 1.8),
    }));
  }

  function drawBackground(dt, tt) {
    gB.fillStyle = bgGrad;
    gB.fillRect(0, 0, W, H);
    for (const s of stars) {
      gB.globalAlpha = .22 + .3 * (0.5 + 0.5 * Math.sin(tt * s.sp + s.ph));
      gB.fillStyle = '#dfe6ff';
      gB.beginPath(); gB.arc(s.x, s.y, s.r, 0, TAU); gB.fill();
    }
    gB.globalAlpha = 1;
    // 流星：平均每 8 秒一颗
    if (!meteor.active && Math.random() < dt / 8) {
      meteor.active = true;
      meteor.x = rand(W * .3, W * 1.05); meteor.y = rand(0, H * .3);
      const sp = rand(420, 640);
      const a = rand(Math.PI * .62, Math.PI * .82);
      meteor.vx = -Math.cos(a) * sp; meteor.vy = Math.sin(a) * sp;
      meteor.t = 0; meteor.life = rand(.7, 1.0);
    }
    if (meteor.active) {
      meteor.t += dt;
      meteor.x += meteor.vx * dt; meteor.y += meteor.vy * dt;
      const p = meteor.t / meteor.life;
      if (p >= 1) { meteor.active = false; }
      else {
        const fade = Math.sin(Math.PI * p);
        const tail = 90 + 60 * fade;
        const gr = gB.createLinearGradient(meteor.x, meteor.y, meteor.x - meteor.vx * .001 * tail, meteor.y - meteor.vy * .001 * tail);
        gr.addColorStop(0, `rgba(255,255,255,${.85 * fade})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        gB.strokeStyle = gr;
        gB.lineWidth = 2;
        gB.lineCap = 'round';
        gB.beginPath();
        gB.moveTo(meteor.x, meteor.y);
        gB.lineTo(meteor.x - meteor.vx * .001 * tail, meteor.y - meteor.vy * .001 * tail);
        gB.stroke();
        gB.lineCap = 'butt';
      }
    }
  }

  /* ---------------- 双画布尺寸 ---------------- */
  let lastW = 0, lastH = 0, lastDpr = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    lastW = W; lastH = H; lastDpr = dpr;
    for (const [c, ctx] of [[bgCanvas, gB], [fxCanvas, gF]]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      // 显式锁定 CSS 尺寸：位图再怎么变，显示永远和视口 1:1，坐标系不会错位
      c.style.width = W + 'px';
      c.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
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
  const lastHit = Object.create(null);
  let lastInputT = performance.now();

  function trigger(key, px, py) {
    const pad = PADS[key];
    if (!pad) return;
    const nowT = performance.now();
    if (lastHit[key] && nowT - lastHit[key] < 60) return;
    lastHit[key] = nowT;
    lastInputT = nowT;
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
    // 开场欢迎彩带
    if (typeof window.confetti === 'function') {
      window.confetti({ particleCount: 80, spread: 75, origin: { y: .62 }, colors: paletteFor(45), ticks: 160, zIndex: 6, disableForReducedMotion: true });
    }
  }

  function setLoading(on) { document.getElementById('loading').hidden = !on; }
  function setLoadingText(t) { const el = document.getElementById('loading'); el.hidden = false; el.textContent = t; }

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
    if (e.key === 'Enter') { lastInputT = performance.now(); playMelody(); return; }
    if (PADS[key]) trigger(key);
  });

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return;
    if (!started) { start(); return; }
    // 触摸 / 点击 = 随机键，位置就在指尖
    const keys = Object.keys(PADS).filter(k => k !== ' ');
    trigger(keys[Math.floor(Math.random() * keys.length)], e.clientX, e.clientY);
  });

  fxCanvas.addEventListener('contextmenu', e => e.preventDefault());
  bgCanvas.addEventListener('contextmenu', e => e.preventDefault());

  const muteBtn = document.getElementById('mute');
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (actx && master) master.gain.linearRampToValueAtTime(muted ? 0 : .9, actx.currentTime + .06);
    muteBtn.blur();
  });

  /* ---------------- 主循环 ---------------- */
  let melodyBannerShown = false;
  let demoT = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (viewportChanged()) resize();
    const tt = now / 1000;

    // 背景层：星空 + 流星
    drawBackground(dt, tt);

    // 动画层：拖尾淡出擦除（保留上一帧 70% 的痕迹）
    gF.globalCompositeOperation = 'destination-out';
    gF.fillStyle = 'rgba(0,0,0,.3)';
    gF.fillRect(0, 0, W, H);
    gF.globalCompositeOperation = 'source-over';

    // 开场前的静默预演：隔着毛玻璃随机绽放（无声）
    if (!started) {
      demoT += dt;
      if (demoT > .9) {
        demoT = 0;
        const keys = Object.keys(PADS);
        const pad = PADS[keys[Math.floor(Math.random() * keys.length)]];
        const x = (pad.x + pad.jx) * W, y = (pad.y + pad.jy) * H;
        glow(x, y, pad.hue);
        spawnVisual(pad.visual === 'banner' ? 'ring' : pad.visual, x, y, pad.hue, pad.idx);
      }
    }

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

    // 闲置太久：提示轻轻呼吸
    document.getElementById('hud').classList.toggle('nudge', started && now - lastInputT > 6000);

    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt;
      if (a.t >= a.life || a.step(dt, a.t) === false) anims.splice(i, 1);
    }
    for (let i = fxAnims.length - 1; i >= 0; i--) {
      const a = fxAnims[i];
      a.t += dt;
      if (a.t >= a.life || a.step(dt, a.t) === false) fxAnims.splice(i, 1);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------------- 首屏文案 ---------------- */
  document.getElementById('name-line').textContent = `祝${NAME}生日快乐 🎂`;
  document.title = `🎂 ${FROM}祝${NAME}生日快乐`;
})();
