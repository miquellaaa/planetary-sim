import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// -----------------------------
// Planetary N-body simulation with analytic orbital paths
// -----------------------------

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = 0.2;

// Generate planets with initial circular orbit around Sun
const defaultBodies = () => {
  const sun = {
    id: "sun",
    name: "Sun",
    mass: 4000,
    radius: 2.4,
    color: "#ffcc66",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: true,
  };

  // circular orbits: v = sqrt(G*M/r)
  const planets = [
    { name: "Planet A", color: "#4da6ff", radius: 0.6, mass: 10, distance: 10 },
    { name: "Planet B", color: "#ff8a66", radius: 0.46, mass: 6, distance: 14 },
    { name: "Planet C", color: "#66ff99", radius: 0.5, mass: 4, distance: 18 },
  ];

  const planetBodies = planets.map((p, i) => {
    const angle = (i * Math.PI) / 3; // slight rotation offset
    const pos = v3(Math.cos(angle) * p.distance, 0, Math.sin(angle) * p.distance);
    const speed = Math.sqrt((G * sun.mass) / p.distance);
    const vel = v3(-Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
    return {
      id: p.name.toLowerCase().replace(/\s/g, "_"),
      name: p.name,
      mass: p.mass,
      radius: p.radius,
      color: p.color,
      position: pos,
      velocity: vel,
      fixed: false,
    };
  });

  return [sun, ...planetBodies];
};

// Physics integrator (semi-implicit)
function stepPhysics(bodies, dt) {
  const accs = bodies.map(() => v3(0, 0, 0));

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const bj = bodies[j];
      const r = new THREE.Vector3().subVectors(bj.position, bi.position);
      const dist2 = r.lengthSq() + 1e-6;
      const aMag = (G * bj.mass) / dist2;
      accs[i].add(r.normalize().multiplyScalar(aMag));
    }
  }

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.fixed) continue;
    b.velocity.add(accs[i].clone().multiplyScalar(dt));
    b.position.add(b.velocity.clone().multiplyScalar(dt));
  }
}

// Merge two bodies (inelastic)
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
  const radius = Math.cbrt(Math.pow(a.radius, 3) + Math.pow(b.radius, 3));
  const color = a.mass >= b.mass ? a.color : b.color;
  return { id: `${a.id}_${b.id}_m`, name: `${a.name}–${b.name}`, mass, radius, color, position: pos, velocity: vel, fixed: false };
}

// Compute analytic orbit points (ellipses)
function OrbitPath({ body, primary }) {
  const ref = useRef();
  const points = useMemo(() => {
    if (!primary) return [];
    const r = body.position.clone().sub(primary.position).length();
    const segments = 128;
    const positions = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * 2 * Math.PI;
      positions.push(new THREE.Vector3(Math.cos(theta) * r, 0, Math.sin(theta) * r));
    }
    return positions;
  }, [body, primary]);

  return (
    <line ref={ref}>
      <bufferGeometry attach="geometry">
        <bufferAttribute
          attach="attributes-position"
          array={new Float32Array(points.flatMap(p => [p.x, p.y, p.z]))}
          count={points.length}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial attach="material" color={body.color} opacity={0.4} transparent />
    </line>
  );
}

// Trail component for planets - shows actual path history
function PlanetTrail({ body, trailLength = 100, enabled = true }) {
  const trailRef = useRef();
  const trailPoints = useRef([]);
  const frameCount = useRef(0);
  
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const material = useMemo(() => new THREE.LineBasicMaterial({ 
    color: body.color, 
    transparent: true,
    opacity: 0.7,
    linewidth: 1
  }), [body.color]);

  useFrame(() => {
    if (!trailRef.current || !enabled) return;
    
    // Add current position to trail every few frames
    frameCount.current++;
    if (frameCount.current % 3 === 0) { // Update every 3 frames for performance
      // Add current position to the beginning of the trail
      trailPoints.current.unshift(body.position.clone());
      
      // Limit trail length
      if (trailPoints.current.length > trailLength) {
        trailPoints.current.pop(); // Remove oldest point
      }
      
      // Update trail geometry if we have enough points
      if (trailPoints.current.length >= 2) {
        const positions = new Float32Array(trailPoints.current.length * 3);
        trailPoints.current.forEach((point, index) => {
          positions[index * 3] = point.x;
          positions[index * 3 + 1] = point.y;
          positions[index * 3 + 2] = point.z;
        });
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.attributes.position.needsUpdate = true;
      }
    }
  });

  // Reset trail when body changes or when enabled changes
  useEffect(() => {
    trailPoints.current = [body.position.clone()];
    frameCount.current = 0;
  }, [body.id, enabled]);

  if (!enabled || trailPoints.current.length < 2) {
    return null;
  }

  return (
    <line ref={trailRef} geometry={geometry} material={material} />
  );
}

