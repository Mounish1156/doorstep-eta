/* ================================================================
   THE PASS — Doorstep front-end
   Plain vanilla JS. No build step, no dependencies.

   Sections:
     1  helpers + state
     2  ticket header: order number + live clock
     3  rulers (tape scrubbers)
     4  stamps + time-of-day mood
     5  split-flap digits
     6  mechanical tick sound (off by default)
     7  the run: route segments, courier, label tags
     8  render: ETA, lands-at, timeline, ticket totals
     9  predict: debounce, abort, timeout, shuffle
    10  what would change it (silent alternative predictions)
    11  recent stub tickets
    12  copy ETA + toast
    13  under-the-hood drawer
    14  init
   ================================================================ */

/* ---------- 1. helpers + state --------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const form   = $('#ticket');
const delayed = $('#delayed');
const stubsBox = $('#stubs');

const LABELS = { prep: 'KITCHEN', handoff: 'HANDOFF', ride: 'RIDE' };

const state = {
  seq: 0,
  ctrl: null,
  altCtrl: null,
  debounceId: null,
  timeoutId: null,
  shuffleId: null,
  last: null,            // {minutes, lands} of the last good estimate
  recent: [],            // last 5 estimates, memory only
  orderNo: '#0000',
};

const fmts = {
  distance:    v => (+v).toFixed(1) + ' km',
  prep:        v => v + ' min',
  experience:  v => v + ' yr' + (v == 1 ? '' : 's'),
};

function payload() {
  const fd = new FormData(form);
  return {
    distance:   +$('#distance').value,
    prep:       +$('#prep').value,
    experience: +$('#experience').value,
    vehicle:      fd.get('vehicle'),
    traffic:      fd.get('traffic'),
    weather:      fd.get('weather'),
    time_of_day:  fd.get('time_of_day'),
  };
}

function setStatus(text) { $('#t-status').textContent = text; }

/* ---------- 2. ticket header ----------------------------------- */
function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function updateClock() {
  const d = new Date();
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  $('#ord-clock').textContent =
    `${pad(d.getDate())} ${M[d.getMonth()]} ${d.getFullYear()} · ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------- 3. rulers (tape scrubbers) ------------------------- */
function syncRuler(r) {
  const inp = $('input', r);
  const min = +inp.min, max = +inp.max, v = +inp.value;
  r.style.setProperty('--p', ((v - min) / (max - min)).toFixed(4));
  const out = $('#o-' + inp.id);
  const text = fmts[inp.id](v);
  if (out) out.textContent = text;
  inp.setAttribute('aria-valuetext', text);
}

function buildRuler(r) {
  const inp = $('input', r);
  const min = +inp.min, max = +inp.max, step = +inp.step;
  const span = max - min, major = +r.dataset.major;
  r.style.setProperty('--minor', (step / span * 100).toFixed(4) + '%');
  const labs = $('.tick-labs', r);
  labs.innerHTML = '';
  for (let v = Math.ceil(min / major) * major; v <= max + 1e-9; v += major) {
    const x = ((v - min) / span * 100).toFixed(3) + '%';
    const tick = document.createElement('i');
    tick.style.left = x;
    labs.appendChild(tick);
    const lab = document.createElement('span');
    lab.style.left = x;
    lab.textContent = String(v);
    labs.appendChild(lab);
  }
}

function initRulers() {
  $$('[data-ruler]').forEach(r => {
    buildRuler(r);
    syncRuler(r);
    $('input', r).addEventListener('input', () => { syncRuler(r); queue(); });
  });
}

function syncAllRulers() { $$('[data-ruler]').forEach(syncRuler); }

/* ---------- 4. stamps + time-of-day mood ----------------------- */
function applyMood() {
  const tod = form.querySelector('input[name="time_of_day"]:checked');
  if (tod) document.body.dataset.mood = tod.value.toLowerCase();
}

/* ---------- 5. split-flap digits ------------------------------- */
class Flap {
  constructor(kind) {
    const el = document.createElement('div');
    el.className = 'flap' + (kind === 'sep' ? ' sep' : kind === 'word' ? ' word' : '');
    this.sep = kind === 'sep';
    this.timers = [];
    if (this.sep) {
      el.innerHTML = '<div class="half top"><span>:</span></div>' +
                     '<div class="half bot"><span>:</span></div>';
      this.val = ':';
    } else {
      el.innerHTML =
        '<div class="half top"><span></span></div>' +
        '<div class="half bot"><span></span></div>' +
        '<div class="half flip top"><span></span></div>' +
        '<div class="half flip bot"><span></span></div>';
      this.sTop  = $('.half.top > span', el);
      this.sBot  = $('.half.bot > span', el);
      this.fTop  = $('.half.flip.top', el);
      this.fBot  = $('.half.flip.bot', el);
      this.fTopV = this.fTop.firstElementChild;
      this.fBotV = this.fBot.firstElementChild;
      this.val   = null;
    }
    this.el = el;
  }

  paint(v) {
    this.sTop.textContent = this.sBot.textContent = v;
    this.fTopV.textContent = this.fBotV.textContent = v;
  }

  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  /* old top falls away -> new top revealed; new bottom swings in and lands */
  set(v, animate) {
    if (this.sep || v === this.val) return;
    if (this.val === null || !animate || reduced()) {
      this.val = v;
      this.paint(v);
      if (animate) tick(1);
      return;
    }
    const old = this.val;
    this.val = v;
    this.clearTimers();

    /* prepare both halves while nothing is on the move */
    this.fTop.style.transition = 'none';
    this.fTop.style.transform  = 'rotateX(0deg)';
    this.fTopV.textContent = old;
    this.sTop.textContent  = v;          // hidden behind the falling top
    this.fBot.style.transition = 'none';
    this.fBot.style.transform  = 'rotateX(0deg)';
    this.fBotV.textContent = old;
    this.sBot.textContent  = old;        // stays until the new flap covers it
    void this.el.offsetWidth;

    /* phase 1 — the top card drops */
    this.fTop.style.transition = 'transform 240ms cubic-bezier(.42,.02,.78,.46)';
    this.fTop.style.transform  = 'rotateX(-90deg)';
    tick(0.45);

    /* phase 2 — the new bottom card swings in and lands */
    this.timers.push(setTimeout(() => {
      this.fBot.style.transition = 'none';
      this.fBot.style.transform  = 'rotateX(-90deg)';   // edge-on: safe to swap
      this.fBotV.textContent = v;
      void this.el.offsetWidth;
      this.fBot.style.transition = 'transform 270ms cubic-bezier(.42,.02,.78,.46)';
      this.fBot.style.transform  = 'rotateX(0deg)';
      tick(1);
    }, 120));

    /* put the fallen card back at rest (identical content: no visible pop) */
    this.timers.push(setTimeout(() => {
      this.fTop.style.transition = 'none';
      this.fTop.style.transform  = 'rotateX(0deg)';
      this.fTopV.textContent = v;
    }, 250));

    /* settle: static bottom now matches what the card shows */
    this.timers.push(setTimeout(() => {
      this.sBot.textContent = v;
      this.fBot.style.transition = 'none';
      this.fBot.style.transform  = 'rotateX(0deg)';
      this.timers = [];
    }, 415));
  }
}

const flaps = { eta: [], lands: [] };

function buildFlaps() {
  $$('[data-flaps]').forEach(box => {
    const kind = box.dataset.flaps;
    const list = [];
    const plan = kind === 'eta'
      ? ['digit', 'digit', 'digit']
      : ['digit', 'digit', 'sep', 'digit', 'digit', 'word'];
    plan.forEach(k => {
      const f = new Flap(k);
      list.push(f);
      box.appendChild(f.el);
    });
    if (kind === 'eta') {
      list.forEach(f => f.set(' ', false));
      box.classList.add('waiting');
    } else {
      list.forEach((f, i) => f.set(i === 2 ? ':' : (i === 5 ? '' : '-'), false));
    }
    flaps[kind].push(list);
  });
}

function setEta(n, animate = true) {
  const s = String(Math.max(0, Math.round(n))).padStart(3, ' ');
  flaps.eta.forEach(list =>
    list.forEach((f, i) => {
      const v = s[i] || ' ';
      if (animate) setTimeout(() => f.set(v, true), i * 55);
      else f.set(v, false);
    })
  );
}

function timeParts(d) {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { hh: pad(h), mm: pad(d.getMinutes()), ap };
}

function setLands(d, animate = true) {
  const { hh, mm, ap } = timeParts(d);
  const seq = [hh[0], hh[1], ':', mm[0], mm[1], ap];
  flaps.lands.forEach(list =>
    list.forEach((f, i) => {
      if (animate) setTimeout(() => f.set(seq[i], true), i * 42);
      else f.set(seq[i], false);
    })
  );
}

function friendlyTime(d) {
  const { hh, mm, ap } = timeParts(d);
  return `${+hh}:${mm} ${ap}`;
}

/* loading: the board shuffles gently until the answer lands */
function shuffleOn() {
  if (state.shuffleId) return;
  $$('.flaps[data-flaps="eta"]').forEach(b => b.classList.add('waiting'));
  state.shuffleId = setInterval(() => {
    flaps.eta.forEach(list =>
      list.forEach(f => f.set(String(Math.floor(Math.random() * 10)), true))
    );
  }, 130);
}
function shuffleOff() {
  clearInterval(state.shuffleId);
  state.shuffleId = null;
  $$('.flaps[data-flaps="eta"]').forEach(b => b.classList.remove('waiting'));
}

/* ---------- 6. mechanical tick sound --------------------------- */
const sound = { on: false, ctx: null, buf: null };

function ensureAudio() {
  if (sound.ctx) return sound.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const len = Math.floor(ctx.sampleRate * 0.09);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  }
  sound.ctx = ctx;
  sound.buf = buf;
  return ctx;
}

function tick(gain = 1) {
  if (!sound.on) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = sound.buf;
  src.playbackRate.value = 0.85 + Math.random() * 0.4;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400 + Math.random() * 1100;
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.13 * gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
  src.connect(bp); bp.connect(g); g.connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.09);
}

function wireSound() {
  $$('.bsound').forEach(btn => btn.addEventListener('click', () => {
    sound.on = !sound.on;
    if (sound.on) { ensureAudio(); tick(1); }
    $$('.bsound').forEach(b => {
      b.setAttribute('aria-pressed', String(sound.on));
      const use = $('use', b);
      if (use) use.setAttribute('href', sound.on ? '#i-vol-on' : '#i-vol-off');
      if (b.hasAttribute('aria-label')) {
        b.setAttribute('aria-label', sound.on ? 'Turn tick sound off' : 'Turn tick sound on');
      }
    });
  }));
}

/* ---------- 7. the run: route ---------------------------------- */
const ROUTE_D =
  'M34 150 C78 150 84 96 128 92 C172 88 176 150 224 146 ' +
  'C272 142 272 60 322 58 C372 56 372 120 414 110 C434 106 448 84 452 58';

const route = {
  svg: null, path: null, dash: null,
  segs: {}, tags: null, courier: null, courierIco: null,
  pinA: null, pinB: null, L: 0, raf: 0,
};

function initRoute() {
  route.svg      = $('#route-svg');
  route.path     = $('.rseg.s-prep');          // geometry reference (same d for all)
  route.dash     = $('#m-dash-path');
  route.tags     = $('#rtags');
  route.courier  = $('#courier');
  route.courierIco = $('#courier-ico');
  route.pinA     = $('#pin-a');
  route.pinB     = $('#pin-b');
  ['prep', 'handoff', 'ride'].forEach(k => { route.segs[k] = $(`.rseg.s-${k}`); });

  Object.values(route.segs).forEach(p => p.setAttribute('d', ROUTE_D));
  route.dash.setAttribute('d', ROUTE_D);
  route.L = route.path.getTotalLength();

  const a = route.path.getPointAtLength(0);
  const b = route.path.getPointAtLength(route.L);
  route.pinA.setAttribute('transform', `translate(${a.x} ${a.y})`);
  route.pinB.setAttribute('transform', `translate(${b.x} ${b.y})`);
  route.courier.setAttribute('transform', `translate(${a.x} ${a.y})`);
}

function makeTag(key, minutes, s, e) {
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', `rtag t-${key}`);
  const text = document.createElementNS(NS, 'text');
  const mid = route.path.getPointAtLength((s + e) / 2);
  const above = key !== 'handoff';
  const y = above ? mid.y - 21 : mid.y + 32;
  text.setAttribute('x', mid.x);
  text.setAttribute('y', y);
  text.setAttribute('text-anchor', 'middle');
  text.textContent = `${LABELS[key]} ${minutes} MIN`;
  g.appendChild(text);
  route.tags.appendChild(g);

  /* size the plate from the text, then keep it inside the frame */
  const bb = text.getBBox();
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', bb.x - 7);
  rect.setAttribute('y', bb.y - 4);
  rect.setAttribute('width', bb.width + 14);
  rect.setAttribute('height', bb.height + 8);
  rect.setAttribute('rx', 1.5);
  g.insertBefore(rect, text);

  let dx = 0, dy = 0;
  if (bb.x - 7 < 2) dx = 2 - (bb.x - 7);
  if (bb.x + bb.width + 7 > 478) dx = 478 - (bb.x + bb.width + 7);
  if (bb.y - 4 < 2) dy = 2 - (bb.y - 4);
  if (bb.y + bb.height + 4 > 184) dy = 184 - (bb.y + bb.height + 4);
  if (dx || dy) g.setAttribute('transform', `translate(${dx} ${dy})`);
  return g;
}

function renderRoute(parts, vehicle) {
  cancelAnimationFrame(route.raf);
  const keys = ['prep', 'handoff', 'ride'];
  const mins = keys.map(k => Math.max(0, Math.round(+parts[k] || 0)));
  let total = mins.reduce((a, b) => a + b, 0) || 1;

  /* visual share: keep every stage visible, then normalise back to 1 */
  let f = mins.map(v => v / total);
  const MIN = 0.08;
  let deficit = 0;
  f.forEach((v, i) => { if (v < MIN) { deficit += MIN - v; f[i] = MIN; } });
  if (deficit > 0) {
    let big = f.indexOf(Math.max(...f));
    f[big] = Math.max(f[big] - deficit, MIN);
    const sum = f.reduce((a, b) => a + b, 0);
    f = f.map(v => v / sum);
  }
  const bounds = [];
  let acc = 0;
  f.forEach(v => { bounds.push([acc * route.L, (acc + v) * route.L]); acc += v; });

  /* label tags sit on the path at each stage's midpoint */
  route.tags.innerHTML = '';
  keys.forEach((k, i) => route.tags.appendChild(makeTag(k, mins[i], bounds[i][0], bounds[i][1])));

  /* the courier rides whatever they are driving */
  route.courierIco.setAttribute('href', '#i-' + String(vehicle).toLowerCase());

  const L = route.L;
  const place = head => {
    keys.forEach((k, i) => {
      const [s, e] = bounds[i];
      const drawn = clamp(head - s, 0, e - s);
      route.segs[k].setAttribute('stroke-dasharray', `0 ${s.toFixed(2)} ${drawn.toFixed(2)} ${L.toFixed(2)}`);
    });
    const pt = route.path.getPointAtLength(clamp(head, 0, L));
    const ahead = route.path.getPointAtLength(clamp(head + 3, 0, L));
    const ang = Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180 / Math.PI;
    route.courier.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${ang.toFixed(1)})`);
  };

  if (reduced()) { place(L); return; }

  const T = 640, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    const p = Math.min((now - t0) / T, 1);
    place(ease(p) * L);
    if (p < 1) route.raf = requestAnimationFrame(step);
  };
  route.raf = requestAnimationFrame(step);
}

