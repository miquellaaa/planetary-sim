import React, { useRef, useState, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// -----------------------------
// Utility
// -----------------------------
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = 1; // scaled gravitational constant

// -----------------------------
// Default bodies
// -----------------------------
const defaultBodies = () => [
  {
    id: "sun",
    name: "Sun",
    mass: 330000,
    radius: 5,
    color: "#ffcc66",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: true,
  },
  {
    id: "mercury",
    name: "Mercury",
    mass: 0.055,
    radius: 1.2,
    color: "#c0b090",
    position: v3(8, 0, 0),
    velocity: v3(0, 4.5, 0),
  },
  {
    id: "venus",
    name: "Venus",
    mass: 0.815,
    radius: 1.5,
    color: "#d9c59a",
    position: v3(12, 0, 0),
    velocity: v3(0, 3.5, 0),
  },
  {
    id: "earth",
    name: "Earth",
    mass: 1,
    radius: 1.6,
    color: "#4da6ff",
    position: v3(17, 0, 0),
    velocity: v3(0, 3.0, 0),
  },
  {
    id: "mars",
    name: "Mars",
    mass: 0.107,
    radius: 1.4,
    color: "#ff8a66",
    position: v3(22, 0, 0),
    velocity: v3(0, 2.4, 0),
  },
];

// -----------------------------
// Physics
// -----------------------------
function stepPhysics(bodies, dt) {
  const accs = bodies.map(() => v3());

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    if (bi.fixed) continue;

    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;

      const bj = bodies[j];
      const r = bj.position.clone().sub(bi.position);
      const dist2 = r.lengthSq() + 0.01;
      const dist = Math.sqrt(dist2);
      const aMag = (G * bj.mass) / dist2;
      accs[i].add(r.multiplyScalar(aMag / dist));
    }
  }

  // Integrate
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.fixed) continue;
    b.velocity.add(accs[i].clone().multiplyScalar(dt));
    b.position.add(b.velocity.clone().multiplyScalar(dt));
  }
}

// -----------------------------
// Merge bodies on collision
// -----------------------------
function mergeBodies(a, b) {
  const mass = a.mass + b.mass;
  const pos = a.position.clone().multiplyScalar(a.mass)
    .add(b.position.clone().multiplyScalar(b.mass))
    .divideScalar(mass);
  const vel = a.velocity.clone().multiplyScalar(a.mass)
    .add(b.velocity.clone().multiplyScalar(b.mass))
    .divideScalar(mass);
  const radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);
  const color = a.mass >= b.mass ? a.color : b.color;
  return { id: `${a.id}_${b.id}`, name: `${a.name}-${b.name}`, mass, radius, color, position: pos, velocity: vel, fixed: false };
}

// -----------------------------
// Planet Mesh
// -----------------------------
function Planet({ body, onClick }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.position.copy(body.position);
  });
  return (
    <mesh ref={ref} onClick={() => onClick(body)}>
      <sphereGeometry args={[body.radius, 32, 32]} />
      <meshStandardMaterial color={body.color} metalness={0.2} roughness={0.7} />
      <Html center distanceFactor={10} position={[0, body.radius + 0.3, 0]}>
        <div className="bg-black bg-opacity-50 text-white text-xs px-1 py-0.5 rounded">{body.name}</div>
      </Html>
    </mesh>
  );
}

// -----------------------------
// Orbit Trail
// -----------------------------
function OrbitTrail({ body, maxPoints = 300 }) {
  const ref = useRef();
  const points = useRef([]);
  useFrame(() => {
    points.current.push(body.position.clone());
    if (points.current.length > maxPoints) points.current.shift();
    if (ref.current) ref.current.geometry.setFromPoints(points.current);
  });
  return (
    <line>
      <bufferGeometry ref={ref} />
      <lineBasicMaterial color={body.color} linewidth={1} />
    </line>
  );
}

// -----------------------------
// Main Simulation
// -----------------------------
export default function PlanetarySimulation() {
  const [bodies, setBodies] = useState(defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const [running, setRunning] = useState(true);

  // Physics loop
  useFrame((_, delta) => {
    if (!running) return;

    const copy = bodiesRef.current.map(b => ({ ...b, position: b.position.clone(), velocity: b.velocity.clone() }));
    stepPhysics(copy, delta);

    // collision detection
    for (let i = 0; i < copy.length; i++) {
      for (let j = i + 1; j < copy.length; j++) {
        const a = copy[i], b = copy[j];
        if (a.fixed || b.fixed) continue;
        if (a.position.distanceTo(b.position) < a.radius + b.radius) {
          const merged = mergeBodies(a, b);
          copy.splice(j, 1);
          copy.splice(i, 1, merged);
          break;
        }
      }
    }

    setBodies(copy);
  });

  function addPlanet() {
    const id = "p_" + Math.random().toString(36).slice(2);
    setBodies((prev) => [
      ...prev,
      {
        id,
        name: `Planet ${prev.length}`,
        mass: 1,
        radius: 1,
        color: "#" + Math.floor(Math.random() * 0xffffff).toString(16),
        position: v3(10 + Math.random() * 20, 0, 0),
        velocity: v3(0, 2.5 + Math.random(), 0),
      }
    ]);
  }

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black">
        <Canvas camera={{ position: [0, 30, 40], fov: 60 }}>
          <ambientLight intensity={1.2} />
          <directionalLight position={[10, 20, 10]} intensity={2} />
          <pointLight position={[0, 0, 0]} intensity={1.5} />

          {bodies.map(b => (
            <React.Fragment key={b.id}>
              {!b.fixed && <OrbitTrail body={b} />}
              <Planet body={b} onClick={() => {}} />
            </React.Fragment>
          ))}

          <OrbitControls />
        </Canvas>
      </div>
      <div className="w-1/4 h-full bg-gray-900 text-white p-4">
        <h2 className="text-xl font-semibold mb-2">3D Planetary Simulator</h2>
        <button className="bg-blue-600 px-3 py-1 mr-2 rounded" onClick={() => setRunning(r => !r)}>
          {running ? "Pause" : "Run"}
        </button>
        <button className="bg-green-600 px-3 py-1 rounded" onClick={addPlanet}>Add Planet</button>
      </div>
    </div>
  );
}
