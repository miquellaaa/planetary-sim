import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

/*
  Improved predictive ellipse generator with better visual clarity
*/
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const G = 0.12;     // gravitational constant in scene units
const AU = 15;      // Increased from 12 to 15 for more spacing
const SUN_MASS = 10000;

// Convert orbital elements -> Cartesian
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

// Improved default bodies with better spacing and visibility
function defaultBodies() {
  const sun = {
    id: "sun",
    name: "Sun",
    mass: SUN_MASS,
    radius: 4.0, // Slightly larger for better visibility
    color: "#ffaa33", // More vibrant yellow
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: false,
    kepler: null,
  };

  // Adjusted parameters: [name, massRel, radiusRel, aAU, e, incDeg, color]
  const defs = [
    ["Mercury", 0.055, 0.45, 0.45, 0.205, 7.0, "#b8a17a"], // Increased distance from 0.387 to 0.45 AU
    ["Venus", 0.815, 1.0, 0.75, 0.007, 3.39, "#e6d5b8"], // Increased radius
    ["Earth", 1.0, 1.1, 1.0, 0.017, 0.0, "#6bb5ff"], // Slightly larger and brighter blue
    ["Mars", 0.107, 0.65, 1.6, 0.094, 1.85, "#ff8c69"], // Increased radius
    ["Jupiter", 317.8, 2.2, 5.5, 0.049, 1.305, "#e0b580"], // Larger
    ["Saturn", 95.2, 1.9, 9.8, 0.056, 2.485, "#f0d9a4"], // Larger
    ["Uranus", 14.5, 1.4, 19.5, 0.047, 0.773, "#c6f7ff"], // Brighter
    ["Neptune", 17.15, 1.4, 30.5, 0.009, 1.77, "#6b9fff"], // Brighter
  ];

  const bodies = [sun];
  for (let idx = 0; idx < defs.length; idx++) {
    const [name, massRel, radiusRel, aAU, e, incDeg, color] = defs[idx];
    const a = aAU * AU;
    const i = (incDeg * Math.PI) / 180;
    const omega = (Math.random() - 0.5) * 0.4; // Reduced random variation
    const Omega = (Math.random() - 0.5) * 0.4; // Reduced random variation
    const nu = Math.random() * Math.PI * 2;
    const mass = massRel;
    const mu = G * (SUN_MASS + mass);
    const { position: posOrb, velocity: velOrb } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    const kepler = { a, e, i, omega, Omega, nu0: nu };
    bodies.push({
      id: name.toLowerCase(),
      name,
      mass,
      radius: Math.max(0.3, radiusRel * 0.2), // Increased base size
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

/* ---------- Improved predictive ellipse generator ---------- */
function computeEllipsePointsFromState(body, bodies, steps = 300) { // Increased default steps
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
    const theta = (k / steps) * Math.PI * 2;
    const rTheta = p / (1 + e * Math.cos(theta));
    const pos = unitE.clone().multiplyScalar(rTheta * Math.cos(theta))
      .add(unitPerp.clone().multiplyScalar(rTheta * Math.sin(theta)));
    const worldPos = pos.add(sun.position.clone());
    pts.push(worldPos);
  }

  return pts;
}

/* ---------- Improved Rendering components ---------- */

function PlanetMesh({ body, onClick, showLabel }) {
  const ref = useRef();
  const meshRef = useRef();
  
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.copy(body.position);
  });

  return (
    <group ref={ref}>
      <mesh 
        ref={meshRef} 
        onClick={(e) => { e.stopPropagation(); onClick(body); }}
        castShadow
        receiveShadow
      >
        <sphereGeometry args={[body.radius, 32, 32]} /> {/* Higher resolution */}
        <meshStandardMaterial 
          color={body.color} 
          metalness={0.3} 
          roughness={0.5}
          emissive={body.id === "sun" ? body.color : "#000000"}
          emissiveIntensity={body.id === "sun" ? 0.3 : 0}
        />
      </mesh>
      {showLabel && (
        <Html distanceFactor={10} position={[0, body.radius + 0.35, 0]} center>
          <div className="bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded border border-gray-600 font-medium">
            {body.name}
          </div>
        </Html>
      )}
    </group>
  );
}

function EllipseLine({ body, bodies }) {
  const ref = useRef();
  const [geometry] = useState(() => new THREE.BufferGeometry());
  const material = useMemo(() => new THREE.LineBasicMaterial({ 
    color: body.color, 
    opacity: 0.6, // Increased opacity
    transparent: true,
    linewidth: 1
  }), [body.color]);

  useEffect(() => {
    updateEllipseGeometry();
  }, [body, bodies, geometry]);

  useFrame(() => {
    updateEllipseGeometry();
  });

  const updateEllipseGeometry = () => {
    if (!ref.current) return;
    const pts = computeEllipsePointsFromState(body, bodies, 300);
    if (pts.length < 2) return;
    const positions = new Float32Array(pts.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.attributes.position.needsUpdate = true;
  };

  return <line ref={ref} geometry={geometry} material={material} />;
}

/* ---------- Main component ---------- */

export default function ImprovedSolarSystem() {
  const [bodies, setBodies] = useState(() => defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const simTimeRef = useRef(0);
  const [running, setRunning] = useState(true);
  const [timeScale, setTimeScale] = useState(0.8); // Slightly slower default
  const [selectedId, setSelectedId] = useState(null);
  const [showEllipses, setShowEllipses] = useState(true);
  const [predictionSteps, setPredictionSteps] = useState(300); // Increased default
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

      const MAX_SUB = 8; // Increased sub-steps for better accuracy
      const subSteps = Math.min(MAX_SUB, Math.ceil(step / 0.016));
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
    const a = (4 + Math.random() * 10) * AU; // Further out default
    const e = Math.random() * 0.05; // Less eccentric
    const i = (Math.random() - 0.5) * 0.1; // Less inclined
    const omega = Math.random() * Math.PI * 2;
    const Omega = Math.random() * Math.PI * 2;
    const nu = Math.random() * Math.PI * 2;
    const mass = 1 + Math.random() * 3; // Smaller default mass
    const mu = G * (SUN_MASS + mass);
    const { position, velocity } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    const p = {
      id,
      name: `Planet${bodies.length}`,
      mass,
      radius: 0.4 + Math.random() * 0.5,
      color: `hsl(${Math.random() * 360}, 70%, 65%)`, // More harmonious random colors
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

  const bgColor = "#000011"; // Dark blue instead of pure black

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black relative">
        <Canvas 
          style={{ background: bgColor }} 
          camera={{ position: [0, 60, 120], fov: 45 }} // Better initial camera
          shadows
        >
          <color attach="background" args={[bgColor]} />
          <fog attach="fog" args={[bgColor, 80, 200]} /> {/* Depth cue */}
          
          <ambientLight intensity={0.4} />
          <directionalLight 
            position={[50, 80, 50]} 
            intensity={1.2} 
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <pointLight 
            position={[0, 0, 0]} 
            intensity={2.0} 
            distance={250} 
            decay={1.5} 
            color="#ffaa33"
          />

          {showEllipses && bodies.map(b => b.id !== "sun" ? 
            <EllipseLine key={`ell_${b.id}`} body={b} bodies={bodies} /> 
          : null)}

          {bodies.map(b => (
            <PlanetMesh 
              key={b.id} 
              body={b} 
              onClick={() => setSelectedId(b.id)} 
              showLabel={true} 
            />
          ))}

          <OrbitControls 
            enablePan 
            enableZoom 
            minDistance={20}
            maxDistance={400}
            target={[0, 0, 0]}
          />
          <PhysicsRunner />
        </Canvas>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto border-l border-gray-700">
        <h2 className="text-xl font-bold mb-3 text-yellow-200">Solar System Simulator</h2>
        <div className="mb-3 text-sm text-gray-300 bg-gray-800 p-2 rounded">
          Predictive ellipses derived from instantaneous orbital elements relative to the Sun.
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded flex-1 min-w-[80px]" onClick={() => setRunning(r => !r)}>
            {running ? "⏸️ Pause" : "▶️ Run"}
          </button>
          <button className="bg-green-600 hover:bg-green-500 px-3 py-2 rounded flex-1 min-w-[80px]" onClick={addPlanet}>
            ➕ Add Planet
          </button>
          <button className="bg-red-600 hover:bg-red-500 px-3 py-2 rounded flex-1 min-w-[80px]" onClick={reset}>
            🔄 Reset
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Time Scale: {timeScale.toFixed(2)}</label>
            <input 
              type="range" 
              min="0.01" 
              max="30" 
              step="0.01" 
              value={timeScale} 
              onChange={(e) => setTimeScale(parseFloat(e.target.value))} 
              className="w-full accent-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Orbit Resolution: {predictionSteps} points</label>
            <input 
              type="range" 
              min="80" 
              max="500" 
              step="10" 
              value={predictionSteps} 
              onChange={(e) => setPredictionSteps(parseInt(e.target.value))} 
              className="w-full accent-green-500"
            />
          </div>

          <div className="flex items-center justify-between p-2 bg-gray-800 rounded">
            <label className="text-sm font-medium">Show Orbital Paths</label>
            <input 
              type="checkbox" 
              checked={showEllipses} 
              onChange={(e) => setShowEllipses(e.target.checked)} 
              className="w-5 h-5 accent-blue-500"
            />
          </div>

          <div className="flex items-center justify-between p-2 bg-gray-800 rounded">
            <label className="text-sm font-medium">Enable Collisions</label>
            <input 
              type="checkbox" 
              checked={collisionEnabled} 
              onChange={(e) => setCollisionEnabled(e.target.checked)} 
              className="w-5 h-5 accent-red-500"
            />
          </div>
        </div>

        {selected && (
          <div className="mt-6 p-4 bg-gray-800 rounded-lg border border-gray-600">
            <h3 className="font-bold text-lg mb-3 text-yellow-200">Editing: {selected.name}</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Mass: <span className="text-white font-medium">{selected.mass.toFixed(3)}</span>
                </label>
                <input 
                  type="range" 
                  min="0.01" 
                  max="400" 
                  step="0.01" 
                  value={selected.mass} 
                  onChange={(e) => updateMass(e.target.value)} 
                  className="w-full accent-purple-500"
                />
              </div>
              
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Radius: <span className="text-white font-medium">{selected.radius.toFixed(2)}</span>
                </label>
                <input 
                  type="range" 
                  min="0.1" 
                  max="5" 
                  step="0.01" 
                  value={selected.radius} 
                  onChange={(e) => updateRadius(e.target.value)} 
                  className="w-full accent-orange-500"
                />
              </div>
              
              <div>
                <label className="block text-xs text-gray-400 mb-2">Velocity Components</label>
                <div className="space-y-2">
                  {['x', 'y', 'z'].map(axis => (
                    <div key={axis} className="flex items-center space-x-2">
                      <span className="text-xs w-6 font-medium text-gray-400">{axis.toUpperCase()}:</span>
                      <input 
                        type="range" 
                        min="-10" 
                        max="10" 
                        step="0.01" 
                        value={selected.velocity[axis].toFixed(2)} 
                        onChange={(e) => updateVelocity(axis, e.target.value)} 
                        className="flex-1 accent-blue-400"
                      />
                      <span className="text-xs w-12 text-right font-mono">
                        {selected.velocity[axis].toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6">
          <h3 className="font-bold mb-3 text-yellow-200">Celestial Bodies</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {bodies.map(b => (
              <div 
                key={b.id} 
                className={`p-3 rounded cursor-pointer transition-all border ${
                  selectedId === b.id 
                    ? "border-yellow-400 bg-yellow-900 bg-opacity-20" 
                    : "border-gray-700 bg-gray-800 hover:bg-gray-750"
                }`} 
                onClick={() => setSelectedId(b.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-4 h-4 rounded-full border border-white border-opacity-30"
                      style={{ backgroundColor: b.color }}
                    />
                    <div>
                      <div className="font-medium text-sm">{b.name}</div>
                      <div className="text-xs text-gray-400">
                        m:{b.mass.toFixed(2)} • r:{b.radius.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {b.id === "sun" && <span className="text-xs text-yellow-300">⭐</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {log.length > 0 && (
          <div className="mt-6">
            <h3 className="font-bold mb-2 text-yellow-200">Event Log</h3>
            <div className="text-xs max-h-32 overflow-y-auto space-y-1 bg-gray-800 p-2 rounded">
              {log.map((entry, i) => (
                <div key={i} className="p-2 border-b border-gray-700 last:border-0 font-mono">
                  {entry}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}