import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// -----------------------------------------
// Utility: new Vector3
// -----------------------------------------
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Gravitational constant (scaled)
const G = 1.0;

// ---------------------------------------------------
// DEFAULT SOLAR-SYSTEM-LIKE BODIES
// ---------------------------------------------------
const defaultBodies = () => [
  {
    id: "sun",
    name: "Sun",
    mass: 330000,
    radius: 3.5,
    color: "#ffcc66",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: true,
  },
  {
    id: "mercury",
    name: "Mercury",
    mass: 0.055,
    radius: 0.6,
    color: "#c0b090",
    position: v3(6, 0, 0),
    velocity: v3(0, 4.7, 0),
  },
  {
    id: "venus",
    name: "Venus",
    mass: 0.815,
    radius: 0.9,
    color: "#d9c59a",
    position: v3(11, 0, 0),
    velocity: v3(0, 3.5, 0),
  },
  {
    id: "earth",
    name: "Earth",
    mass: 1,
    radius: 1,
    color: "#4da6ff",
    position: v3(15, 0, 0),
    velocity: v3(0, 3.0, 0),
  },
  {
    id: "mars",
    name: "Mars",
    mass: 0.107,
    radius: 0.8,
    color: "#ff8a66",
    position: v3(22, 0, 0),
    velocity: v3(0, 2.4, 0),
  }
];

// ---------------------------------------------------
// PHYSICS UPDATE (semi-implicit)
// ---------------------------------------------------
function stepPhysics(bodies, dt) {
  const accs = bodies.map(() => v3());

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;

      const bj = bodies[j];
      const r = bj.position.clone().sub(bi.position);
      const dist2 = r.lengthSq() + 1e-6;
      const dist = Math.sqrt(dist2);

      const aMag = (G * bj.mass) / dist2;
      accs[i].add(r.multiplyScalar(aMag / dist));
    }
  }

  // integrate
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.fixed) continue;

    b.velocity.add(accs[i].clone().multiplyScalar(dt));
    b.position.add(b.velocity.clone().multiplyScalar(dt));
  }
}

// ---------------------------------------------------
// MERGE TWO BODIES
// ---------------------------------------------------
function mergeBodies(a, b) {
  const mass = a.mass + b.mass;

  const pos =
    a.position.clone().multiplyScalar(a.mass)
      .add(b.position.clone().multiplyScalar(b.mass))
      .multiplyScalar(1 / mass);

  const vel =
    a.velocity.clone().multiplyScalar(a.mass)
      .add(b.velocity.clone().multiplyScalar(b.mass))
      .multiplyScalar(1 / mass);

  const radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);
  const color = a.mass >= b.mass ? a.color : b.color;

  return {
    id: `${a.id}_${b.id}_m`,
    name: `${a.name}-${b.name}`,
    mass,
    radius,
    color,
    position: pos,
    velocity: vel,
    fixed: false,
  };
}

// ---------------------------------------------------
// ORBITAL PARAMETER CALCULATION
// ---------------------------------------------------
function orbitalParams(body, primary) {
  const r = body.position.clone().sub(primary.position);
  const v = body.velocity.clone();
  const rMag = r.length();
  const vMag2 = v.lengthSq();
  const mu = G * (body.mass + primary.mass);

  const energy = vMag2 / 2 - mu / rMag;

  let a = null;
  if (energy < 0) a = -mu / (2 * energy);

  const h = r.clone().cross(v);
  const hMag = h.length();

  let e = null;
  if (a) {
    const ecc2 = Math.max(0, 1 - (hMag * hMag) / (mu * a));
    e = Math.sqrt(ecc2);
  }

  return { a, e, r, v, h, hMag, mu };
}