/* ---------- 8. render ------------------------------------------ */
function setTimeline(low, high, minutes) {
  const max = Math.max(high + 6, Math.ceil(minutes * 1.4), 30);
  $('#tl-br').style.left  = (low / max * 100).toFixed(2) + '%';
  $('#tl-br').style.width = (Math.max(high - low, 1) / max * 100).toFixed(2) + '%';
  $('#tl-nd').style.left  = (clamp(minutes, 0, max) / max * 100).toFixed(2) + '%';
  $('#tl-max').textContent = max + ' min';
  $('#tl-win').textContent = `${low}–${high} min`;
}

function setSr(text) { $$('[data-sr]').forEach(el => { el.textContent = text; }); }

/* The API rounds each stage independently, so parts can land ±1 off the
   total. handoff is the residual stage, so it absorbs the drift and the
   board's stage minutes always add up to the ETA. */
function reconcileParts(parts, minutes) {
  const p = {
    prep:    Math.max(0, Math.round(+parts.prep    || 0)),
    handoff: Math.max(0, Math.round(+parts.handoff || 0)),
    ride:    Math.max(0, Math.round(+parts.ride    || 0)),
  };
  const drift = Math.round(minutes) - (p.prep + p.handoff + p.ride);
  if (drift !== 0) p.handoff = Math.max(0, p.handoff + drift);
  return p;
}

