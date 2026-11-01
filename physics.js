// Moteur 2D du bilboquet, simulé dans le repère du téléphone (x à droite, y vers le haut, en mètres).
// Le téléphone ne se localise jamais : la boule subit la force mesurée et les forces fictives de rotation.
(function (root) {
  const G = 9.81;
  const HOLE_DOWN = -Math.PI / 2;

  const CONFIG = {
    stringLength: 0.26,
    ballRadius: 0.032,
    holeHalfWidth: 0.016,
    holeDepth: 0.045,
    substep: 1 / 480,
    maxSpeed: 8, // borne le déplacement par pas sous le rayon de la boule : pas de traversée de la pointe
    airDamping: 0.12,
    airSpinDamping: 0.1,
    // Frottement du fil tendu : visqueux pour amortir le balancier, sec pour l'arrêter vraiment et ignorer le bruit.
    stringViscous: 1.2,
    stringDry: 0.25,
    stringSpinDamping: 6,
    stringRestitution: 0.05,
    restitution: 0.35,
    restSpeed: 0.3, // sous cette vitesse d'impact, la boule ne rebondit plus
    friction: 0.35,
    holeRestitution: 0.15,
    holeViscous: 4,
    holeDry: 1.5,
    holeSpinDamping: 20,
    holeAlign: 300,
    catchSpeed: 0.35,
    catchHold: 0.25,
    catchInsertion: 0.6,
  };

  // Le manche ne collisionne pas : en vrai, la boule monte à côté de lui, devant ou derrière.
  // Seule la pointe compte, et seulement pour une boule qui arrive par-dessus.
  const TIP_Y = 0.13;
  const SPIKE_BASE_Y = 0.07;

  function createState(cfg = CONFIG) {
    return {
      x: 0, y: -cfg.stringLength, vx: 0, vy: 0,
      angle: HOLE_DOWN, spin: 0, // direction du trou, vue depuis le centre de la boule
      taut: true, armed: false, engaged: false, insertion: 0,
      catches: 0, caught: false, holdTime: 0, impact: 0,
    };
  }

  function bounceOnTip(s, cfg, dx, dy, dist) {
    const nx = dist > 1e-9 ? dx / dist : 0;
    const ny = dist > 1e-9 ? dy / dist : 1;
    s.x += nx * (cfg.ballRadius - dist);
    s.y += ny * (cfg.ballRadius - dist);
    const vn = s.vx * nx + s.vy * ny;
    if (vn >= 0) return;
    const speed = -vn;
    const e = speed > cfg.restSpeed ? cfg.restitution : 0;
    const jn = (1 + e) * speed;
    s.vx += jn * nx;
    s.vy += jn * ny;
    // Le frottement au point de contact fait tourner la boule (sphère pleine : I = 2/5 m r²).
    const tx = -ny;
    const ty = nx;
    const slip = s.vx * tx + s.vy * ty - s.spin * cfg.ballRadius;
    const jt = Math.max(-cfg.friction * jn, Math.min(cfg.friction * jn, -slip / 3.5));
    s.vx += jt * tx;
    s.vy += jt * ty;
    s.spin -= (2.5 * jt) / cfg.ballRadius;
    s.impact = Math.max(s.impact, speed);
  }

  function collideTip(s, cfg) {
    const dx = s.x;
    const dy = s.y - TIP_Y;
    const dist = Math.hypot(dx, dy);
    if (s.y <= TIP_Y) {
      s.armed = false;
      return;
    }
    if (dist >= cfg.ballRadius) {
      s.armed = true;
      return;
    }
    if (!s.armed) return;
    // La pointe touche la boule : elle entre si elle se présente devant le trou, sinon la boule rebondit.
    const ux = Math.cos(s.angle);
    const uy = Math.sin(s.angle);
    const along = -dx * ux - dy * uy;
    const lateral = dx * uy - dy * ux;
    if (along > 0 && Math.abs(lateral) < cfg.holeHalfWidth) {
      s.engaged = true;
      return;
    }
    bounceOnTip(s, cfg, dx, dy, dist);
  }

  function slideOnSpike(s, cfg, h) {
    const ux = Math.cos(s.angle);
    const uy = Math.sin(s.angle);
    const px = -uy;
    const py = ux;
    const tipX = -s.x;
    const tipY = TIP_Y - s.y;
    const along = tipX * ux + tipY * uy;
    const lateral = tipX * px + tipY * py;
    const insertion = cfg.ballRadius - along;
    if (insertion < -0.002) {
      s.engaged = false;
      s.insertion = 0;
      return;
    }

    // Fond du trou
    const deepest = cfg.ballRadius - cfg.holeDepth;
    if (along < deepest) {
      s.x -= ux * (deepest - along);
      s.y -= uy * (deepest - along);
      const vu = s.vx * ux + s.vy * uy;
      if (vu > 0) {
        const e = vu > cfg.restSpeed ? cfg.holeRestitution : 0;
        s.vx -= (1 + e) * vu * ux;
        s.vy -= (1 + e) * vu * uy;
        s.impact = Math.max(s.impact, vu);
      }
    }

    // Plus la boule s'enfonce, plus la pointe la guide et la redresse.
    const depthRatio = Math.max(0, Math.min(1, insertion / cfg.holeDepth));
    const maxLateral = cfg.holeHalfWidth * (1 - 0.9 * depthRatio);
    if (Math.abs(lateral) > maxLateral) {
      const excess = lateral - Math.sign(lateral) * maxLateral;
      s.x += px * excess;
      s.y += py * excess;
      const vp = s.vx * px + s.vy * py;
      if (vp * excess < 0) {
        s.vx -= vp * px;
        s.vy -= vp * py;
      }
    }
    const tilt = Math.atan2(Math.sin(s.angle - HOLE_DOWN), Math.cos(s.angle - HOLE_DOWN));
    const maxTilt = 0.03 + 0.6 * (1 - depthRatio);
    if (Math.abs(tilt) > maxTilt) {
      s.angle = HOLE_DOWN + Math.sign(tilt) * maxTilt;
      s.spin = 0;
    }
    s.spin += (-cfg.holeAlign * depthRatio * tilt - cfg.holeSpinDamping * s.spin) * h;

    // Frottement de la boule sur la pointe
    const speed = Math.hypot(s.vx, s.vy);
    if (speed > 0) {
      const loss = Math.min(speed, (cfg.holeViscous * speed + cfg.holeDry * depthRatio) * h);
      s.vx -= (s.vx / speed) * loss;
      s.vy -= (s.vy / speed) * loss;
    }
    s.insertion = insertion;
  }

  function constrainString(s, cfg) {
    const d = Math.hypot(s.x, s.y);
    if (d < cfg.stringLength) {
      s.taut = false;
      return;
    }
    s.taut = true;
    const nx = s.x / d;
    const ny = s.y / d;
    s.x = nx * cfg.stringLength;
    s.y = ny * cfg.stringLength;
    const vr = s.vx * nx + s.vy * ny;
    if (vr <= 0) return;
    const j = (1 + cfg.stringRestitution) * vr;
    s.vx -= j * nx;
    s.vy -= j * ny;
    // Le fil est noué à l'opposé du trou : en tirant, il redresse la boule, trou à l'opposé du point d'attache.
    const ux = Math.cos(s.angle);
    const uy = Math.sin(s.angle);
    s.spin += (2.5 * j * (ux * ny - uy * nx)) / cfg.ballRadius;
  }

  function applyStringFriction(s, cfg, h) {
    const d = Math.hypot(s.x, s.y);
    if (d < 1e-9) return;
    const tx = -s.y / d;
    const ty = s.x / d;
    const vt = s.vx * tx + s.vy * ty;
    const loss = Math.min(Math.abs(vt), (cfg.stringViscous * Math.abs(vt) + cfg.stringDry) * h);
    s.vx -= Math.sign(vt) * loss * tx;
    s.vy -= Math.sign(vt) * loss * ty;
    s.spin *= Math.exp(-cfg.stringSpinDamping * h);
  }

  function updateCatch(s, cfg, h) {
    const seated = s.engaged && s.insertion >= cfg.catchInsertion * cfg.holeDepth;
    if (!seated) {
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
    if (s.taut && !s.engaged) applyStringFriction(s, cfg, h);
    const speed = Math.hypot(s.vx, s.vy);
    if (speed > cfg.maxSpeed) {
      s.vx *= cfg.maxSpeed / speed;
      s.vy *= cfg.maxSpeed / speed;
    }
    s.x += s.vx * h;
    s.y += s.vy * h;
    // spin est relatif au téléphone : la boule résiste aux rotations du manche.
    s.spin += (-alpha - cfg.airSpinDamping * (s.spin + omega)) * h;
    s.angle += s.spin * h;
    if (s.engaged) slideOnSpike(s, cfg, h);
    else collideTip(s, cfg);
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

  // Geste de référence, en [ax, ay, durée] : coup vers le haut puis arrêt.
  const DEMO_GESTURE = [[0, 30, 0.12], [0, -30, 0.12]];

  const api = { G, CONFIG, TIP_Y, SPIKE_BASE_Y, HOLE_DOWN, DEMO_GESTURE, createState, step, advance, createRotationDetector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bilboquet = api;
})(this);