// ---------------------------------------------------
// ANALYTIC ELLIPSE COMPONENT
// ---------------------------------------------------
function AnalyticEllipse({ body, primary, segments = 256 }) {
  const lineRef = useRef();

  const points = useMemo(() => {
    if (!primary || body.fixed) return [];

    const params = orbitalParams(body, primary);
    if (!params.a || !params.e) return [];

    const { a, e, h, r, v, mu } = params;

    // Orbit plane normal
    const normal = h.clone().normalize();

    // Periapsis direction (eccentricity vector)
    const eVec = v.clone().cross(h).divideScalar(mu).sub(r.clone().normalize());
    const peri = eVec.clone().normalize();

    // Complete basis (periapsis direction, orthogonal direction)
    const ortho = normal.clone().cross(peri).normalize();

    // Parametric ellipse in orbital plane
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const rOrb = (a * (1 - e * e)) / (1 + e * Math.cos(theta));

      const pos =
        peri.clone().multiplyScalar(rOrb * Math.cos(theta))
          .add(ortho.clone().multiplyScalar(rOrb * Math.sin(theta)));

      pts.push(primary.position.clone().add(pos));
    }
    return pts;

  }, [body.position, body.velocity, primary]);

  return (
    <line ref={lineRef}>
      <bufferGeometry attach="geometry" setFromPoints={points} />
      <lineBasicMaterial color={body.color} linewidth={1} opacity={0.5} transparent />
    </line>
  );
}

// ---------------------------------------------------
// ORBIT TRAIL (recent path)
// ---------------------------------------------------
function OrbitTrail({ body, maxPoints = 300 }) {
  const ref = useRef();
  const pts = useRef([]);

  useFrame(() => {
    if (!ref.current) return;

    pts.current.push(body.position.clone());
    if (pts.current.length > maxPoints) pts.current.shift();

    ref.current.geometry.setFromPoints(pts.current);
  });

  return (
    <line>
      <bufferGeometry ref={ref} />
      <lineBasicMaterial color={body.color} linewidth={1} />
    </line>
  );
}

// ---------------------------------------------------
// PLANET MESH
// ---------------------------------------------------
function PlanetMesh({ body, onClick }) {
  const ref = useRef();

  useFrame(() => {
    if (ref.current) {
      ref.current.position.copy(body.position);
    }
  });

  return (
    <mesh ref={ref} onClick={() => onClick(body)}>
      <sphereGeometry args={[body.radius, 32, 32]} />
      <meshStandardMaterial color={body.color} metalness={0.2} roughness={0.7} />
      <Html center distanceFactor={12} position={[0, body.radius + 0.3, 0]}>
        <div className="bg-black bg-opacity-50 text-white text-xs px-1 py-0.5 rounded">
          {body.name}
        </div>
      </Html>
    </mesh>
  );
}

