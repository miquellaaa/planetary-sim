import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

/*
  Fixed predictive ellipse generator using orbital elements derived
  from instantaneous state vectors (position & velocity) relative to Sun.
  Uses your provided constants:
*/
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const G = 0.12;     // gravitational constant in scene units (user provided)
const AU = 12;      // 1 AU = 12 scene units (user provided)
const SUN_MASS = 10000; // scaled sun mass used earlier

// Convert orbital elements -> Cartesian (kept for other utilities if needed)
function orbitalElementsToState(a, e, i, omega, Omega, nu, mu) {
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);
  const h = Math.sqrt(mu * a * (1 - e * e));
  const vr = (mu / h) * e * Math.sin(nu);
  const vtheta = (mu / h) * (1 + e * Math.cos(nu));
  const vxOrb = vr * Math.cos(nu) - vtheta * Math.sin(nu);
  const vyOrb = vr * Math.sin(nu) + vtheta * Math.cos(nu);

  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosw = Math.cos(omega), sinw = Math.sin(omega);
  const cosi = Math.cos(i), sini = Math.sin(i);

  const R11 = cosO * cosw - sinO * sinw * cosi;
  const R12 = -cosO * sinw - sinO * cosw * cosi;
  const R21 = sinO * cosw + cosO * sinw * cosi;
  const R22 = -sinO * sinw + cosO * cosw * cosi;
  const R31 = sinw * sini;
  const R32 = cosw * sini;

  const pos = v3(
    R11 * xOrb + R12 * yOrb,
    R21 * xOrb + R22 * yOrb,
    R31 * xOrb + R32 * yOrb
  );

  const vel = v3(
    R11 * vxOrb + R12 * vyOrb,
    R21 * vxOrb + R22 * vyOrb,
    R31 * vxOrb + R32 * vyOrb
  );

  return { position: pos, velocity: vel };
}

// default bodies (same scaled solar-like setup from before)
function defaultBodies() {
  const sun = {
    id: "sun",
    name: "Sun",
    mass: SUN_MASS,
    radius: 3.6,
    color: "#ffd27f",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: false,
    kepler: null,
  };

  const defs = [
    ["Mercury", 0.055, 0.35, 0.387, 0.205, 7.0, "#c2b280"],
    ["Venus", 0.815, 0.9, 0.723, 0.007, 3.39, "#d9c38a"],
    ["Earth", 1.0, 1.0, 1.0, 0.017, 0.0, "#4da6ff"],
    ["Mars", 0.107, 0.55, 1.524, 0.094, 1.85, "#ff704d"],
    ["Jupiter", 317.8, 1.9, 5.204, 0.049, 1.305, "#d9a066"],
    ["Saturn", 95.2, 1.6, 9.582, 0.056, 2.485, "#e3c179"],
    ["Uranus", 14.5, 1.2, 19.218, 0.047, 0.773, "#aee7ff"],
    ["Neptune", 17.15, 1.2, 30.11, 0.009, 1.77, "#497fff"],
  ];

  const bodies = [sun];
  for (let idx = 0; idx < defs.length; idx++) {
    const [name, massRel, radiusRel, aAU, e, incDeg, color] = defs[idx];
    const a = aAU * AU;
    const i = (incDeg * Math.PI) / 180;
    const omega = (Math.random() - 0.5) * 0.6;
    const Omega = (Math.random() - 0.5) * 0.6;
    const nu = Math.random() * Math.PI * 2;
    const mass = massRel;
    const mu = G * (SUN_MASS + mass);
    const { position: posOrb, velocity: velOrb } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    const kepler = { a, e, i, omega, Omega, nu0: nu };
    bodies.push({
      id: name.toLowerCase(),
      name,
      mass,
      radius: Math.max(0.25, radiusRel * 0.18),
      color,
      position: posOrb.clone(),
      velocity: velOrb.clone(),
      delta: v3(0, 0, 0),
      kepler,
      fixed: false,
    });
  }

  // zero net momentum
  let totalMass = 0; let totalMomentum = v3(0, 0, 0);
  for (const b of bodies) { totalMass += b.mass; totalMomentum.add(b.velocity.clone().multiplyScalar(b.mass)); }
  const vCOM = totalMomentum.multiplyScalar(1 / (totalMass || 1e-6));
  for (const b of bodies) { b.velocity.sub(vCOM); }

  return bodies;
}

