const test = require('node:test');
const assert = require('node:assert');
const B = require('./physics.js');

const REST = { fx: 0, fy: B.G, omega: 0, alpha: 0 };

function playGesture(s, mirror = 1) {
  for (const [ax, ay, d] of B.DEMO_GESTURE) {
    B.advance(s, { fx: mirror * ax, fy: B.G + ay, omega: 0, alpha: 0 }, d);
  }
}

test('la boule reste suspendue sous le point d\'attache au repos', () => {
  const s = B.createState();
  B.advance(s, REST, 2);
  assert.ok(Math.abs(s.x) < 1e-6);
  assert.ok(Math.abs(s.y + B.CONFIG.stringLength) < 1e-6);
});

test('le balancier a la période d\'un pendule simple', () => {
  const cfg = { ...B.CONFIG, airDamping: 0 };
  const s = B.createState(cfg);
  const a0 = 0.15;
  s.x = cfg.stringLength * Math.sin(a0);
  s.y = -cfg.stringLength * Math.cos(a0);
  const crossings = [];
  let prev = s.x;
  const h = cfg.substep;
  for (let t = 0; t < 4; t += h) {
    B.step(s, REST, h, cfg);
    if (prev > 0 && s.x <= 0) crossings.push(t);
    prev = s.x;
  }
  const period = crossings[1] - crossings[0];
  const expected = 2 * Math.PI * Math.sqrt(cfg.stringLength / B.G);
  assert.ok(Math.abs(period - expected) / expected < 0.01, `période ${period}, attendue ${expected}`);
});

test('accélérer le téléphone vers le bas laisse la boule monter, fil détendu', () => {
  const s = B.createState();
  B.advance(s, { fx: 0, fy: B.G - 30, omega: 0, alpha: 0 }, 0.1);
  assert.ok(s.vy > 1, `vy ${s.vy}`);
  assert.ok(Math.hypot(s.x, s.y) < B.CONFIG.stringLength);
});

test('en chute libre, la boule ne bouge plus par rapport au téléphone', () => {
  const s = B.createState();
  s.x = 0.1;
  s.y = -0.1;
  B.advance(s, { fx: 0, fy: 0, omega: 0, alpha: 0 }, 0.5);
  assert.ok(Math.abs(s.x - 0.1) < 1e-9 && Math.abs(s.y + 0.1) < 1e-9);
});

test('les forces de rotation reproduisent une trajectoire rectiligne vue depuis le téléphone', () => {
  // Une boule libre va tout droit ; vue d'un repère qui tourne, sa position doit suivre la rotation inverse.
  const cfg = { ...B.CONFIG, airDamping: 0, stringLength: 1000, maxSpeed: 1000, catchHold: Infinity };
  const omega = 2;
  const p0 = [5, -3];
  const v0 = [1, 0.5];
  const s = B.createState(cfg);
  s.x = p0[0];
  s.y = p0[1];
  // Vitesse dans le repère tournant : v_rot = v - omega × r
  s.vx = v0[0] + omega * p0[1];
  s.vy = v0[1] - omega * p0[0];
  const h = 1 / 4800;
  const T = 1;
  for (let i = 0; i < T / h; i++) B.step(s, { fx: 0, fy: 0, omega, alpha: 0 }, h, cfg);
  const ix = p0[0] + v0[0] * T;
  const iy = p0[1] + v0[1] * T;
  const c = Math.cos(-omega * T);
  const n = Math.sin(-omega * T);
  assert.ok(Math.abs(s.x - (c * ix - n * iy)) < 0.02, `x ${s.x}`);
  assert.ok(Math.abs(s.y - (n * ix + c * iy)) < 0.02, `y ${s.y}`);
});

test('le geste de référence attrape la boule, dans les deux sens', () => {
  for (const mirror of [1, -1]) {
    const s = B.createState();
    playGesture(s, mirror);
    B.advance(s, REST, 2);
    assert.strictEqual(s.caught, true, `sens ${mirror}`);
    assert.strictEqual(s.catches, 1);
  }
});

