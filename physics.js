// Moteur 2D du bilboquet, simulé dans le repère du téléphone (x à droite, y vers le haut, en mètres).
// Le téléphone ne se localise jamais : la boule subit la force mesurée et les forces fictives de rotation.
(function (root) {
  const G = 9.81;

  const CONFIG = {
    stringLength: 0.26,
    ballRadius: 0.032,
    wallThickness: 0.006,
    substep: 1 / 480,
    maxSpeed: 8, // borne le déplacement par pas sous le rayon de la boule : pas de traversée de paroi
    airDamping: 0.12,
    restitution: 0.35,
    restSpeed: 0.3, // sous cette vitesse d'impact, la boule ne rebondit plus
    friction: 0.35,
    stringRestitution: 0.05,
    catchSpeed: 0.35,
    catchHold: 0.25,
  };

  // Profil de la coupelle, de gauche à droite. Le manche ne collisionne pas : en vrai, la boule passe devant.
  const CUP = [[-0.075, 0.155], [-0.06, 0.108], [-0.03, 0.09], [0.03, 0.09], [0.06, 0.108], [0.075, 0.155]];
  const RIM_X = 0.075;
  const RIM_Y = 0.155;
  const CUP_BOTTOM_Y = 0.09;

  function createState(cfg = CONFIG) {
    return { x: 0, y: -cfg.stringLength, vx: 0, vy: 0, catches: 0, caught: false, holdTime: 0, impact: 0 };
  }

  function collideCup(s, cfg) {
    const contact = cfg.ballRadius + cfg.wallThickness;
    for (let i = 0; i < CUP.length - 1; i++) {
      const [ax, ay] = CUP[i];
      const [bx, by] = CUP[i + 1];
      const ex = bx - ax;
      const ey = by - ay;
      const t = Math.min(1, Math.max(0, ((s.x - ax) * ex + (s.y - ay) * ey) / (ex * ex + ey * ey)));
      const dx = s.x - (ax + t * ex);
      const dy = s.y - (ay + t * ey);
      const d = Math.hypot(dx, dy);
      if (d >= contact) continue;
      const nx = d > 1e-9 ? dx / d : 0;
      const ny = d > 1e-9 ? dy / d : 1;
      s.x += nx * (contact - d);
      s.y += ny * (contact - d);
      const vn = s.vx * nx + s.vy * ny;
      if (vn >= 0) continue;
      const speed = -vn;
      const e = speed > cfg.restSpeed ? cfg.restitution : 0;
      const jn = (1 + e) * speed;
      s.vx += jn * nx;
      s.vy += jn * ny;
      const tx = -ny;
      const ty = nx;
      const vt = s.vx * tx + s.vy * ty;
      const jt = Math.max(-cfg.friction * jn, Math.min(cfg.friction * jn, -vt));
      s.vx += jt * tx;
      s.vy += jt * ty;
      s.impact = Math.max(s.impact, speed);
    }
  }

  function constrainString(s, cfg) {
    const d = Math.hypot(s.x, s.y);
    if (d <= cfg.stringLength) return;
    const nx = s.x / d;
    const ny = s.y / d;
    s.x = nx * cfg.stringLength;
    s.y = ny * cfg.stringLength;
    const vr = s.vx * nx + s.vy * ny;
    if (vr > 0) {
      s.vx -= (1 + cfg.stringRestitution) * vr * nx;
      s.vy -= (1 + cfg.stringRestitution) * vr * ny;
    }
  }

  function updateCatch(s, cfg, h) {
    const inCup = Math.abs(s.x) < RIM_X && s.y > CUP_BOTTOM_Y && s.y < RIM_Y + cfg.ballRadius;
    if (!inCup) {
      s.caught = false;
      s.holdTime = 0;
      return;
    }
    if (s.caught) return;
    s.holdTime = Math.hypot(s.vx, s.vy) < cfg.catchSpeed ? s.holdTime + h : 0;
    if (s.holdTime >= cfg.catchHold) {
      s.caught = true;
      s.catches++;
    }
  }

  // input : force spécifique du téléphone (fx, fy en m/s², +9.81 en y au repos debout),
  // vitesse et accélération angulaires autour de l'axe de l'écran (omega en rad/s, alpha en rad/s²).
  function step(s, input, h, cfg = CONFIG) {
    const { fx, fy, omega, alpha } = input;
    const ax = -fx + omega * omega * s.x + alpha * s.y + 2 * omega * s.vy - cfg.airDamping * s.vx;
    const ay = -fy + omega * omega * s.y - alpha * s.x - 2 * omega * s.vx - cfg.airDamping * s.vy;
    s.vx += ax * h;
    s.vy += ay * h;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed > cfg.maxSpeed) {
      s.vx *= cfg.maxSpeed / speed;
      s.vy *= cfg.maxSpeed / speed;
    }
    s.x += s.vx * h;
    s.y += s.vy * h;
    collideCup(s, cfg);
    constrainString(s, cfg);
    updateCatch(s, cfg, h);
  }

  function advance(s, input, duration, cfg = CONFIG) {
    const n = Math.max(1, Math.round(duration / cfg.substep));
    for (let i = 0; i < n; i++) step(s, input, duration / n, cfg);
  }

  // Les navigateurs ne s'accordent ni sur l'axe ni sur le signe de rotationRate : on le déduit des mesures.
  // Quand le téléphone tourne dans le plan de l'écran, la gravité mesurée tourne en sens inverse.
  function createRotationDetector() {
    const sums = { alpha: 0, beta: 0, gamma: 0 };
    let energy = 0;
    let prevAngle = null;
    const det = {
      axis: 'alpha',
      sign: 1,
      feed(fx, fy, rates, dt) {
        const inPlane = Math.hypot(fx, fy);
        if (inPlane < 6 || Math.abs(inPlane - G) > 3 || dt <= 0) {
          prevAngle = null;
          return;
        }
        const angle = Math.atan2(fy, fx);
        if (prevAngle !== null) {
          const delta = Math.atan2(Math.sin(angle - prevAngle), Math.cos(angle - prevAngle));
          const expected = (-delta / dt) * (180 / Math.PI);
          energy = energy * 0.995 + expected * expected;
          for (const k of Object.keys(sums)) sums[k] = sums[k] * 0.995 + (rates[k] || 0) * expected;
          if (energy > 2e5) {
            const best = Object.keys(sums).reduce((a, b) => (Math.abs(sums[b]) > Math.abs(sums[a]) ? b : a));
            if (Math.abs(sums[best]) > 1.5 * Math.abs(sums[det.axis])) det.axis = best;
            if (sums[det.axis] !== 0) det.sign = Math.sign(sums[det.axis]);
          }
        }
        prevAngle = angle;
      },
      omega(rates) {
        return det.sign * (rates[det.axis] || 0) * (Math.PI / 180);
      },
    };
    return det;
  }

  // Geste de référence, en [ax, ay, durée] : poussée latérale, balancier, coup vers le haut puis arrêt.
  const DEMO_GESTURE = [[25, 0, 0.1], [-25, 0, 0.1], [0, 0, 0.55], [0, 30, 0.12], [0, -30, 0.12]];

  const api = { G, CONFIG, CUP, RIM_X, RIM_Y, DEMO_GESTURE, createState, step, advance, createRotationDetector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bilboquet = api;
})(this);