// Planet mesh component
function PlanetMesh({ body, onClick, showLabel }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.position.copy(body.position);
  });

  return (
    <mesh ref={ref} onClick={(e) => {
      e.stopPropagation();
      onClick(body);
    }}>
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

export default function PlanetarySimulation() {
  const [bodies, setBodies] = useState(() => defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [timeScale, setTimeScale] = useState(1.0);
  const [log, setLog] = useState([]);
  const [showTrails, setShowTrails] = useState(true);
  const [trailLength, setTrailLength] = useState(80);
  const [showOrbits, setShowOrbits] = useState(true);

  const primary = useMemo(() => bodies.reduce((acc, b) => (b.mass > (acc?.mass || 0) ? b : acc), null), [bodies]);

  function PhysicsRunner() {
    const last = useRef(performance.now());
    useFrame(() => {
      const now = performance.now();
      let dt = (now - last.current) / 1000;
      last.current = now;
      if (!running) return;
      dt = Math.min(dt, 0.05);
      const step = dt * timeScale;

      const copy = bodiesRef.current.map((b) => ({ 
        ...b, 
        position: b.position.clone(), 
        velocity: b.velocity.clone() 
      }));
      stepPhysics(copy, step);

      // collisions
      let collided = false;
      for (let i = 0; i < copy.length; i++) {
        for (let j = i + 1; j < copy.length; j++) {
          const a = copy[i];
          const b = copy[j];
          const dist = a.position.distanceTo(b.position);
          if (dist <= a.radius + b.radius && !a.fixed && !b.fixed) {
            const merged = mergeBodies(a, b);
            copy.splice(j, 1);
            copy.splice(i, 1, merged);
            collided = true;
            setLog((L) => [`Merged ${a.name} + ${b.name} → ${merged.name}`, ...L].slice(0, 10));
            break;
          }
        }
        if (collided) break;
      }

      setBodies(copy);
    });
    return null;
  }

  const selected = bodies.find((b) => b.id === selectedId) || null;
  
  const updateSelected = (changes) => {
    setBodies((prev) => 
      prev.map((b) => 
        b.id === selectedId ? { ...b, ...changes } : b
      )
    );
  };

  function addPlanet() {
    const id = `p_${Math.random().toString(36).slice(2, 8)}`;
    const r = 10 + Math.random() * 10;
    const angle = Math.random() * 2 * Math.PI;
    const speed = Math.sqrt((G * primary.mass) / r);
    const pos = v3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    const vel = v3(-Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
    const p = { 
      id, 
      name: `Planet ${bodies.length}`, 
      mass: 4, 
      radius: 0.5, 
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`, 
      position: pos, 
      velocity: vel, 
      fixed: false 
    };
    setBodies((b0) => [...b0, p]);
  }

  function reset() {
    setBodies(defaultBodies());
    setLog([]);
    setSelectedId(null);
  }

  // Property editing functions
  const updateMass = (mass) => {
    if (selected && !selected.fixed) {
      updateSelected({ mass: parseFloat(mass) });
    }
  };

  const updateRadius = (radius) => {
    if (selected && !selected.fixed) {
      updateSelected({ radius: parseFloat(radius) });
    }
  };

  const updateVelocity = (axis, value) => {
    if (selected && !selected.fixed) {
      const newVelocity = selected.velocity.clone();
      newVelocity[axis] = parseFloat(value);
      updateSelected({ velocity: newVelocity });
    }
  };

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black relative">
        <Canvas camera={{ position: [0, 25, 40], fov: 60 }}>
          <ambientLight intensity={0.4} />
          <pointLight position={[0, 0, 0]} intensity={2} />

          {showOrbits && bodies.map((b) => b !== primary && <OrbitPath key={b.id} body={b} primary={primary} />)}
          {bodies.map((b) => (
            <React.Fragment key={b.id}>
              <PlanetMesh 
                body={b} 
                onClick={(body) => setSelectedId(body.id)} 
                showLabel={true} 
              />
              {!b.fixed && (
                <PlanetTrail 
                  body={b} 
                  trailLength={trailLength} 
                  enabled={showTrails}
                />
              )}
            </React.Fragment>
          ))}

          <OrbitControls enablePan enableZoom />
          <PhysicsRunner />
        </Canvas>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto">
        <h2 className="text-xl font-semibold mb-2">3D Planetary Simulator</h2>
        <div className="mb-2 text-sm text-gray-300">Click a planet in the 3D view to edit its properties in real-time.</div>

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
            max="10" 
            step="0.01" 
            value={timeScale} 
            onChange={(e) => setTimeScale(parseFloat(e.target.value))} 
            className="w-full" 
          />
        </div>

        <div className="mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm">Show Orbit Paths</label>
            <input
              type="checkbox"
              checked={showOrbits}
              onChange={(e) => setShowOrbits(e.target.checked)}
              className="w-4 h-4"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm">Show Motion Trails</label>
            <input
              type="checkbox"
              checked={showTrails}
              onChange={(e) => setShowTrails(e.target.checked)}
              className="w-4 h-4"
            />
          </div>
        </div>

        {showTrails && (
          <div className="mb-3">
            <label className="block text-xs text-gray-400">Trail Length: {trailLength}</label>
            <input 
              type="range" 
              min="10" 
              max="200" 
              step="5" 
              value={trailLength} 
              onChange={(e) => setTrailLength(parseInt(e.target.value))} 
              className="w-full" 
            />
            <div className="text-xs text-gray-400 mt-1">
              Longer trails show more history but may affect performance
            </div>
          </div>
        )}

        {/* Selected Planet Properties */}
        {selected && (
          <div className="mb-4 p-3 bg-gray-800 rounded">
            <h3 className="font-medium mb-2">Editing: {selected.name}</h3>
            
            {!selected.fixed && (
              <>
                {/* Mass Control */}
                <div className="mb-2">
                  <label className="block text-xs text-gray-400 mb-1">
                    Mass: {selected.mass.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="100"
                    step="0.1"
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
                    step="0.1"
                    value={selected.radius}
                    onChange={(e) => updateRadius(e.target.value)}
                    className="w-full"
                  />
                </div>

                {/* Velocity Controls */}
                <div className="mb-2">
                  <label className="block text-xs text-gray-400 mb-1">Velocity</label>
                  <div className="space-y-1">
                    <div className="flex items-center">
                      <span className="text-xs w-8">X:</span>
                      <input
                        type="range"
                        min="-10"
                        max="10"
                        step="0.1"
                        value={selected.velocity.x}
                        onChange={(e) => updateVelocity('x', e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-xs w-12 ml-2">{selected.velocity.x.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-xs w-8">Y:</span>
                      <input
                        type="range"
                        min="-10"
                        max="10"
                        step="0.1"
                        value={selected.velocity.y}
                        onChange={(e) => updateVelocity('y', e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-xs w-12 ml-2">{selected.velocity.y.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-xs w-8">Z:</span>
                      <input
                        type="range"
                        min="-10"
                        max="10"
                        step="0.1"
                        value={selected.velocity.z}
                        onChange={(e) => updateVelocity('z', e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-xs w-12 ml-2">{selected.velocity.z.toFixed(1)}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-gray-400 mt-2">
                  Speed: {selected.velocity.length().toFixed(2)}
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
                    mass: {b.mass.toFixed(2)} • r: {b.radius.toFixed(2)}
                  </div>
                  {!b.fixed && (
                    <div className="text-xs text-gray-500">
                      speed: {b.velocity.length().toFixed(2)}
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
                <div key={i} className="p-1 border-b border-gray-700">
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