// N-body acceleration
function computeAccelerations(bodies) {
  const n = bodies.length;
  const accs = Array(n).fill(null).map(() => v3(0, 0, 0));
  for (let i = 0; i < n; i++) {
    const bi = bodies[i];
    const ai = accs[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const bj = bodies[j];
      const r = new THREE.Vector3().subVectors(bj.position, bi.position);
      const dist2 = r.lengthSq() + 1e-6;
      const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
      ai.add(r.multiplyScalar(G * bj.mass * invDist3));
    }
  }
  return accs;
}

/* ---------- FIXED predictive ellipse generator ----------
   derive instantaneous orbital elements from state vectors relative to Sun,
   then build the ellipse in the orbital plane using vector basis (unit_e, unit_perp).
   This avoids mismatches caused by sun wobble / perturbations.
*/
function computeEllipsePointsFromState(body, bodies, steps = 240) {
  // find sun
  const sun = bodies.find((b) => b.id === "sun");
  if (!sun) return [];

  // relative vectors r, v (body relative to sun)
  const rVec = new THREE.Vector3().subVectors(body.position, sun.position);
  const vVec = new THREE.Vector3().subVectors(body.velocity, sun.velocity);

  const r = rVec.length();
  const v2 = vVec.lengthSq();
  if (r < 1e-6 || !isFinite(r) || !isFinite(v2)) return [];

  const mu = G * (sun.mass + body.mass);

  // specific angular momentum
  const h = new THREE.Vector3().crossVectors(rVec, vVec);
  const hNorm = h.length();
  if (hNorm < 1e-8) return [];

  // eccentricity vector: e_vec = (v × h)/mu - r̂
  const vxh = new THREE.Vector3().crossVectors(vVec, h).multiplyScalar(1 / mu);
  const rHat = rVec.clone().multiplyScalar(1 / r);
  const eVec = vxh.sub(rHat);
  const e = eVec.length();

  // specific orbital energy
  const energy = 0.5 * v2 - mu / r;

  // bound orbit check (elliptic if energy < 0)
  if (!(energy < 0)) {
    // hyperbolic or parabolic — skip drawing ellipse
    return [];
  }

  // semimajor axis a
  const a = -mu / (2 * energy);
  if (!isFinite(a) || a <= 0) return [];

  // semi-latus rectum p = a (1 - e^2)
  const p = a * (1 - e * e);
  if (!(p > 0)) return [];

  // Unit vectors for orbital plane basis:
  // unit_e: direction of eccentricity vector (points from focus to periapsis)
  const unitE = eVec.clone().normalize();
  // unit_h: normal to orbital plane
  const unitH = h.clone().normalize();
  // unit_perp: completes right-handed basis in orbital plane (unit_h × unit_e)
  const unitPerp = new THREE.Vector3().crossVectors(unitH, unitE).normalize();
  if (unitPerp.length() < 1e-8) return [];

  // Build ellipse points in world coordinates (focus is at Sun position)
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const theta = (k / steps) * Math.PI * 2; // true anomaly parameter
    const rTheta = p / (1 + e * Math.cos(theta)); // radius for this true anomaly
    // position in plane: rTheta * (cos θ * unitE + sin θ * unitPerp)
    const pos = unitE.clone().multiplyScalar(rTheta * Math.cos(theta))
      .add(unitPerp.clone().multiplyScalar(rTheta * Math.sin(theta)));
    // translate from focus (sun) to world coordinates
    const worldPos = pos.add(sun.position.clone());
    pts.push(worldPos);
  }

  return pts;
}

/* ---------- Rendering components (Planet mesh + Ellipse line) ---------- */

