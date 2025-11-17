import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// -----------------------------
// Hybrid Solar System Simulation
// Analytic (Keplerian) baseline + N-body perturbation deltas (leapfrog)
// -----------------------------

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Physics constants & scaling (kept inline with your previous scenes)
const G = 0.2;     // gravitational constant (scene units)
const AU = 10;     // 1 AU = 10 scene units
const SUN_MASS = 330000; // sun mass in 'Earth-mass units' used earlier (keeps numbers reasonable)

// Utility: solve Kepler's equation M = E - e sin E (Newton)
function solveKepler(M, e, iterations = 10) {
  // normalize M to [-pi, pi]
  let E = M;
  for (let i = 0; i < iterations; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

// Convert orbital elements -> Cartesian position in inertial frame
function keplerToCartesian(a, e, i, omega, Omega, M, mu) {
  // Solve Kepler
  const E = solveKepler(M, e);
  // distance in orbital plane
  const r = a * (1 - e * Math.cos(E));
  // true anomaly
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const sqrt1e2 = Math.sqrt(1 - e * e);
  const nu = Math.atan2(sqrt1e2 * sinE, cosE - e);

  // position in orbital plane
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);

  // Rotate from orbital plane to inertial coordinates
  // rotation: argument of periapsis (omega), inclination (i), RAAN (Omega)
  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosw = Math.cos(omega), sinw = Math.sin(omega);
  const cosi = Math.cos(i), sini = Math.sin(i);

  // rotation matrix application (3x3) optimized for position
  const X =
    (cosO * cosw - sinO * sinw * cosi) * xOrb +
    (-cosO * sinw - sinO * cosw * cosi) * yOrb;
  const Y =
    (sinO * cosw + cosO * sinw * cosi) * xOrb +
    (-sinO * sinw + cosO * cosw * cosi) * yOrb;
  const Z = (sinw * sini) * xOrb + (cosw * sini) * yOrb;

  return v3(X, Z, Y); // swap axes if desired (keeps orbits roughly in XZ plane)
}

// Baseline solar system element definitions (semi-major axis in scene units)
function defaultBodies() {
  // Sun
  const sun = {
    id: "sun",
    name: "Sun",
    mass: SUN_MASS,
    radius: 3.5,
    color: "#ffcc66",
    fixed: true,
    // analytic baseline for "sun" is always origin
    kepler: null,
  };

  // Planets: [name, mass (earth units), radius (relative), a (AU), e, i(deg), color]
  const planetDefs = [
    ["Mercury", 0.055, 0.38, 0.387, 0.205, 7.0, "#c2b280"],
    ["Venus", 0.815, 0.95, 0.723, 0.0067, 3.39, "#d9c38a"],
    ["Earth", 1.0, 1.0, 1.0, 0.0167, 0.0, "#4da6ff"],
    ["Mars", 0.107, 0.53, 1.524, 0.0934, 1.85, "#ff704d"],
    ["Jupiter", 317.8, 11.2, 5.204, 0.0489, 1.305, "#d9a066"],
    ["Saturn", 95.2, 9.45, 9.582, 0.0565, 2.485, "#e3c179"],
    ["Uranus", 14.5, 4.0, 19.218, 0.0472, 0.773, "#aee7ff"],
    ["Neptune", 17.15, 3.9, 30.11, 0.0086, 1.770, "#497fff"],
  ];

  // choose small random offsets for orientation to avoid exact alignment
  const bodies = [sun];
  planetDefs.forEach((p, idx) => {
    const [name, mass, radiusRel, aAU, ecc, incDeg, color] = p;
    const a = aAU * AU;
    const kepler = {
      a,
      e: ecc,
      i: (incDeg * Math.PI) / 180,
      omega: (Math.random() - 0.5) * 0.5, // argument of periapsis
      Omega: (Math.random() - 0.5) * 0.5, // longitude of ascending node
      M0: Math.random() * Math.PI * 2,    // mean anomaly at t=0
    };

    // mass scaled to match SUN_MASS units (earth-mass approx. 1 unit)
    const massSim = mass; // planet masses in "earth units" relative to SUN_MASS

    // initial analytic position
    const mu = G * sun.mass;
    const n = Math.sqrt(mu / Math.pow(a, 3)); // mean motion per unit time
    const M = kepler.M0;
    const pos = keplerToCartesian(a, kepler.e, kepler.i, kepler.omega, kepler.Omega, M, mu);
    // initial small perturbation deltas (starts at zero; will be updated by integrator)
    bodies.push({
      id: name.toLowerCase(),
      name,
      mass: massSim,
      radius: Math.max(0.3, radiusRel * 0.15), // fit visually
      color,
      kepler,
      analytic: {
        a,
        n,
      },
      // these are the hybrid state deltas (perturbations from analytic baseline)
      deltaPos: v3(0, 0, 0),
      deltaVel: v3(0, 0, 0),
      // position getter will be analytic + delta
      position: pos.clone(),
      velocity: v3(0, 0, 0), // not used as main baseline — deltaVel holds perturbation
      fixed: false,
    });
  });

  return bodies;
}

// Compute baseline analytic position for body at simulation time `t`
function analyticPosition(body, t) {
  if (!body.kepler) return v3(0, 0, 0);
  const mu = G * SUN_MASS; // central gravitational parameter (sun)
  const M = body.kepler.M0 + body.analytic.n * t;
  return keplerToCartesian(
    body.kepler.a,
    body.kepler.e,
    body.kepler.i,
    body.kepler.omega,
    body.kepler.Omega,
    M,
    mu
  );
}

// Compute perturbation accelerations (exclude central sun attraction so we only compute inter-body perturbations)
// perturbAccel = sum_{j != i, j != sun} G * m_j * (r_j - r_i) / |...|^3
function perturbAcceleration(i, bodies) {
  const ai = v3(0, 0, 0);
  for (let j = 0; j < bodies.length; j++) {
    if (j === i) continue;
    const bj = bodies[j];
    // skip the sun as its attraction is accounted for analytically in the baseline
    if (bj.id === "sun") continue;
    const ri = bodies[i].analyticPos.clone().add(bodies[i].deltaPos);
    const rj = bj.analyticPos.clone().add(bj.deltaPos);
    const r = new THREE.Vector3().subVectors(rj, ri);
    const dist2 = r.lengthSq() + 1e-6;
    const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
    const aMag = G * bj.mass * invDist3;
    ai.add(r.multiplyScalar(aMag));
  }
  return ai;
}

// Leapfrog integrator for perturbation deltas (symplectic)
function leapfrogStepDeltas(bodies, dt) {
  // we step only deltaVel and deltaPos; analytic positions determine the primary motion
  const half = dt * 0.5;
  // compute analytic positions at current time (b.analyticPos must be set externally)
  const accs = new Array(bodies.length).fill(null).map(() => v3(0, 0, 0));

  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === "sun") continue;
    accs[i] = perturbAcceleration(i, bodies);
  }

  // half-kick: v += a * dt/2
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === "sun") continue;
    bodies[i].deltaVel.add(accs[i].clone().multiplyScalar(half));
  }

  // drift: x += v * dt
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === "sun") continue;
    bodies[i].deltaPos.add(bodies[i].deltaVel.clone().multiplyScalar(dt));
  }

  // compute acc at new positions (we need analyticPos updated by caller for the new time)
  const accs2 = new Array(bodies.length).fill(null).map(() => v3(0, 0, 0));
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === "sun") continue;
    accs2[i] = perturbAcceleration(i, bodies);
  }

  // second half-kick
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === "sun") continue;
    bodies[i].deltaVel.add(accs2[i].clone().multiplyScalar(half));
  }
}