function clearError() {
  document.body.classList.remove('is-error');
  delayed.hidden = true;
}

function showError(msg) {
  shuffleOff();
  clearError();
  document.body.classList.add('is-error');
  delayed.hidden = false;
  $('#delayed-msg').textContent = msg;
  /* rebuild the letter flaps so the flip-in replays every time */
  const box = $('#delayed-flaps');
  box.innerHTML = '';
  'DELAYED'.split('').forEach((ch, i) => {
    const el = document.createElement('div');
    el.className = 'lflap';
    el.style.setProperty('--i', i);
    el.textContent = ch;
    box.appendChild(el);
  });
  setStatus('Delayed');
}

function good(j, p) {
  clearError();
  shuffleOff();

  setEta(j.minutes);
  const lands = new Date(Date.now() + j.minutes * 60000);
  setLands(lands);
  setTimeline(j.low, j.high, j.minutes);
  renderRoute(reconcileParts(j.parts, j.minutes), p.vehicle);

  $('#t-total').textContent = j.minutes + ' min';
  $('#t-lands').textContent = friendlyTime(lands);
  setStatus('On the board');

  state.last = { minutes: j.minutes, lands };
  setCopyEnabled(true);
  setSr(`Estimated ${j.minutes} minutes. Lands at ${friendlyTime(lands)}. ` +
        `Likely between ${j.low} and ${j.high} minutes.`);

  pushRecent(p, j.minutes, lands);
  fetchAlts(p, j.minutes);
}