function PlanetMesh({ body, onClick, showLabel }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.copy(body.position);
  });
  return (
    <mesh ref={ref} onClick={(e) => { e.stopPropagation(); onClick(body); }}>
      <sphereGeometry args={[body.radius, 24, 24]} />
      <meshStandardMaterial color={body.color} metalness={0.2} roughness={0.7} />
      {showLabel && (
        <Html distanceFactor={8} position={[0, body.radius + 0.28, 0]} center>
          <div className="bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded">{body.name}</div>
        </Html>
      )}
    </mesh>
  );
}

function EllipseLine({ body, bodies }) {
  const ref = useRef();
  const [geometry] = useState(() => new THREE.BufferGeometry());
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: body.color, opacity: 0.45, transparent: true }), [body.color]);

  useEffect(() => {
    if (!body) return;
    const pts = computeEllipsePointsFromState(body, bodies, 240);
    if (pts.length < 2) return;
    const positions = new Float32Array(pts.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  }, [body, bodies, body.color, geometry]);

  // update frequently in case of perturbations
  useFrame(() => {
    if (!ref.current) return;
    const pts = computeEllipsePointsFromState(body, bodies, 240);
    if (pts.length < 2) return;
    const positions = new Float32Array(pts.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.attributes.position.needsUpdate = true;
  });

  return <line ref={ref} geometry={geometry} material={material} />;
}

/* ---------- Main component (scaled N-body from earlier) ---------- */

export default function HybridNBodySolarScaledFixedPaths() {
  const [bodies, setBodies] = useState(() => defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const simTimeRef = useRef(0);
  const [running, setRunning] = useState(true);
  const [timeScale, setTimeScale] = useState(1.0);
  const [selectedId, setSelectedId] = useState(null);
  const [showEllipses, setShowEllipses] = useState(true);
  const [predictionSteps, setPredictionSteps] = useState(200);
  const [collisionEnabled, setCollisionEnabled] = useState(false);
  const [log, setLog] = useState([]);

  const selected = bodies.find(b => b.id === selectedId) || null;

  function PhysicsRunner() {
    const last = useRef(performance.now());
    useFrame(() => {
      const now = performance.now();
      let dt = (now - last.current) / 1000;
      last.current = now;
      if (!running) { last.current = now; return; }
      dt = Math.min(dt, 0.05);
      let step = dt * timeScale;
      if (step <= 0) return;

      const MAX_SUB = 6;
      const subSteps = Math.min(MAX_SUB, Math.ceil(step / 0.02));
      const subDt = step / subSteps;

      const local = bodiesRef.current.map(b => ({
        ...b,
        position: b.position.clone(),
        velocity: b.velocity.clone(),
      }));

      for (let s = 0; s < subSteps; s++) {
        const accs = computeAccelerations(local);
        for (let i = 0; i < local.length; i++) local[i].velocity.add(accs[i].clone().multiplyScalar(0.5 * subDt));
        for (let i = 0; i < local.length; i++) local[i].position.add(local[i].velocity.clone().multiplyScalar(subDt));

        // recompute accs in place
        for (let i = 0; i < local.length; i++) {
          accs[i].set(0, 0, 0);
          for (let j = 0; j < local.length; j++) {
            if (i === j) continue;
            const r = new THREE.Vector3().subVectors(local[j].position, local[i].position);
            const dist2 = r.lengthSq() + 1e-6;
            const invDist3 = 1 / Math.sqrt(dist2 * dist2 * dist2);
            accs[i].add(r.multiplyScalar(G * local[j].mass * invDist3));
          }
        }
        for (let i = 0; i < local.length; i++) local[i].velocity.add(accs[i].clone().multiplyScalar(0.5 * subDt));

        if (collisionEnabled) {
          for (let i = 0; i < local.length; i++) {
            for (let j = i + 1; j < local.length; j++) {
              const A = local[i], B = local[j];
              if (A.id === "sun" || B.id === "sun") continue;
              const dist = A.position.distanceTo(B.position);
              if (dist < (A.radius + B.radius) * 0.9) {
                const normal = new THREE.Vector3().subVectors(B.position, A.position).normalize();
                const rel = A.velocity.clone().sub(B.velocity);
                const along = rel.dot(normal);
                if (along > 0) continue;
                const m1 = A.mass, m2 = B.mass;
                const jimp = (2 * along) / (m1 / m2 + 1);
                A.velocity.sub(normal.clone().multiplyScalar((jimp * m2) / (m1 + 1e-6)));
                B.velocity.add(normal.clone().multiplyScalar((jimp * m1) / (m2 + 1e-6)));
                setLog(L => [`Scattering ${A.name} ↔ ${B.name}`, ...L].slice(0, 8));
              }
            }
          }
        }
      }

      const newBodies = local.map(lb => ({ ...lb, position: lb.position, velocity: lb.velocity }));
      simTimeRef.current += step;
      setBodies(newBodies);
    });
    return null;
  }

  // small setters for UI
  const updateMass = (val) => { if (!selected) return; const m = parseFloat(val); setBodies(prev => prev.map(b => b.id === selected.id ? { ...b, mass: m } : b)); };
  const updateRadius = (val) => { if (!selected) return; const r = parseFloat(val); setBodies(prev => prev.map(b => b.id === selected.id ? { ...b, radius: r } : b)); };
  const updateVelocity = (axis, val) => {
    if (!selected) return;
    const v = parseFloat(val);
    setBodies(prev => prev.map(b => {
      if (b.id !== selected.id) return b;
      const nv = b.velocity.clone(); nv[axis] = v;
      return { ...b, velocity: nv };
    }));
  };

  useEffect(() => {
    let broken = false;
    for (const b of bodies) {
      if (!b.position || !b.velocity) { broken = true; break; }
      if (!isFinite(b.position.x) || !isFinite(b.velocity.x)) { broken = true; break; }
    }
    if (broken) { setBodies(defaultBodies()); simTimeRef.current = 0; }
  }, []); // eslint-disable-line

  function addPlanet() {
    const id = `p_${Math.random().toString(36).slice(2, 8)}`;
    const a = (3 + Math.random() * 8) * AU;
    const e = Math.random() * 0.08;
    const i = (Math.random() - 0.5) * 0.2;
    const omega = Math.random() * Math.PI * 2;
    const Omega = Math.random() * Math.PI * 2;
    const nu = Math.random() * Math.PI * 2;
    const mass = 1 + Math.random() * 5;
    const mu = G * (SUN_MASS + mass);
    const { position, velocity } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    const p = {
      id,
      name: `P${bodies.length}`,
      mass,
      radius: 0.35 + Math.random() * 0.4,
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
      position,
      velocity,
      kepler: { a, e, i, omega, Omega, nu0: nu },
      fixed: false,
    };
    setBodies(prev => [...prev, p]);
  }

  function reset() {
    setBodies(defaultBodies());
    simTimeRef.current = 0;
    setLog([]);
    setSelectedId(null);
  }

  const bgColor = "#000000";

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black relative">
        <Canvas style={{ background: bgColor }} camera={{ position: [0, 80, 140], fov: 50 }}>
          <ambientLight intensity={0.45} />
          <directionalLight position={[50, 80, 50]} intensity={1.0} />
          <pointLight position={[0, 0, 0]} intensity={1.8} distance={200} decay={1} />

          {showEllipses && bodies.map(b => b.id !== "sun" ? <EllipseLine key={`ell_${b.id}`} body={b} bodies={bodies} /> : null)}

          {bodies.map(b => <PlanetMesh key={b.id} body={b} onClick={() => setSelectedId(b.id)} showLabel={true} />)}

          <OrbitControls enablePan enableZoom />
          <PhysicsRunner />
        </Canvas>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto">
        <h2 className="text-xl font-semibold mb-2">Scaled N-body Solar (Fixed Predictive Paths)</h2>
        <div className="mb-2 text-sm text-gray-300">Predictive ellipses are derived from instantaneous state vectors (r, v) relative to the Sun.</div>

        <div className="mb-3 flex flex-wrap gap-2">
          <button className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded" onClick={() => setRunning(r => !r)}>{running ? "Pause" : "Run"}</button>
          <button className="bg-green-600 hover:bg-green-500 px-3 py-1 rounded" onClick={addPlanet}>Add Planet</button>
          <button className="bg-red-600 hover:bg-red-500 px-3 py-1 rounded" onClick={reset}>Reset</button>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400">Time scale: {timeScale.toFixed(2)}</label>
          <input type="range" min="0.01" max="50" step="0.01" value={timeScale} onChange={(e) => setTimeScale(parseFloat(e.target.value))} className="w-full" />
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400">Prediction points: {predictionSteps}</label>
          <input type="range" min="50" max="400" step="10" value={predictionSteps} onChange={(e) => setPredictionSteps(parseInt(e.target.value))} className="w-full" />
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="text-sm">Show analytic ellipses</label>
            <input type="checkbox" checked={showEllipses} onChange={(e) => setShowEllipses(e.target.checked)} className="w-4 h-4" />
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="text-sm">Enable collision scattering</label>
            <input type="checkbox" checked={collisionEnabled} onChange={(e) => setCollisionEnabled(e.target.checked)} className="w-4 h-4" />
          </div>
        </div>

        {selected && (
          <div className="mb-4 p-3 bg-gray-800 rounded">
            <h3 className="font-medium mb-2">Editing: {selected.name}</h3>
            <div className="mb-2">
              <label className="block text-xs text-gray-400 mb-1">Mass: {selected.mass.toFixed(3)}</label>
              <input type="range" min="0.01" max="400" step="0.01" value={selected.mass} onChange={(e) => updateMass(e.target.value)} className="w-full" />
            </div>
            <div className="mb-2">
              <label className="block text-xs text-gray-400 mb-1">Radius: {selected.radius.toFixed(2)}</label>
              <input type="range" min="0.1" max="4" step="0.01" value={selected.radius} onChange={(e) => updateRadius(e.target.value)} className="w-full" />
            </div>
            <div className="mb-2">
              <label className="block text-xs text-gray-400 mb-1">Velocity (world)</label>
              <div className="space-y-1">
                <div className="flex items-center">
                  <span className="text-xs w-8">X:</span>
                  <input type="range" min="-8" max="8" step="0.01" value={selected.velocity.x.toFixed(2)} onChange={(e) => updateVelocity('x', e.target.value)} className="flex-1" />
                  <span className="text-xs w-12 ml-2">{selected.velocity.x.toFixed(2)}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-xs w-8">Y:</span>
                  <input type="range" min="-8" max="8" step="0.01" value={selected.velocity.y.toFixed(2)} onChange={(e) => updateVelocity('y', e.target.value)} className="flex-1" />
                  <span className="text-xs w-12 ml-2">{selected.velocity.y.toFixed(2)}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-xs w-8">Z:</span>
                  <input type="range" min="-8" max="8" step="0.01" value={selected.velocity.z.toFixed(2)} onChange={(e) => updateVelocity('z', e.target.value)} className="flex-1" />
                  <span className="text-xs w-12 ml-2">{selected.velocity.z.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-3">
          <h3 className="font-medium">Bodies</h3>
          <div className="text-sm text-gray-300">
            {bodies.map(b => (
              <div key={b.id} className={`p-2 border rounded mt-2 cursor-pointer flex items-center justify-between ${selectedId === b.id ? "border-yellow-400" : "border-gray-700"}`} onClick={() => setSelectedId(b.id)}>
                <div>
                  <div className="text-sm">{b.name}</div>
                  <div className="text-xs text-gray-400">m:{b.mass.toFixed(3)} • r:{b.radius.toFixed(2)}</div>
                </div>
                <div style={{ width: 14, height: 14, background: b.color, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </div>

        {log.length > 0 && (
          <div className="mt-4">
            <h3 className="font-medium mb-2">Event Log</h3>
            <div className="text-xs max-h-32 overflow-y-auto">
              {log.map((entry, i) => <div key={i} className="p-1 border-b border-gray-700">{entry}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