// Predictive path for a single body using hybrid forward-simulation
function calculatePredictedPath(bodyId, bodies, t0, steps = 150, stepSize = 0.1) {
  // We'll copy analytic kepler states and delta states and step them forward
  // focusing only on perturbation interactions (sun treated analytically)
  const copies = bodies.map((b) => ({
    id: b.id,
    name: b.name,
    mass: b.mass,
    color: b.color,
    radius: b.radius,
    kepler: b.kepler ? { ...b.kepler } : null,
    analytic: b.analytic ? { ...b.analytic } : null,
    deltaPos: b.deltaPos.clone(),
    deltaVel: b.deltaVel.clone(),
    // We'll maintain analyticPos for each step
    analyticPos: analyticPosition(b, t0).clone(),
  }));

  const path = [];
  let t = t0;

  for (let s = 0; s < steps; s++) {
    // record the desired body's hybrid position
    const cb = copies.find((c) => c.id === bodyId);
    if (cb) {
      path.push(cb.analyticPos.clone().add(cb.deltaPos));
    }

    // advance analytic time
    t += stepSize;
    // update analytic positions for all copies
    for (let k = 0; k < copies.length; k++) {
      copies[k].analyticPos = copies[k].kepler ? keplerToCartesian(
        copies[k].kepler.a,
        copies[k].kepler.e,
        copies[k].kepler.i,
        copies[k].kepler.omega,
        copies[k].kepler.Omega,
        copies[k].kepler.M0 + copies[k].analytic.n * t,
        G * SUN_MASS
      ) : v3(0, 0, 0);
    }

    // integrate deltas over stepSize using a simple leapfrog: compute perturbation accelerations from other planets
    // acc_i = sum_{j != i, j != sun} G * m_j * (r_j - r_i) / |r|^3
    // half-kick
    const half = stepSize * 0.5;
    const accs = copies.map(() => v3(0, 0, 0));
    for (let i = 0; i < copies.length; i++) {
      if (copies[i].id === "sun") continue;
      let ai = v3(0, 0, 0);
      const ri = copies[i].analyticPos.clone().add(copies[i].deltaPos);
      for (let j = 0; j < copies.length; j++) {
        if (i === j) continue;
        if (copies[j].id === "sun") continue;
        const rj = copies[j].analyticPos.clone().add(copies[j].deltaPos);
        const r = new THREE.Vector3().subVectors(rj, ri);
        const dist2 = r.lengthSq() + 1e-6;
        const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
        ai.add(r.multiplyScalar(G * copies[j].mass * invDist3));
      }
      accs[i] = ai;
    }
    for (let i = 0; i < copies.length; i++) {
      if (copies[i].id === "sun") continue;
      copies[i].deltaVel.add(accs[i].clone().multiplyScalar(half));
    }

    // drift
    for (let i = 0; i < copies.length; i++) {
      if (copies[i].id === "sun") continue;
      copies[i].deltaPos.add(copies[i].deltaVel.clone().multiplyScalar(stepSize));
    }

    // recompute accs at new positions
    const accs2 = copies.map(() => v3(0, 0, 0));
    for (let i = 0; i < copies.length; i++) {
      if (copies[i].id === "sun") continue;
      let ai = v3(0, 0, 0);
      const ri = copies[i].analyticPos.clone().add(copies[i].deltaPos);
      for (let j = 0; j < copies.length; j++) {
        if (i === j) continue;
        if (copies[j].id === "sun") continue;
        const rj = copies[j].analyticPos.clone().add(copies[j].deltaPos);
        const r = new THREE.Vector3().subVectors(rj, ri);
        const dist2 = r.lengthSq() + 1e-6;
        const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
        ai.add(r.multiplyScalar(G * copies[j].mass * invDist3));
      }
      accs2[i] = ai;
    }
    for (let i = 0; i < copies.length; i++) {
      if (copies[i].id === "sun") continue;
      copies[i].deltaVel.add(accs2[i].clone().multiplyScalar(half));
    }
  }

  return path;
}