/* ---------- 9. predict ----------------------------------------- */
function queue() {
  clearTimeout(state.debounceId);
  state.debounceId = setTimeout(run, 260);
}
function runNow() {
  clearTimeout(state.debounceId);
  run();
}

async function run() {
  const mine = ++state.seq;
  if (state.ctrl) state.ctrl.abort();
  state.ctrl = new AbortController();
  const p = payload();

  setStatus('Firing');
  shuffleOn();
  clearTimeout(state.timeoutId);
  state.timeoutId = setTimeout(() => {
    if (mine === state.seq) {
      showError('The pass is taking too long — the kitchen may be slammed. Try again in a moment.');
    }
  }, 8000);

  try {
    const r = await fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
      signal: state.ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (mine !== state.seq) return;
    clearTimeout(state.timeoutId);
    if (!r.ok) { showError(j.error || 'Something went sideways in the kitchen.'); return; }
    good(j, p);
  } catch (err) {
    if (err.name === 'AbortError' || mine !== state.seq) return;
    clearTimeout(state.timeoutId);
    showError("Can't reach the server. Check the connection and give it another go.");
  }
}

/* ---------- 10. what would change it --------------------------- */
async function fetchAlts(base, baseMinutes) {
  if (state.altCtrl) state.altCtrl.abort();
  state.altCtrl = new AbortController();
  const mine = state.seq;

  const vehicles = $$('input[name="vehicle"]', form).map(i => i.value);
  const traffic  = $$('input[name="traffic"]', form).map(i => i.value); // Low, Medium, High

  const jobs = [];
  vehicles.filter(v => v !== base.vehicle).forEach(v =>
    jobs.push({ label: `Switch to ${v}`, body: { ...base, vehicle: v } })
  );
  const ti = traffic.indexOf(base.traffic);
  if (ti > 0) jobs.push({ label: 'If traffic clears', body: { ...base, traffic: traffic[ti - 1] } });
  if (ti < traffic.length - 1) jobs.push({ label: 'If traffic builds', body: { ...base, traffic: traffic[ti + 1] } });

  try {
    const rows = await Promise.all(jobs.map(async job => {
      const r = await fetch('/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.body),
        signal: state.altCtrl.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error);
      return { label: job.label, delta: j.minutes - baseMinutes };
    }));
    if (mine !== state.seq) return;
    renderAlts(rows);
  } catch (err) {
    /* silent: aborted, offline or a bad combo — the board keeps its last list */
  }
}

