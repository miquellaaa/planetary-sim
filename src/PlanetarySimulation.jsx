import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// -----------------------------
// Planetary N-body simulation
// Single-file React component (default export)
// Uses: three, @react-three/fiber, @react-three/drei, tailwindcss
// -----------------------------

// Utility: clone Vector3
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Scaled gravitational constant for visual stability
const G = 0.2; // tweak this to taste (not real-world)

// Default bodies: 1 star + 3 planets
const defaultBodies = () => [
  {
    id: "sun",
    name: "Sun",
    mass: 4000,
    radius: 2.4,
    color: "#ffcc66",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: true,
  },
  {
    id: "earth",
    name: "Planet A",
    mass: 10,
    radius: 0.6,
    color: "#4da6ff",
    position: v3(10, 0, 0),
    velocity: v3(0, 2.1, 0),
    fixed: false,
  },
  {
    id: "mars",
    name: "Planet B",
    mass: 6,
    radius: 0.46,
    color: "#ff8a66",
    position: v3(-14, 0, 0),
    velocity: v3(0, -1.7, 0),
    fixed: false,
  },
];

// Physics integrator: Velocity Verlet-like (semi-implicit)
function stepPhysics(bodies, dt) {
  // compute accelerations
  const accs = bodies.map(() => v3(0, 0, 0));

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const bj = bodies[j];
      const r = new THREE.Vector3().subVectors(bj.position, bi.position);
      const dist2 = r.lengthSq() + 1e-6;
      const dist = Math.sqrt(dist2);
      // gravitational acceleration magnitude on i due to j
      const aMag = (G * bj.mass) / dist2;
      const a = r.normalize().multiplyScalar(aMag);
      accs[i].add(a);
    }
  }

  // Integrate velocities and positions
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.fixed) continue;
    // semi-implicit
    b.velocity.add(accs[i].clone().multiplyScalar(dt));
    b.position.add(b.velocity.clone().multiplyScalar(dt));
  }
}

// Merge two bodies (inelastic, conserve momentum, volume-conserving radius)
function mergeBodies(a, b) {
  const mass = a.mass + b.mass;
  const pos = a.position
    .clone()
    .multiplyScalar(a.mass)
    .add(b.position.clone().multiplyScalar(b.mass))
    .multiplyScalar(1 / mass);
  const vel = a.velocity
    .clone()
    .multiplyScalar(a.mass)
    .add(b.velocity.clone().multiplyScalar(b.mass))
    .multiplyScalar(1 / mass);
  // volume ~ radius^3, assume equal density
  const radius = Math.cbrt(Math.pow(a.radius, 3) + Math.pow(b.radius, 3));
  const color = a.mass >= b.mass ? a.color : b.color;
  return {
    id: `${a.id}_${b.id}_m`,
    name: `${a.name}–${b.name}`,
    mass,
    radius,
    color,
    position: pos,
    velocity: vel,
    fixed: false,
  };
}

// Compute orbital parameters relative to a central primary (usually the heaviest fixed star)
function orbitalParams(planet, primary) {
  const r = planet.position.clone().sub(primary.position);
  const v = planet.velocity.clone().sub(primary.velocity || v3(0, 0, 0));
  const rMag = r.length();
  const v2 = v.lengthSq();
  const mu = G * (primary.mass + planet.mass);

  const specificEnergy = v2 / 2 - mu / rMag; // epsilon
  // semi-major axis a = -mu / (2*epsilon) for bound orbits
  let a = null;
  if (specificEnergy < 0) {
    a = -mu / (2 * specificEnergy);
  }

  // angular momentum magnitude
  const h = r.clone().cross(v).length();

  // approximate eccentricity (scalar)
  let ecc = null;
  if (a) {
    const ecc2 = 1 - (h * h) / (mu * a);
    if (ecc2 >= 0) ecc = Math.sqrt(Math.max(0, ecc2));
  }

  // orbital period (if bound)
  let period = null;
  if (a) {
    period = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / mu);
  }

  return {
    r: rMag,
    speed: Math.sqrt(v2),
    specificEnergy,
    semiMajor: a,
    eccentricity: ecc,
    period,
    angularMomentum: h,
  };
}