// ---------------------------------------------------
// MAIN SIMULATION COMPONENT
// ---------------------------------------------------
export default function PlanetarySimulation() {
  const [bodies, setBodies] = useState(defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [timeScale, setTimeScale] = useState(1.0);
  const [log, setLog] = useState([]);

  const primary = useMemo(
    () => bodies.reduce((max, b) => (b.mass > (max?.mass || 0) ? b : max), null),
    [bodies]
  );

  function PhysicsRunner() {
    const last = useRef(performance.now());

    useFrame(() => {
      const now = performance.now();
      let dt = (now - last.current) / 1000;
      last.current = now;

      if (!running) return;
      dt = Math.min(dt, 0.05) * timeScale;

      const copy = bodiesRef.current.map((b) => ({
        ...b,
        position: b.position.clone(),
        velocity: b.velocity.clone(),
      }));

      stepPhysics(copy, dt);

      // collision detection
      for (let i = 0; i < copy.length; i++) {
        for (let j = i + 1; j < copy.length; j++) {
          const a = copy[i], b = copy[j];
          if (a.fixed || b.fixed) continue;
          if (a.position.distanceTo(b.position) < a.radius + b.radius) {
            const merged = mergeBodies(a, b);
            copy.splice(j, 1);
            copy.splice(i, 1, merged);
            setLog((L) => [`Merged ${a.name} + ${b.name}`, ...L].slice(0, 10));
            break;
          }
        }
      }

      setBodies(copy);
    });

    return null;
  }

  const selected = bodies.find((b) => b.id === selectedId);

  function updateSelected(changes) {
    setBodies((p) => p.map((b) => (b.id === selectedId ? { ...b, ...changes } : b)));
  }

  function addPlanet() {
    const id = "p_" + Math.random().toString(36).slice(2);
    setBodies((p) => [
      ...p,
      {
        id,
        name: `Planet ${p.length}`,
        mass: 1,
        radius: 0.5,
        color: "#" + Math.floor(Math.random() * 0xffffff).toString(16),
        position: v3(10 + Math.random() * 20, 0, 0),
        velocity: v3(0, 2.5 + Math.random(), 0),
      }
    ]);
  }

  function reset() {
    setBodies(defaultBodies());
    setLog([]);
    setSelectedId(null);
  }

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black">
        <Canvas camera={{ position: [0, 25, 35], fov: 60 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[10, 20, 10]} intensity={1.5} />
          <pointLight position={[0, 0, 0]} intensity={2} />

          {bodies.map((b) => (
            <React.Fragment key={b.id}>
              {!b.fixed && <AnalyticEllipse body={b} primary={primary} />}
              {!b.fixed && <OrbitTrail body={b} />}
              <PlanetMesh body={b} onClick={(bb) => setSelectedId(bb.id)} />
            </React.Fragment>
          ))}

          <OrbitControls />
          <PhysicsRunner />
        </Canvas>
      </div>

      {/* UI PANEL */}
      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto">
        <h2 className="text-xl font-semibold mb-2">3D Planetary Simulator</h2>
        <button className="bg-blue-600 px-3 py-1 mr-2 rounded" onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Run"}
        </button>
        <button className="bg-green-600 px-3 py-1 mr-2 rounded" onClick={addPlanet}>Add Planet</button>
        <button className="bg-red-600 px-3 py-1 rounded" onClick={reset}>Reset</button>

        <div className="mt-4">
          <label>Time Scale: {timeScale.toFixed(2)}</label>
          <input type="range" min="0.01" max="10" step="0.01" value={timeScale} onChange={(e) => setTimeScale(parseFloat(e.target.value))} className="w-full" />
        </div>

        <div className="mt-6">
          <h3 className="font-semibold">Bodies</h3>
          {bodies.map((b) => (
            <div key={b.id} className={`p-2 border rounded mt-2 cursor-pointer ${selectedId === b.id ? "border-yellow-400" : "border-gray-700"}`} onClick={() => setSelectedId(b.id)}>
              <div className="flex justify-between">
                <div>
                  {b.name}
                  <div className="text-xs text-gray-400">mass {b.mass.toFixed(3)} • r {b.radius.toFixed(2)}</div>
                </div>
                <div style={{ width: 14, height: 14, background: b.color }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <h3 className="font-semibold">Selected</h3>
          {!selected ? (
            <div className="text-sm text-gray-400 mt-2">Click a planet to select it.</div>
          ) : (
            <div className="mt-2">
              <div>{selected.name}</div>
              <div className="text-xs text-gray-500">ID: {selected.id}</div>
              <div className="mt-2">
                Mass: {selected.mass.toFixed(2)}
                <input type="range" min="0.05" max="50000" step="0.05" value={selected.mass} onChange={(e) => updateSelected({ mass: parseFloat(e.target.value) })} className="w-full" />
              </div>
              <div className="mt-2">
                Radius: {selected.radius.toFixed(2)}
                <input type="range" min="0.1" max="6" step="0.01" value={selected.radius} onChange={(e) => updateSelected({ radius: parseFloat(e.target.value) })} className="w-full" />
              </div>
              <div className="mt-2">
                Speed:
                <input type="range" min="0.1" max="5" step="0.01" onChange={(e) => {
                  const f = parseFloat(e.target.value);
                  updateSelected({ velocity: selected.velocity.clone().multiplyScalar(f) });
                }} className="w-full" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6">
          <h3 className="font-semibold">Event Log</h3>
          <div className="text-xs mt-2 max-h-40 overflow-auto">
            {log.length === 0 ? <div className="text-gray-500">No events yet</div> : log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