// Planet mesh component (same as your original but uses body.position directly)
function PlanetMesh({ body, onClick, showLabel }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current) return;
    // position is updated externally (component uses body.position reference)
    ref.current.position.copy(body.position);
  });

  return (
    <mesh ref={ref} onClick={(e) => { e.stopPropagation(); onClick(body); }}>
      <sphereGeometry args={[body.radius, 32, 32]} />
      <meshStandardMaterial color={body.color} metalness={0.2} roughness={0.7} />
      {showLabel && (
        <Html distanceFactor={10} position={[0, body.radius + 0.3, 0]} center>
          <div className="bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded">{body.name}</div>
        </Html>
      )}
    </mesh>
  );
}

export default function PlanetarySimulationHybrid() {
  const [bodies, setBodies] = useState(() => defaultBodies());
  const bodiesRef = useRef();
  bodiesRef.current = bodies;

  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [timeScale, setTimeScale] = useState(1.0);
  const [showOrbits, setShowOrbits] = useState(true);
  const [predictionSteps, setPredictionSteps] = useState(150);
  const [collisionEnabled, setCollisionEnabled] = useState(false); // keep collisions off by default
  const [log, setLog] = useState([]);

  // runtime simulation time (seconds)
  const simTimeRef = useRef(0);

  // Precompute analytic positions for current sim time into each body for easier accel computations
  function updateAnalyticPositions(simTime, arr) {
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (b.id === "sun") {
        b.analyticPos = v3(0, 0, 0);
      } else {
        b.analyticPos = analyticPosition(b, simTime);
      }
      // update the exposed body.position to match analytic + delta
      b.position = b.analyticPos.clone().add(b.deltaPos);
    }
  }

  // Physics Runner: update hybrid state each frame with symplectic stepping on deltas
  function PhysicsRunner() {
    const last = useRef(performance.now());
    useFrame(() => {
      const now = performance.now();
      let dt = (now - last.current) / 1000;
      last.current = now;
      if (!running) return;
      // clamp dt to avoid explode
      dt = Math.min(dt, 0.05);
      const step = dt * timeScale;

      // copy by reference to mutate quickly
      const copy = bodiesRef.current.map((b) => ({
        ...b,
        // ensure vectors are clones so we can mutate safely
        deltaPos: b.deltaPos ? b.deltaPos.clone() : v3(0, 0, 0),
        deltaVel: b.deltaVel ? b.deltaVel.clone() : v3(0, 0, 0),
        kepler: b.kepler ? { ...b.kepler } : null,
        analytic: b.analytic ? { ...b.analytic } : null,
      }));

      // advance sim time
      simTimeRef.current += step;
      const t = simTimeRef.current;

      // set analytic positions for "copy"
      for (let i = 0; i < copy.length; i++) {
        const b = copy[i];
        if (b.id === "sun") {
          b.analyticPos = v3(0, 0, 0);
        } else {
          b.analyticPos = analyticPosition(b, t);
        }
      }

      // leapfrog step on delta states (using helper that consults analytic positions in copy)
      // Reuse the local leapfrog logic: compute accs using analyticPos + deltaPos for each planet (excluding sun)
      // half-kick
      const half = 0.5 * step;
      const accs = copy.map(() => v3(0, 0, 0));
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].id === "sun") continue;
        let ai = v3(0, 0, 0);
        const ri = copy[i].analyticPos.clone().add(copy[i].deltaPos);
        for (let j = 0; j < copy.length; j++) {
          if (i === j) continue;
          if (copy[j].id === "sun") continue; // sun is handled analytically
          const rj = copy[j].analyticPos.clone().add(copy[j].deltaPos);
          const r = new THREE.Vector3().subVectors(rj, ri);
          const dist2 = r.lengthSq() + 1e-6;
          const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
          ai.add(r.multiplyScalar(G * copy[j].mass * invDist3));
        }
        accs[i] = ai;
      }
      // apply half-kick
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].id === "sun") continue;
        copy[i].deltaVel.add(accs[i].clone().multiplyScalar(half));
      }

      // drift
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].id === "sun") continue;
        copy[i].deltaPos.add(copy[i].deltaVel.clone().multiplyScalar(step));
      }

      // recompute accs at new positions
      const accs2 = copy.map(() => v3(0, 0, 0));
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].id === "sun") continue;
        let ai = v3(0, 0, 0);
        const ri = copy[i].analyticPos.clone().add(copy[i].deltaPos);
        for (let j = 0; j < copy.length; j++) {
          if (i === j) continue;
          if (copy[j].id === "sun") continue;
          const rj = copy[j].analyticPos.clone().add(copy[j].deltaPos);
          const r = new THREE.Vector3().subVectors(rj, ri);
          const dist2 = r.lengthSq() + 1e-6;
          const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
          ai.add(r.multiplyScalar(G * copy[j].mass * invDist3));
        }
        accs2[i] = ai;
      }

      // second half-kick
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].id === "sun") continue;
        copy[i].deltaVel.add(accs2[i].clone().multiplyScalar(half));
      }

      // Update analyticPos for real bodies at new time and apply deltas
      for (let i = 0; i < copy.length; i++) {
        const cb = copy[i];
        // analytic position at time t already set earlier
        const analyticPos = cb.analyticPos.clone();
        // write back updated deltaPos/deltaVel onto bodies
        cb.position = analyticPos.clone().add(cb.deltaPos);
      }

      // collision handling if enabled (non-destructive scattering)
      if (collisionEnabled) {
        // simple scattering: if two bodies (non-sun) get closer than sum of radii, reflect delta velocities
        for (let i = 0; i < copy.length; i++) {
          for (let j = i + 1; j < copy.length; j++) {
            const A = copy[i], B = copy[j];
            if (A.id === "sun" || B.id === "sun") continue;
            const ri = A.analyticPos.clone().add(A.deltaPos);
            const rj = B.analyticPos.clone().add(B.deltaPos);
            const dist = ri.distanceTo(rj);
            if (dist <= (A.radius + B.radius) * 0.9) {
              // compute simple elastic scattering on deltaVel (mass-weighted)
              const normal = new THREE.Vector3().subVectors(rj, ri).normalize();
              const relative = A.deltaVel.clone().sub(B.deltaVel);
              const speedAlong = relative.dot(normal);
              if (speedAlong < 0) {
                // compute impulse
                const m1 = A.mass, m2 = B.mass;
                const impulse = (2 * speedAlong) / (m1 / m2 + 1);
                // apply impulses (approx)
                A.deltaVel.sub(normal.clone().multiplyScalar((impulse * m2) / (m1 + 1e-6)));
                B.deltaVel.add(normal.clone().multiplyScalar((impulse * m1) / (m2 + 1e-6)));
                setLog((L) => [`Scattering ${A.name} ↔ ${B.name}`, ...L].slice(0, 10));
              }
            }
          }
        }
      }

      // Push updated copy back to main state (but keep vector objects)
      const newBodies = copy.map((c) => {
        // find the original body and preserve kepler/analytic meta where needed
        const original = bodiesRef.current.find((b) => b.id === c.id) || {};
        return {
          ...original,
          ...c,
          deltaPos: c.deltaPos,
          deltaVel: c.deltaVel,
          position: c.analyticPos.clone().add(c.deltaPos),
        };
      });

      setBodies(newBodies);
    });
    return null;
  }

  const selected = bodies.find((b) => b.id === selectedId) || null;

  // Helper to recompute kepleric state if user edits velocity/mass/semimajor
  const recomputeKeplerFromState = (b) => {
    // If user edited mass or other properties we might want to recompute analytic elements.
    // For simplicity we'll keep kepler elements unchanged and apply edits to deltaVel/deltaPos.
    // (Full recomputation would require converting Cartesian -> orbital elements).
  };

  const updateSelected = (changes) => {
    setBodies((prev) =>
      prev.map((b) =>
        b.id === selectedId ? { ...b, ...changes } : b
      )
    );
  };

  function addPlanet() {
    const id = `p_${Math.random().toString(36).slice(2, 8)}`;
    const rAU = 4 + Math.random() * 10;
    const angle = Math.random() * Math.PI * 2;
    const a = rAU * AU;
    const kepler = {
      a,
      e: Math.random() * 0.1,
      i: (Math.random() - 0.5) * 0.2,
      omega: Math.random() * Math.PI * 2,
      Omega: Math.random() * Math.PI * 2,
      M0: Math.random() * Math.PI * 2,
    };
    const b = {
      id,
      name: `Planet ${bodies.length}`,
      mass: 2,
      radius: 0.5,
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
      kepler,
      analytic: { a, n: Math.sqrt((G * SUN_MASS) / Math.pow(a, 3)) },
      deltaPos: v3(0, 0, 0),
      deltaVel: v3(0, 0, 0),
      position: keplerToCartesian(a, kepler.e, kepler.i, kepler.omega, kepler.Omega, kepler.M0, G * SUN_MASS),
      fixed: false,
    };
    setBodies((b0) => [...b0, b]);
  }

  function reset() {
    setBodies(defaultBodies());
    setLog([]);
    setSelectedId(null);
    simTimeRef.current = 0;
  }

  // Update mass/radius/velocity helpers (modify delta states for physically plausible effect)
  const updateMass = (mass) => {
    if (selected && !selected.fixed) updateSelected({ mass: parseFloat(mass) });
  };
  const updateRadius = (radius) => {
    if (selected && !selected.fixed) updateSelected({ radius: parseFloat(radius) });
  };
  const updateVelocity = (axis, value) => {
    if (selected && !selected.fixed) {
      const newDelta = selected.deltaVel ? selected.deltaVel.clone() : v3(0, 0, 0);
      newDelta[axis] = parseFloat(value);
      updateSelected({ deltaVel: newDelta });
    }
  };

  // Predictive path component to render lines (uses calculatePredictedPath)
  function PredictiveOrbitPath({ body }) {
    const ref = useRef();
    const [geometry] = useState(() => new THREE.BufferGeometry());
    const lastUpdate = useRef(0);

    const material = useMemo(() => new THREE.LineBasicMaterial({
      color: body.color,
      opacity: 0.5,
      transparent: true,
      linewidth: 1,
    }), [body.color]);

    useFrame(() => {
      if (!ref.current || body.fixed || !showOrbits) return;
      // throttle updates for perf
      if (lastUpdate.current < 6) {
        lastUpdate.current++;
        return;
      }
      lastUpdate.current = 0;
      const pathPoints = calculatePredictedPath(body.id, bodiesRef.current, simTimeRef.current, predictionSteps, 0.2);
      if (pathPoints.length > 1) {
        const positions = new Float32Array(pathPoints.flatMap(p => [p.x, p.y, p.z]));
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.attributes.position.needsUpdate = true;
      }
    });

    useEffect(() => {
      if (body.fixed) return;
      const pathPoints = calculatePredictedPath(body.id, bodiesRef.current, simTimeRef.current, predictionSteps, 0.2);
      if (pathPoints.length > 1) {
        const positions = new Float32Array(pathPoints.flatMap(p => [p.x, p.y, p.z]));
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      }
    }, [body.id, body.mass, body.deltaVel?.x, body.deltaVel?.y, body.deltaVel?.z, predictionSteps, geometry]);

    if (body.fixed) return null;
    return <line ref={ref} geometry={geometry} material={material} />;
  }

  // Ensure initial analyticPos + delta are set for rendering on first mount
  useEffect(() => {
    const t = simTimeRef.current;
    setBodies((prev) => prev.map((b) => {
      const analyticPos = b.id === "sun" ? v3(0, 0, 0) : analyticPosition(b, t);
      const pos = analyticPos.clone().add(b.deltaPos || v3(0, 0, 0));
      return { ...b, analyticPos, position: pos };
    }));
  }, []);

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black relative">
        <Canvas camera={{ position: [0, 25, 40], fov: 60 }}>
          <ambientLight intensity={0.4} />
          <pointLight position={[0, 0, 0]} intensity={2} />

          {showOrbits && bodies.map((b) => b.id !== "sun" && (
            <PredictiveOrbitPath key={"path_" + b.id} body={b} />
          ))}

          {bodies.map((b) => (
            <PlanetMesh key={b.id} body={b} onClick={(body) => setSelectedId(body.id)} showLabel={true} />
          ))}

          <OrbitControls enablePan enableZoom />
          <PhysicsRunner />
        </Canvas>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto">
        <h2 className="text-xl font-semibold mb-2">Hybrid Solar System Simulator</h2>
        <div className="mb-2 text-sm text-gray-300">
          Analytic ellipses + N-body perturbations. Collisions off by default (realistic).
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <button className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Run"}
          </button>
          <button className="bg-green-600 hover:bg-green-500 px-3 py-1 rounded" onClick={addPlanet}>
            Add Planet
          </button>
          <button className="bg-red-600 hover:bg-red-500 px-3 py-1 rounded" onClick={reset}>
            Reset
          </button>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400">Time scale: {timeScale.toFixed(2)}</label>
          <input
            type="range"
            min="0.01"
            max="50"
            step="0.01"
            value={timeScale}
            onChange={(e) => setTimeScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400">Prediction Length: {predictionSteps}</label>
          <input
            type="range"
            min="50"
            max="400"
            step="10"
            value={predictionSteps}
            onChange={(e) => setPredictionSteps(parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="text-sm">Show Predicted Paths</label>
            <input
              type="checkbox"
              checked={showOrbits}
              onChange={(e) => setShowOrbits(e.target.checked)}
              className="w-4 h-4"
            />
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="text-sm">Enable Collisions (scattering)</label>
            <input
              type="checkbox"
              checked={collisionEnabled}
              onChange={(e) => setCollisionEnabled(e.target.checked)}
              className="w-4 h-4"
            />
          </div>
        </div>

        {/* Selected Planet Properties */}
        {selected && (
          <div className="mb-4 p-3 bg-gray-800 rounded">
            <h3 className="font-medium mb-2">Editing: {selected.name}</h3>

            {!selected.fixed && (
              <>
                {/* Mass Control */}
                <div className="mb-2">
                  <label className="block text-xs text-gray-400 mb-1">
                    Mass: {selected.mass.toFixed(3)}
                  </label>
                  <input
                    type="range"
                    min="0.01"
                    max="400"
                    step="0.01"
                    value={selected.mass}
                    onChange={(e) => updateMass(e.target.value)}
                    className="w-full"
                  />
                </div>

                {/* Radius Control */}
                <div className="mb-2">
                  <label className="block text-xs text-gray-400 mb-1">
                    Radius: {selected.radius.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="3"
                    step="0.01"
                    value={selected.radius}
                    onChange={(e) => updateRadius(e.target.value)}
                    className="w-full"
                  />
                </div>

                {/* Delta Velocity Controls */}
                <div className="mb-2">
                  <label className="block text-xs text-gray-400 mb-1">Perturbation Velocity</label>
                  <div className="space-y-1">
                    <div className="flex items-center">
                      <span className="text-xs w-8">X:</span>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.01"
                        value={selected.deltaVel?.x ?? 0}
                        onChange={(e) => updateVelocity('x', e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-xs w-12 ml-2">{(selected.deltaVel?.x ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-xs w-8">Y:</span>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.01"
                        value={selected.deltaVel?.y ?? 0}
                        onChange={(e) => updateVelocity('y', e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-xs w-12 ml-2">{(selected.deltaVel?.y ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-xs w-8">Z:</span>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.01"
                        value={selected.deltaVel?.z ?? 0}
                        onChange={(e) => updateVelocity('z', e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-xs w-12 ml-2">{(selected.deltaVel?.z ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-gray-400 mt-2">
                  Perturbation speed: {(selected.deltaVel?.length() ?? 0).toFixed(3)}
                </div>
              </>
            )}

            {selected.fixed && (
              <div className="text-sm text-yellow-400">
                This body is fixed and cannot be edited.
              </div>
            )}
          </div>
        )}

        <div className="mb-3">
          <h3 className="font-medium">Bodies</h3>
          <div className="text-sm text-gray-300">
            {bodies.map((b) => (
              <div
                key={b.id}
                className={`p-2 border rounded mt-2 cursor-pointer flex items-center justify-between ${
                  selectedId === b.id ? "border-yellow-400" : "border-gray-700"
                }`}
                onClick={() => setSelectedId(b.id)}
              >
                <div>
                  <div className="text-sm">{b.name}</div>
                  <div className="text-xs text-gray-400">
                    mass: {b.mass.toFixed(3)} • r: {b.radius.toFixed(2)}
                  </div>
                  {!b.fixed && (
                    <div className="text-xs text-gray-500">
                      perturb speed: {(b.deltaVel?.length() ?? 0).toFixed(3)}
                    </div>
                  )}
                </div>
                <div style={{ width: 14, height: 14, background: b.color, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Event Log */}
        {log.length > 0 && (
          <div className="mt-4">
            <h3 className="font-medium mb-2">Event Log</h3>
            <div className="text-xs max-h-32 overflow-y-auto">
              {log.map((entry, i) => (
                <div key={i} className="p-1 border-b border-gray-700">{entry}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}