function renderAlts(rows) {
  const list = $('#alt-list');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<li class="alt-empty">Nothing left to change — every lever is already pulled.</li>';
    return;
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  rows.forEach(r => {
    const li = document.createElement('li');
    const k = document.createElement('span');
    k.className = 'alt-k';
    k.textContent = r.label;
    const dots = document.createElement('span');
    dots.className = 'alt-dots';
    const v = document.createElement('b');
    v.className = 'alt-v ' + (r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat');
    v.textContent = r.delta === 0 ? 'no change'
      : (r.delta > 0 ? '+' : '−') + Math.abs(r.delta) + ' min';
    li.append(k, dots, v);
    list.appendChild(li);
  });
}

/* ---------- 11. recent stub tickets ---------------------------- */
function pushRecent(p, minutes, lands) {
  const key = JSON.stringify(p);
  if (state.recent[0] && JSON.stringify(state.recent[0].p) === key) return;
  state.recent.unshift({ p, minutes, lands, no: state.orderNo });
  state.recent = state.recent.slice(0, 5);
  renderStubs();
}

let stubEmpty = null;

function renderStubs() {
  if (!stubEmpty) stubEmpty = $('.stubs-empty', stubsBox);
  stubsBox.innerHTML = '';
  if (!state.recent.length) {
    stubsBox.appendChild(stubEmpty);
    return;
  }
  state.recent.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stub';
    b.dataset.i = i;
    b.innerHTML =
      `<span class="stub-no">${r.no}</span>` +
      `<b>${r.minutes} min</b>` +
      `<span class="stub-meta">${fmts.distance(r.p.distance)} · ${r.p.vehicle} · ${friendlyTime(r.lands)}</span>`;
    b.addEventListener('click', () => restore(r.p));
    stubsBox.appendChild(b);
  });
}