test('secouer sans viser n\'attrape pas la boule à tous les coups', () => {
  const s = B.createState();
  B.advance(s, { fx: 0, fy: B.G + 30, omega: 0, alpha: 0 }, 0.12);
  B.advance(s, { fx: 0, fy: B.G - 30, omega: 0, alpha: 0 }, 0.12);
  B.advance(s, REST, 2);
  assert.strictEqual(s.catches, 0, 'un coup droit bute sous la coupelle');
});

test('renverser le téléphone fait tomber la boule, et la réussite suivante compte à nouveau', () => {
  const s = B.createState();
  playGesture(s);
  B.advance(s, REST, 2);
  assert.strictEqual(s.caught, true);
  B.advance(s, REST, 3);
  assert.strictEqual(s.catches, 1, 'une boule immobile ne compte qu\'une fois');
  B.advance(s, { fx: 0, fy: -B.G, omega: 0, alpha: 0 }, 1);
  assert.strictEqual(s.caught, false);
  Object.assign(s, B.createState(), { catches: s.catches });
  playGesture(s);
  B.advance(s, REST, 2);
  assert.strictEqual(s.catches, 2);
});

test('aucune secousse ne fait traverser la coupelle ni dépasser la longueur du fil', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const s = B.createState();
  const cfg = B.CONFIG;
  for (let i = 0; i < 2000; i++) {
    const input = { fx: (rnd() - 0.5) * 160, fy: (rnd() - 0.5) * 160, omega: (rnd() - 0.5) * 20, alpha: (rnd() - 0.5) * 200 };
    for (let k = 0; k < 20; k++) {
      B.step(s, input, cfg.substep);
      assert.ok(Math.hypot(s.x, s.y) <= cfg.stringLength + 1e-9);
      for (let j = 0; j < B.CUP.length - 1; j++) {
        const [ax, ay] = B.CUP[j];
        const [bx, by] = B.CUP[j + 1];
        const t = Math.min(1, Math.max(0, ((s.x - ax) * (bx - ax) + (s.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        const d = Math.hypot(s.x - (ax + t * (bx - ax)), s.y - (ay + t * (by - ay)));
        assert.ok(d > cfg.ballRadius * 0.5, `boule enfoncée dans la paroi (d=${d})`);
      }
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    }
  }
});

function spinPhone(det, makeRates) {
  // Rotation dans le plan de l'écran à 60 Hz, vitesse variable : la gravité mesurée tourne en sens inverse.
  let angle = Math.PI / 2;
  for (let i = 0; i < 300; i++) {
    const omegaDeg = 120 * Math.sin(i / 20);
    angle -= (omegaDeg * Math.PI / 180) / 60;
    det.feed(B.G * Math.cos(angle), B.G * Math.sin(angle), makeRates(omegaDeg), 1 / 60);
  }
}

test('le détecteur retrouve l\'axe et le signe de rotationRate', () => {
  const noise = (i) => 3 * Math.sin(i * 7);
  const cases = [
    ['alpha', 1, (w) => ({ alpha: w, beta: noise(w), gamma: noise(w + 1) })],
    ['gamma', 1, (w) => ({ alpha: noise(w), beta: noise(w + 1), gamma: w })],
    ['gamma', -1, (w) => ({ alpha: noise(w), beta: noise(w + 1), gamma: -w })],
    ['beta', -1, (w) => ({ alpha: noise(w), beta: -w, gamma: noise(w + 1) })],
  ];
  for (const [axis, sign, rates] of cases) {
    const det = B.createRotationDetector();
    spinPhone(det, rates);
    assert.strictEqual(det.axis, axis);
    assert.strictEqual(det.sign, sign);
    assert.ok(Math.abs(det.omega({ [axis]: sign * 90 }) - Math.PI / 2) < 1e-9);
  }
});

test('le détecteur garde sa valeur par défaut sans vraie rotation', () => {
  const det = B.createRotationDetector();
  for (let i = 0; i < 300; i++) det.feed(0, B.G, { alpha: 1, beta: 2, gamma: 1 }, 1 / 60);
  assert.strictEqual(det.axis, 'alpha');
  assert.strictEqual(det.sign, 1);
});
