import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

/*
  Solar system with compressed orbits but maintained relative sizes
*/
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const G = 0.12;
const AU = 8; // Reduced from 15 to 8 for closer planet spacing
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

// Compressed solar system with closer planet spacing
function defaultBodies() {
  const sun = {
    id: "sun",
    name: "Sun",
    mass: SUN_MASS,
    radius: 3.0, // Slightly smaller sun since planets are closer
    baseRadius: 3.0,
    color: "#ffaa33",
    glowColor: "#ff6600",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: false,
    kepler: null,
    importance: 10,
  };

  // Compressed orbits: planets closer together but maintaining relative distances
  const defs = [
    // [name, massRel, radiusRel, aAU, e, incDeg, color, glowColor, initialNu]
    ["Mercury", 0.055, 0.6, 0.8, 0.205, 7.0, "#b8a17a", "#d4c4a8", Math.PI * 0.7],    // Increased from 0.55 to 0.8 AU
    ["Venus", 0.815, 1.1, 1.1, 0.007, 3.39, "#e6d5b8", "#f5e9d5", Math.PI * 0.3],     // Increased from 0.75 to 1.1 AU
    ["Earth", 1.0, 1.2, 1.4, 0.017, 0.0, "#6bb5ff", "#a3d1ff", Math.PI * 0.5],        // Increased from 1.0 to 1.4 AU
    ["Mars", 0.107, 0.8, 1.8, 0.094, 1.85, "#ff8c69", "#ffb5a3", Math.PI * 0.8],      // Increased from 1.6 to 1.8 AU
    ["Jupiter", 317.8, 2.4, 3.0, 0.049, 1.305, "#e0b580", "#f0d9b5", Math.PI * 0.2],  // Drastically reduced from 5.5 to 3.0 AU
    ["Saturn", 95.2, 2.1, 4.0, 0.056, 2.485, "#f0d9a4", "#f8ecca", Math.PI * 0.6],    // Reduced from 9.8 to 4.0 AU
    ["Uranus", 14.5, 1.6, 5.0, 0.047, 0.773, "#c6f7ff", "#e3fbff", Math.PI * 0.4],    // Reduced from 19.5 to 5.0 AU
    ["Neptune", 17.15, 1.6, 6.0, 0.009, 1.77, "#6b9fff", "#a3c2ff", Math.PI * 0.9],   // Reduced from 30.5 to 6.0 AU
  ];

  const bodies = [sun];
  for (let idx = 0; idx < defs.length; idx++) {
    const [name, massRel, radiusRel, aAU, e, incDeg, color, glowColor, initialNu] = defs[idx];
    const a = aAU * AU;
    const i = (incDeg * Math.PI) / 180;
    const omega = (Math.random() - 0.5) * 0.4;
    const Omega = (Math.random() - 0.5) * 0.4;
    const nu = initialNu || Math.random() * Math.PI * 2;
    const mass = massRel;
    const mu = G * (SUN_MASS + mass);
    const { position: posOrb, velocity: velOrb } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    const kepler = { a, e, i, omega, Omega, nu0: nu };
    
    // Calculate periapsis distance to ensure it doesn't intersect the sun
    const periapsis = a * (1 - e);
    const sunRadius = sun.radius;
    
    bodies.push({
      id: name.toLowerCase(),
      name,
      mass,
      radius: Math.max(0.4, radiusRel * 0.25), // Slightly increased relative sizes
      baseRadius: Math.max(0.4, radiusRel * 0.25),
      color,
      glowColor: glowColor || color,
      position: posOrb.clone(),
      velocity: velOrb.clone(),
      delta: v3(0, 0, 0),
      kepler,
      fixed: false,
      importance: 8 - idx * 0.5,
      orbitalElements: { a, e, i, omega, Omega, nu },
    });
  }

  // zero net momentum
  let totalMass = 0; 
  let totalMomentum = v3(0, 0, 0);
  for (const b of bodies) { 
    totalMass += b.mass; 
    totalMomentum.add(b.velocity.clone().multiplyScalar(b.mass)); 
  }
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

/* ---------- Enhanced predictive ellipse generator with mass consideration ---------- */
function computeEllipsePointsFromState(body, bodies, steps = 300) {
  const sun = bodies.find((b) => b.id === "sun");
  if (!sun) return [];

  const rVec = new THREE.Vector3().subVectors(body.position, sun.position);
  const vVec = new THREE.Vector3().subVectors(body.velocity, sun.velocity);

  const r = rVec.length();
  const v2 = vVec.lengthSq();
  if (r < 1e-6 || !isFinite(r) || !isFinite(v2)) return [];

  // Include both sun mass AND body mass in gravitational parameter
  const mu = G * (sun.mass + body.mass);

  const h = new THREE.Vector3().crossVectors(rVec, vVec);
  const hNorm = h.length();
  if (hNorm < 1e-8) return [];

  const vxh = new THREE.Vector3().crossVectors(vVec, h).multiplyScalar(1 / mu);
  const rHat = rVec.clone().multiplyScalar(1 / r);
  const eVec = vxh.sub(rHat);
  const e = eVec.length();

  const energy = 0.5 * v2 - mu / r;
  if (!(energy < 0)) return [];

  const a = -mu / (2 * energy);
  if (!isFinite(a) || a <= 0) return [];

  const p = a * (1 - e * e);
  if (!(p > 0)) return [];

  // Calculate periapsis distance and ensure it clears the sun
  const periapsis = a * (1 - e);
  const minSafeDistance = sun.radius + body.radius + 1.5; // Reduced safe margin since planets are closer
  
  if (periapsis < minSafeDistance) {
    // Adjust the ellipse points to ensure they don't intersect the sun
    const unitE = eVec.clone().normalize();
    const unitH = h.clone().normalize();
    const unitPerp = new THREE.Vector3().crossVectors(unitH, unitE).normalize();
    if (unitPerp.length() < 1e-8) return [];

    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const theta = (k / steps) * Math.PI * 2;
      let rTheta = p / (1 + e * Math.cos(theta));
      
      // Ensure minimum safe distance from sun
      rTheta = Math.max(rTheta, minSafeDistance);
      
      const pos = unitE.clone().multiplyScalar(rTheta * Math.cos(theta))
        .add(unitPerp.clone().multiplyScalar(rTheta * Math.sin(theta)));
      const worldPos = pos.add(sun.position.clone());
      pts.push(worldPos);
    }
    return pts;
  }

  const unitE = eVec.clone().normalize();
  const unitH = h.clone().normalize();
  const unitPerp = new THREE.Vector3().crossVectors(unitH, unitE).normalize();
  if (unitPerp.length() < 1e-8) return [];

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

/* ---------- Camera Distance Tracker ---------- */
function CameraTracker({ onDistanceChange }) {
  const { camera } = useThree();
  
  useFrame(() => {
    const distance = camera.position.length();
    onDistanceChange(distance);
  });
  
  return null;
}

/* ---------- Enhanced Planet Component with Dynamic Scaling ---------- */
function PlanetMesh({ body, onClick, showLabel, cameraDistance, onOrbitUpdate }) {
  const ref = useRef();
  const meshRef = useRef();
  
  // Dynamic scaling based on camera distance
  const scaledRadius = useMemo(() => {
    if (!cameraDistance) return body.radius;
    
    const baseScale = 1.0;
    const distanceFactor = Math.min(1, cameraDistance / 150); // Adjusted for closer system
    const minVisibleSize = 0.6; // Smaller minimum size since planets are closer
    const scale = baseScale + (distanceFactor * 1.5); // Reduced scaling factor
    
    const isInnerPlanet = body.baseRadius < 1.0;
    const aggressiveScale = isInnerPlanet ? scale * 1.3 : scale; // Reduced aggressive scaling
    
    return Math.max(body.baseRadius * aggressiveScale, minVisibleSize);
  }, [body.baseRadius, body.radius, cameraDistance]);

  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.copy(body.position);
    
    if (meshRef.current) {
      const scale = scaledRadius / body.baseRadius;
      meshRef.current.scale.setScalar(scale);
    }
    
    // Notify parent that planet position updated (for orbit recalculation)
    if (onOrbitUpdate) {
      onOrbitUpdate();
    }
  });

  return (
    <group ref={ref}>
      {/* Glow effect for better visibility */}
      <mesh>
        <sphereGeometry args={[scaledRadius * 1.15, 16, 16]} /> {/* Reduced glow size */}
        <meshBasicMaterial 
          color={body.glowColor} 
          transparent 
          opacity={0.25} // Reduced opacity
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Main planet */}
      <mesh 
        ref={meshRef} 
        onClick={(e) => { e.stopPropagation(); onClick(body); }}
        castShadow
        receiveShadow
      >
        <sphereGeometry args={[body.baseRadius, 32, 32]} />
        <meshStandardMaterial 
          color={body.color} 
          metalness={0.3} 
          roughness={0.5}
          emissive={body.id === "sun" ? body.color : "#000000"}
          emissiveIntensity={body.id === "sun" ? 0.4 : 0}
        />
      </mesh>
      
      {/* Enhanced label with distance-based sizing */}
      {showLabel && (
        <Html 
          distanceFactor={20} // Increased for better visibility in closer system
          position={[0, scaledRadius + 0.3, 0]} // Reduced offset
          center
          style={{
            transform: `scale(${Math.min(1, 40 / (cameraDistance || 40))})`, // Adjusted scaling
            transition: 'transform 0.1s'
          }}
        >
          <div className="bg-black bg-opacity-80 text-white text-xs px-2 py-1 rounded-lg border border-gray-500 font-semibold shadow-lg">
            {body.name}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ---------- Enhanced Ellipse Lines with Dynamic Updates ---------- */
function EllipseLine({ body, bodies, cameraDistance, forceUpdate }) {
  const ref = useRef();
  const [geometry] = useState(() => new THREE.BufferGeometry());
  
  // Dynamic line width based on camera distance
  const material = useMemo(() => new THREE.LineBasicMaterial({ 
    color: body.glowColor || body.color, 
    opacity: Math.min(0.7, 0.4 + (cameraDistance / 400)), // Adjusted for closer system
    transparent: true,
  }), [body.color, body.glowColor, cameraDistance]);

  // Update ellipse geometry when body properties change
  const updateEllipseGeometry = useMemo(() => {
    return () => {
      if (!ref.current) return;
      const pts = computeEllipsePointsFromState(body, bodies, 300);
      if (pts.length < 2) return;
      const positions = new Float32Array(pts.flatMap(p => [p.x, p.y, p.z]));
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.attributes.position.needsUpdate = true;
    };
  }, [body, bodies, geometry]);

  // Update on initial mount and when forceUpdate changes
  useEffect(() => {
    updateEllipseGeometry();
  }, [updateEllipseGeometry, forceUpdate]);

  // Update every frame to ensure paths stay current
  useFrame(() => {
    updateEllipseGeometry();
  });

  return <line ref={ref} geometry={geometry} material={material} />;
}

/* ---------- Physics Runner Component ---------- */
function PhysicsRunner({ bodiesRef, running, timeScale, setBodies, collisionEnabled, setLog, onPhysicsUpdate }) {
  const last = useRef(performance.now());
  
  useFrame(() => {
    const now = performance.now();
    let dt = (now - last.current) / 1000;
    last.current = now;
    if (!running) { last.current = now; return; }
    dt = Math.min(dt, 0.05);
    let step = dt * timeScale;
    if (step <= 0) return;

    const MAX_SUB = 8;
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
    setBodies(newBodies);
    
    // Notify about physics update for orbit recalculations
    if (onPhysicsUpdate) {
      onPhysicsUpdate();
    }
  });
  
  return null;
}

/* ---------- Main Enhanced Component ---------- */
export default function CompressedSolarSystem() {
  const [bodies, setBodies] = useState(() => defaultBodies());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const [running, setRunning] = useState(true);
  const [timeScale, setTimeScale] = useState(0.8);
  const [selectedId, setSelectedId] = useState(null);
  const [showEllipses, setShowEllipses] = useState(true);
  const [collisionEnabled, setCollisionEnabled] = useState(false);
  const [log, setLog] = useState([]);
  const [cameraDistance, setCameraDistance] = useState(0);
  const [orbitUpdateTrigger, setOrbitUpdateTrigger] = useState(0);

  const selected = bodies.find(b => b.id === selectedId) || null;

  // Force orbit updates when properties change
  const triggerOrbitUpdate = () => {
    setOrbitUpdateTrigger(prev => prev + 1);
  };

  // UI setters with orbit update triggering
  const updateMass = (val) => { 
    if (!selected) return; 
    const m = parseFloat(val); 
    setBodies(prev => prev.map(b => b.id === selected.id ? { ...b, mass: m } : b)); 
    triggerOrbitUpdate();
  };
  
  const updateRadius = (val) => { 
    if (!selected) return; 
    const r = parseFloat(val); 
    setBodies(prev => prev.map(b => b.id === selected.id ? { ...b, radius: r, baseRadius: r } : b)); 
    triggerOrbitUpdate();
  };
  
  const updateVelocity = (axis, val) => {
    if (!selected) return;
    const v = parseFloat(val);
    setBodies(prev => prev.map(b => {
      if (b.id !== selected.id) return b;
      const nv = b.velocity.clone(); 
      nv[axis] = v;
      return { ...b, velocity: nv };
    }));
    triggerOrbitUpdate();
  };

  function addPlanet() {
    const id = `p_${Math.random().toString(36).slice(2, 8)}`;
    const a = (2 + Math.random() * 4) * AU; // Adjusted for compressed system
    const e = Math.random() * 0.05;
    const i = (Math.random() - 0.5) * 0.1;
    const omega = Math.random() * Math.PI * 2;
    const Omega = Math.random() * Math.PI * 2;
    const nu = Math.random() * Math.PI * 2;
    const mass = 1 + Math.random() * 3;
    const mu = G * (SUN_MASS + mass);
    const { position, velocity } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    const p = {
      id,
      name: `Planet${bodies.length}`,
      mass,
      radius: 0.4 + Math.random() * 0.5, // Adjusted for compressed system
      baseRadius: 0.4 + Math.random() * 0.5,
      color: `hsl(${Math.random() * 360}, 70%, 65%)`,
      glowColor: `hsl(${Math.random() * 360}, 80%, 75%)`,
      position,
      velocity,
      kepler: { a, e, i, omega, Omega, nu0: nu },
      fixed: false,
      importance: 5,
      orbitalElements: { a, e, i, omega, Omega, nu },
    };
    setBodies(prev => [...prev, p]);
    triggerOrbitUpdate();
  }

  function reset() {
    setBodies(defaultBodies());
    setLog([]);
    setSelectedId(null);
    triggerOrbitUpdate();
  }

  const bgColor = "#000011";

  return (
    <div className="w-full h-screen flex">
      <div className="w-3/4 h-full bg-black relative">
        <Canvas 
          style={{ background: bgColor }} 
          camera={{ position: [0, 40, 80], fov: 45 }} // Closer initial camera
          shadows
        >
          <color attach="background" args={[bgColor]} />
          {/* Fog removed for clearer zooming out */}
          
          <ambientLight intensity={0.5} />
          <directionalLight 
            position={[30, 50, 30]} // Adjusted for compressed system
            intensity={1.2} 
            castShadow
          />
          <pointLight 
            position={[0, 0, 0]} 
            intensity={2.5} 
            distance={200} // Reduced distance
            decay={1.5} 
            color="#ffaa33"
          />

          {/* Enhanced orbital paths with force update trigger */}
          {showEllipses && bodies.map(b => b.id !== "sun" ? 
            <EllipseLine 
              key={`ell_${b.id}`} 
              body={b} 
              bodies={bodies}
              cameraDistance={cameraDistance}
              forceUpdate={orbitUpdateTrigger}
            /> 
          : null)}

          {/* Enhanced planets with dynamic scaling and orbit updates */}
          {bodies.map(b => (
            <PlanetMesh 
              key={b.id} 
              body={b} 
              onClick={() => setSelectedId(b.id)} 
              showLabel={true}
              cameraDistance={cameraDistance}
              onOrbitUpdate={triggerOrbitUpdate}
            />
          ))}

          <OrbitControls 
            enablePan 
            enableZoom 
            minDistance={10} // Reduced minimum distance
            maxDistance={500} // Reduced maximum distance
            target={[0, 0, 0]}
          />
          
          <PhysicsRunner 
            bodiesRef={bodiesRef}
            running={running}
            timeScale={timeScale}
            setBodies={setBodies}
            collisionEnabled={collisionEnabled}
            setLog={setLog}
            onPhysicsUpdate={triggerOrbitUpdate}
          />
          
          <CameraTracker onDistanceChange={setCameraDistance} />
        </Canvas>
        
        {/* Camera distance indicator */}
        <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white px-3 py-2 rounded text-sm">
          Zoom: {Math.round(cameraDistance)} units
        </div>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto border-l border-gray-700">
        <h2 className="text-xl font-bold mb-3 text-yellow-200">Compressed Solar System</h2>
        <div className="mb-3 text-sm text-gray-300 bg-gray-800 p-2 rounded">
          Planets are closer together but maintain relative sizes. Fog removed for clear viewing.
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button 
            className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded flex-1 min-w-[80px]" 
            onClick={() => setRunning(r => !r)}
          >
            {running ? "⏸️ Pause" : "▶️ Run"}
          </button>
          <button 
            className="bg-green-600 hover:bg-green-500 px-3 py-2 rounded flex-1 min-w-[80px]" 
            onClick={addPlanet}
          >
            ➕ Add Planet
          </button>
          <button 
            className="bg-red-600 hover:bg-red-500 px-3 py-2 rounded flex-1 min-w-[80px]" 
            onClick={reset}
          >
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
                  <br /><span className="text-xs text-gray-500">(Affects orbital path)</span>
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
                  <br /><span className="text-xs text-gray-500">(Affects safe orbital distance)</span>
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
                      className="w-4 h-4 rounded-full border border-white border-opacity-30 shadow-lg"
                      style={{ 
                        backgroundColor: b.color,
                        boxShadow: `0 0 8px ${b.glowColor}`
                      }}
                    />
                    <div>
                      <div className="font-medium text-sm">{b.name}</div>
                      <div className="text-xs text-gray-400">
                        m:{b.mass.toFixed(2)} • r:{b.baseRadius.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {b.id === "sun" && <span className="text-xs text-yellow-300">⭐</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}