function restore(p) {
  ['distance', 'prep', 'experience'].forEach(k => { $('#' + k).value = p[k]; });
  ['vehicle', 'traffic', 'weather', 'time_of_day'].forEach(k => {
    const r = form.querySelector(`input[name="${k}"][value="${p[k]}"]`);
    if (r) r.checked = true;
  });
  applyMood();
  syncAllRulers();
  runNow();
}

/* ---------- 12. copy ETA + toast ------------------------------- */
let toastTimer = null;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 320);
  }, 2800);
}

function setCopyEnabled(on) { $$('.bcopy').forEach(b => { b.disabled = !on; }); }

function copyEta() {
  if (!state.last) return;
  const msg =
    `Dinner lands around ${friendlyTime(state.last.lands)} (about ${state.last.minutes} min)`;
  const done = () => toast('Copied — paste it in the group chat.');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(msg).then(done).catch(() => fallbackCopy(msg, done));
  } else {
    fallbackCopy(msg, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { toast('Couldn’t copy — the message is: ' + text); }
  document.body.removeChild(ta);
}

/* ---------- 13. under-the-hood drawer -------------------------- */
function initHood() {
  const hood = $('#hood');
  const scrim = $('#hood-scrim');
  const openBtn = $('#hood-open');
  const closeBtn = $('#hood-close');
  let lastFocus = null;

  const open = () => {
    lastFocus = document.activeElement;
    hood.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => {
      hood.classList.add('open');
      scrim.classList.add('open');
    });
    closeBtn.focus();
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    hood.classList.remove('open');
    scrim.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { hood.hidden = true; scrim.hidden = true; }, 480);
    if (lastFocus) lastFocus.focus();
  };
  const onKey = e => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const f = $$('button, [href], input, [tabindex]:not([tabindex="-1"])', hood)
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
}

/* ---------- 14. init ------------------------------------------- */
function init() {
  /* order number + live stamp */
  state.orderNo = '#' + pad(Math.floor(Math.random() * 9900) + 100, 4);
  $('#ord-no').textContent = state.orderNo;
  updateClock();
  setInterval(updateClock, 1000);

  buildFlaps();
  initRulers();
  initRoute();
  applyMood();
  wireSound();
  initHood();

  /* inputs */
  form.addEventListener('change', e => {
    if (e.target && e.target.name === 'time_of_day') applyMood();
    queue();
  });
  form.addEventListener('submit', e => { e.preventDefault(); runNow(); });
  $$('.bcopy').forEach(b => b.addEventListener('click', copyEta));

  setCopyEnabled(false);
  run();                   // first estimate on load
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
