const test = require('node:test');
const assert = require('node:assert');
const B = require('./physics.js');

const REST = { fx: 0, fy: B.G, omega: 0, alpha: 0 };
const SEATED_Y = B.TIP_Y + B.CONFIG.ballRadius - B.CONFIG.holeDepth;

function playGesture(s) {
  for (const [ax, ay, d] of B.DEMO_GESTURE) {
    B.advance(s, { fx: ax, fy: B.G + ay, omega: 0, alpha: 0 }, d);
  }
}

function dropOnTip(angle, x = 0) {
  const s = B.createState();
  Object.assign(s, { x, y: B.TIP_Y + 0.06, angle, taut: false });
  B.advance(s, REST, 2);
  return s;
}

function swingAngle(s) {
  return Math.abs(Math.atan2(s.x, -s.y)) * 180 / Math.PI;
}

function swingFrom(degrees, cfg = B.CONFIG) {
  const s = B.createState(cfg);
  const a = degrees * Math.PI / 180;
  s.x = cfg.stringLength * Math.sin(a);
  s.y = -cfg.stringLength * Math.cos(a);
  return s;
}

test('la boule reste suspendue, trou vers le bas, au repos', () => {
  const s = B.createState();
  B.advance(s, REST, 2);
  assert.ok(Math.abs(s.x) < 1e-6);
  assert.ok(Math.abs(s.y + B.CONFIG.stringLength) < 1e-6);
  assert.ok(Math.abs(s.angle - B.HOLE_DOWN) < 1e-6);
});

test('sans frottement, le balancier a la période d\'un pendule simple', () => {
  const cfg = { ...B.CONFIG, airDamping: 0, stringViscous: 0, stringDry: 0 };
  const s = swingFrom(8.6, cfg);
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

test('téléphone immobile, un balancier de 30° s\'arrête en moins de 4 s', () => {
  const s = swingFrom(30);
  B.advance(s, REST, 4);
  const stopped = { x: s.x, y: s.y };
  assert.ok(swingAngle(s) < 1.5, `angle ${swingAngle(s)}`);
  B.advance(s, REST, 1);
  assert.ok(Math.hypot(s.x - stopped.x, s.y - stopped.y) < 1e-3, 'la boule doit rester immobile');
});

test('le bruit d\'une main immobile ne relance pas le balancier', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const s = B.createState();
  let worst = 0;
  for (let i = 0; i < 60 * 30; i++) {
    B.advance(s, { fx: 0.4 * rnd(), fy: B.G + 0.4 * rnd(), omega: 0.04 * rnd(), alpha: 0.5 * rnd() }, 1 / 60);
    worst = Math.max(worst, swingAngle(s));
  }
  assert.ok(worst < 1.5, `angle maximal ${worst}`);
});

test('le frottement du fil ne freine pas la boule en vol', () => {
  const s = B.createState();
  s.y = -0.1;
  s.vy = 2;
  s.taut = false;
  B.advance(s, { fx: 0, fy: 0, omega: 0, alpha: 0 }, 0.05);
  assert.ok(s.vy > 1.98, `vy ${s.vy}`);
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
  s.taut = false;
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

test('le geste de référence enfile la boule sur la pointe', () => {
  const s = B.createState();
  playGesture(s);
  B.advance(s, REST, 2);
  assert.strictEqual(s.caught, true);
  assert.strictEqual(s.catches, 1);
  assert.ok(Math.abs(s.y - SEATED_Y) < 1e-3, `y ${s.y}, attendu ${SEATED_Y}`);
  assert.ok(Math.abs(s.x) < 1e-3);
});

test('un coup trop faible ne passe pas la pointe', () => {
  const s = B.createState();
  B.advance(s, { fx: 0, fy: B.G + 12, omega: 0, alpha: 0 }, 0.08);
  B.advance(s, { fx: 0, fy: B.G - 12, omega: 0, alpha: 0 }, 0.08);
  B.advance(s, REST, 3);
  assert.strictEqual(s.catches, 0);
  assert.strictEqual(s.engaged, false);
});

test('la boule ne s\'enfile que si le trou fait face à la pointe', () => {
  assert.strictEqual(dropOnTip(B.HOLE_DOWN).catches, 1, 'trou en bas');
  assert.strictEqual(dropOnTip(B.HOLE_DOWN + 0.3).catches, 1, 'trou légèrement incliné');
  assert.strictEqual(dropOnTip(-B.HOLE_DOWN).catches, 0, 'trou en haut');
  assert.strictEqual(dropOnTip(0).catches, 0, 'trou sur le côté');
});

test('la boule rate la pointe si elle tombe trop à côté', () => {
  assert.strictEqual(dropOnTip(B.HOLE_DOWN, 0.01).catches, 1, '1 cm : le trou accueille la pointe');
  const off = dropOnTip(B.HOLE_DOWN, 0.025);
  assert.strictEqual(off.catches, 0, '2,5 cm : la boule tape à côté du trou');
  assert.ok(off.y < B.TIP_Y, 'elle retombe le long du manche');
});

test('le fil tendu redresse une boule mal orientée', () => {
  const s = B.createState();
  s.angle = B.HOLE_DOWN + 1;
  B.advance(s, REST, 3);
  assert.ok(Math.abs(s.angle - B.HOLE_DOWN) < 0.02, `angle ${s.angle}`);
});

test('la boule en vol garde son orientation quand le manche tourne', () => {
  const s = B.createState();
  s.y = -0.1;
  s.taut = false;
  const start = s.angle;
  // Le téléphone accélère sa rotation : vue de l'écran, la boule tourne en sens inverse.
  B.advance(s, { fx: 0, fy: 0, omega: 0, alpha: 10 }, 0.2);
  assert.ok(s.angle < start, `angle ${s.angle}`);
});

test('renverser le téléphone fait glisser la boule, et la réussite suivante compte à nouveau', () => {
  const s = B.createState();
  playGesture(s);
  B.advance(s, REST, 5);
  assert.strictEqual(s.catches, 1, 'une boule immobile ne compte qu\'une fois');
  B.advance(s, { fx: 0, fy: -B.G, omega: 0, alpha: 0 }, 1);
  assert.strictEqual(s.engaged, false);
  assert.strictEqual(s.caught, false);
  Object.assign(s, B.createState(), { catches: s.catches });
  playGesture(s);
  B.advance(s, REST, 2);
  assert.strictEqual(s.catches, 2);
});

test('aucune secousse ne casse la simulation ni n\'allonge le fil', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const s = B.createState();
  const cfg = B.CONFIG;
  for (let i = 0; i < 2000; i++) {
    const input = { fx: (rnd() - 0.5) * 160, fy: (rnd() - 0.5) * 160, omega: (rnd() - 0.5) * 20, alpha: (rnd() - 0.5) * 200 };
    for (let k = 0; k < 20; k++) {
      B.step(s, input, cfg.substep);
      assert.ok(Math.hypot(s.x, s.y) <= cfg.stringLength + 1e-9);
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.angle));
      assert.ok(Math.hypot(s.vx, s.vy) <= cfg.maxSpeed + 1e-9 || s.engaged);
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