// Planet mesh component
function PlanetMesh({ body, onClick, showLabel }) {
  const ref = useRef();

  useEffect(() => {
    if (ref.current) {
      ref.current.position.copy(body.position);
    }
  }, [body.position]);

  useFrame(() => {
    if (ref.current) {
      ref.current.position.copy(body.position);
    }
  });

  return (
    <mesh ref={ref} onClick={(e) => onClick(body)}>
      <sphereGeometry args={[body.radius, 32, 32]} />
      <meshStandardMaterial color={body.color} metalness={0.2} roughness={0.7} />
      {showLabel && (
        <Html distanceFactor={10} position={[0, body.radius + 0.3, 0]} center>
          <div className="bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded">
            {body.name}
          </div>
        </Html>
      )}
    </mesh>
  );
}

export default function PlanetarySimulation() {
  const [bodies, setBodies] = useState(() => defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [timeScale, setTimeScale] = useState(1.0);
  const [log, setLog] = useState([]);

  // find primary (heaviest fixed body) for orbital param display
  const primary = useMemo(() => bodies.reduce((acc, b) => (b.mass > (acc?.mass || 0) ? b : acc), null), [bodies]);

  // physics loop tied to render using useFrame inside internal component
  function PhysicsRunner() {
    const last = useRef(performance.now());

    useFrame(() => {
      const now = performance.now();
      let dt = (now - last.current) / 1000; // seconds
      last.current = now;
      if (!running) return;
      // cap dt to avoid explosion
      dt = Math.min(dt, 0.05);

      // scaled dt by timeScale
      const step = dt * timeScale;

      // copy bodies to mutable objects (avoid direct state mutation until after step)
      const copy = bodiesRef.current.map((b) => ({
        id: b.id,
        name: b.name,
        mass: b.mass,
        radius: b.radius,
        color: b.color,
        position: b.position.clone(),
        velocity: b.velocity.clone(),
        fixed: !!b.fixed,
      }));

      // step physics
      stepPhysics(copy, step);

      // collision detection & merging
      let collided = false;
      for (let i = 0; i < copy.length; i++) {
        for (let j = i + 1; j < copy.length; j++) {
          const a = copy[i];
          const b = copy[j];
          const dist = a.position.distanceTo(b.position);
          if (dist <= a.radius + b.radius && !a.fixed && !b.fixed) {
            // merge
            const merged = mergeBodies(a, b);
            // replace a with merged and remove b
            copy.splice(j, 1);
            copy.splice(i, 1, merged);
            collided = true;
            setLog((L) => [`Merged ${a.name} + ${b.name} → ${merged.name}`, ...L].slice(0, 10));
            break;
          }
        }
        if (collided) break;
      }

      // write back
      setBodies((old) => {
        // keep fixed ones from old if they exist in copy (fix flags)
        // but copy already contained fixed markers
        return copy;
      });
    });
    return null;
  }

  // select planet
  function onSelect(body) {
    setSelectedId(body.id);
  }

  const selected = bodies.find((b) => b.id === selectedId) || null;

  // update selected property helper
  function updateSelected(changes) {
    setBodies((prev) => prev.map((b) => (b.id === selectedId ? { ...b, ...changes } : b)));
  }

  function addPlanet() {
    const id = `p_${Math.random().toString(36).slice(2, 8)}`;
    const p = {
      id,
      name: `Planet ${bodies.length}`,
      mass: 4,
      radius: 0.5,
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
      position: v3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30),
      velocity: v3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0),
      fixed: false,
    };
    setBodies((p0) => [...p0, p]);
  }

  function reset() {
    setBodies(defaultBodies());
    setLog([]);
    setSelectedId(null);
  }

  // UI layout + renderer
  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black relative">
        <Canvas camera={{ position: [0, 25, 40], fov: 60 }}>
          <ambientLight intensity={0.4} />
          <pointLight position={[0, 0, 0]} intensity={2} />

          {bodies.map((b) => (
            <PlanetMesh key={b.id} body={b} onClick={onSelect} showLabel={true} />
          ))}

          <OrbitControls enablePan={true} enableZoom={true} />
          <PhysicsRunner />
        </Canvas>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto">
        <h2 className="text-xl font-semibold mb-2">3D Planetary Simulator</h2>
        <div className="mb-2 text-sm text-gray-300">Click a planet in the 3D view to edit its properties in real-time.</div>

        <div className="mb-3">
          <button
            className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded mr-2"
            onClick={() => setRunning((r) => !r)}
          >
            {running ? "Pause" : "Run"}
          </button>
          <button className="bg-green-600 hover:bg-green-500 px-3 py-1 rounded mr-2" onClick={addPlanet}>
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
            max="10"
            step="0.01"
            value={timeScale}
            onChange={(e) => setTimeScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="mb-3">
          <h3 className="font-medium">Bodies</h3>
          <div className="text-sm text-gray-300">
            {bodies.map((b) => (
              <div
                key={b.id}
                className={`p-2 border rounded mt-2 cursor-pointer flex items-center justify-between ${selectedId === b.id ? "border-yellow-400" : "border-gray-700"}`}
                onClick={() => setSelectedId(b.id)}
              >
                <div>
                  <div className="text-sm">{b.name}</div>
                  <div className="text-xs text-gray-400">mass: {b.mass.toFixed(2)} • r: {b.radius.toFixed(2)}</div>
                </div>
                <div style={{ width: 14, height: 14, background: b.color, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <h3 className="font-medium">Selected</h3>
          {selected ? (
            <div>
              <div className="text-sm mt-1">{selected.name}</div>

              <div className="text-xs text-gray-400">ID: {selected.id}</div>

              <div className="mt-2 text-sm">Mass: {selected.mass.toFixed(3)}</div>
              <input
                type="range"
                min="0.1"
                max="1000"
                step="0.1"
                value={selected.mass}
                onChange={(e) => updateSelected({ mass: parseFloat(e.target.value) })}
                className="w-full"
              />

              <div className="mt-2 text-sm">Radius: {selected.radius.toFixed(3)}</div>
              <input
                type="range"
                min="0.05"
                max="6"
                step="0.01"
                value={selected.radius}
                onChange={(e) => updateSelected({ radius: parseFloat(e.target.value) })}
                className="w-full"
              />

              <div className="mt-2 text-sm">Speed multiplier: 1× (applies to current velocity)</div>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.01"
                onChange={(e) => {
                  const f = parseFloat(e.target.value);
                  updateSelected((prev) => {
                    // scale velocity
                    const old = bodiesRef.current.find((bb) => bb.id === selected.id);
                    if (!old) return {};
                    return { velocity: old.velocity.clone().multiplyScalar(f) };
                  });
                }}
                className="w-full"
              />

              <div className="mt-3 bg-gray-800 p-2 rounded text-xs">
                <strong>Real-time values</strong>
                <div className="mt-2">
                  {primary && (
                    (() => {
                      const params = orbitalParams(selected, primary);
                      return (
                        <div>
                          <div>Distance (r): {params.r.toFixed(3)}</div>
                          <div>Speed: {params.speed.toFixed(3)}</div>
                          <div>Specific energy: {params.specificEnergy.toFixed(4)}</div>
                          <div>Semi-major axis (a): {params.semiMajor ? params.semiMajor.toFixed(3) : "—"}</div>
                          <div>Eccentricity (e): {params.eccentricity ? params.eccentricity.toFixed(3) : "—"}</div>
                          <div>Angular momentum: {params.angularMomentum.toFixed(3)}</div>
                          <div>Orbital period (s): {params.period ? params.period.toFixed(3) : "—"}</div>
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">Click a planet to see/edit its properties.</div>
          )}
        </div>

        <div className="mb-3">
          <h3 className="font-medium">Event Log</h3>
          <div className="text-xs text-gray-300 max-h-40 overflow-auto mt-1">
            {log.length === 0 ? <div className="text-gray-500">No recent events</div> : log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>

        <div className="text-xs text-gray-500 mt-4">Controls: click bodies, change mass/radius, add planets, pause/resume. Collisions merge planets (inelastic).</div>
      </div>
    </div>
  );
}