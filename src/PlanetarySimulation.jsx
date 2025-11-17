import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

/*
  Solar system simulation
*/
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const G = 0.12;
const AU = 10;
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

// Completely revised scaling with non-overlapping orbits
function defaultBodies() {
  const sun = {
    id: "sun",
    name: "Sun",
    mass: SUN_MASS,
    radius: 2.5,
    baseRadius: 2.5,
    color: "#ffaa33",
    glowColor: "#ff6600",
    position: v3(0, 0, 0),
    velocity: v3(0, 0, 0),
    fixed: false,
    kepler: null,
    importance: 10,
  };

  const defs = [
    ["Mercury", 0.055, 0.4, 1.0, 0.1, 7.0, "#b8a17a", "#d4c4a8", Math.PI * 0.7],
    ["Venus", 0.815, 0.9, 1.8, 0.01, 3.39, "#e6d5b8", "#f5e9d5", Math.PI * 0.3],
    ["Earth", 1.0, 1.0, 2.6, 0.02, 0.0, "#6bb5ff", "#a3d1ff", Math.PI * 0.5],
    ["Mars", 0.107, 0.6, 3.4, 0.05, 1.85, "#ff8c69", "#ffb5a3", Math.PI * 0.8],
    ["Jupiter", 317.8, 1.8, 5.0, 0.03, 1.305, "#e0b580", "#f0d9b5", Math.PI * 0.2],
    ["Saturn", 95.2, 1.6, 6.8, 0.04, 2.485, "#f0d9a4", "#f8ecca", Math.PI * 0.6],
    ["Uranus", 14.5, 1.2, 8.6, 0.02, 0.773, "#c6f7ff", "#e3fbff", Math.PI * 0.4],
    ["Neptune", 17.15, 1.2, 10.4, 0.01, 1.77, "#6b9fff", "#a3c2ff", Math.PI * 0.9],
  ];

  const bodies = [sun];
  
  const orbitSpacing = 1.2;
  
  for (let idx = 0; idx < defs.length; idx++) {
    const [name, massRel, radiusRel, aAU, e, incDeg, color, glowColor, initialNu] = defs[idx];
    
    let a = aAU * AU;
    if (idx > 0) {
      const prevBody = bodies[idx];
      const prevA = prevBody.orbitalElements.a / AU;
      const minDistance = (prevA * (1 + prevBody.orbitalElements.e) + 0.3) * orbitSpacing;
      a = Math.max(a, minDistance * AU);
    }
    
    const i = (incDeg * Math.PI) / 180;
    const omega = (Math.random() - 0.5) * 0.3;
    const Omega = (Math.random() - 0.5) * 0.3;
    const nu = initialNu || Math.random() * Math.PI * 2;
    const mass = massRel;
    const mu = G * (SUN_MASS + mass);
    const { position: posOrb, velocity: velOrb } = orbitalElementsToState(a, e, i, omega, Omega, nu, mu);
    
    bodies.push({
      id: name.toLowerCase(),
      name,
      mass,
      radius: Math.max(0.2, radiusRel * 0.15),
      baseRadius: Math.max(0.2, radiusRel * 0.15),
      color,
      glowColor: glowColor || color,
      position: posOrb.clone(),
      velocity: velOrb.clone(),
      delta: v3(0, 0, 0),
      kepler: { a, e, i, omega, Omega, nu0: nu },
      fixed: false,
      importance: 8 - idx * 0.5,
      orbitalElements: { a, e, i, omega, Omega, nu },
    });
  }

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

/* ---------- REALISTIC PLANETARY COLLISION SYSTEM ---------- */

function handleRealisticCollision(A, B, setLog, bodies, setBodies) {
  const collisionDistance = A.radius + B.radius;
  const actualDistance = A.position.distanceTo(B.position);
  
  if (actualDistance > collisionDistance * 0.8) return false;

  // Calculate relative velocity
  const relVelocity = new THREE.Vector3().subVectors(A.velocity, B.velocity);
  const normal = new THREE.Vector3().subVectors(B.position, A.position).normalize();
  const approachSpeed = -relVelocity.dot(normal); // Negative because we want approach
  
  // Only collide if planets are moving toward each other
  if (approachSpeed <= 0) return false;

  const m1 = A.mass;
  const m2 = B.mass;
  const totalMass = m1 + m2;

  // Calculate center of mass velocity
  const comVelocity = new THREE.Vector3()
    .add(A.velocity.clone().multiplyScalar(m1))
    .add(B.velocity.clone().multiplyScalar(m2))
    .multiplyScalar(1 / totalMass);

  // Calculate impact energy (kinetic energy in center of mass frame)
  const v1Rel = new THREE.Vector3().subVectors(A.velocity, comVelocity);
  const v2Rel = new THREE.Vector3().subVectors(B.velocity, comVelocity);
  const impactEnergy = 0.5 * m1 * v1Rel.lengthSq() + 0.5 * m2 * v2Rel.lengthSq();

  // Calculate escape velocity for the combined mass at contact distance
  const combinedRadius = A.radius + B.radius;
  const escapeVelocity = Math.sqrt(2 * G * totalMass / combinedRadius);

  // Determine collision type based on impact energy vs gravitational binding energy
  const bindingEnergy = G * m1 * m2 / combinedRadius;
  const impactParameter = actualDistance / combinedRadius;

  if (impactEnergy > 2 * bindingEnergy && approachSpeed > escapeVelocity * 0.7) {
    // HIGH-ENERGY COLLISION: Catastrophic disruption (like Theia-Earth impact)
    handleCatastrophicDisruption(A, B, comVelocity, setLog, bodies, setBodies);
  } else if (impactEnergy > bindingEnergy * 0.5) {
    // MEDIUM-ENERGY COLLISION: Grazing impact with mass exchange
    handleGrazingImpact(A, B, comVelocity, normal, setLog, bodies, setBodies);
  } else {
    // LOW-ENERGY COLLISION: Accretion or merger
    handlePlanetaryMerger(A, B, comVelocity, setLog, bodies, setBodies);
  }

  return true;
}

function handleCatastrophicDisruption(A, B, comVelocity, setLog, bodies, setBodies) {
  const totalMass = A.mass + B.radius;
  
  // Create multiple fragments
  const fragmentCount = 3 + Math.floor(Math.random() * 4);
  const fragments = [];
  
  for (let i = 0; i < fragmentCount; i++) {
    const fragmentMass = totalMass * (0.1 + Math.random() * 0.3);
    const fragmentRadius = Math.pow(fragmentMass, 1/3) * 0.8;
    
    // Random velocity kick based on impact energy
    const velocitySpread = 2 + Math.random() * 4;
    const randomDir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
    
    const fragmentVelocity = comVelocity.clone()
      .add(randomDir.multiplyScalar(velocitySpread));
    
    fragments.push({
      id: `fragment_${Date.now()}_${i}`,
      name: `${A.name.split(' ')[0]} Fragment`,
      mass: fragmentMass,
      radius: fragmentRadius,
      baseRadius: fragmentRadius,
      color: i % 2 === 0 ? A.color : B.color,
      glowColor: i % 2 === 0 ? A.glowColor : B.glowColor,
      position: A.position.clone().add(randomDir.multiplyScalar(A.radius + B.radius)),
      velocity: fragmentVelocity,
      fixed: false,
      importance: 3,
    });
  }
  
  setLog(L => [`CATASTROPHIC IMPACT: ${A.name} and ${B.name} destroyed each other`, ...L.slice(0, 8)]);
  
  // Remove original planets and add fragments
  setBodies(prev => [
    ...prev.filter(b => b.id !== A.id && b.id !== B.id),
    ...fragments
  ]);
}

function handleGrazingImpact(A, B, comVelocity, normal, setLog, bodies, setBodies) {
  const m1 = A.mass;
  const m2 = B.mass;
  const totalMass = m1 + m2;
  
  // Calculate mass exchange (like the Moon-forming impact)
  const massTransferRatio = 0.1 + Math.random() * 0.3;
  const transferredMass = Math.min(m1, m2) * massTransferRatio;
  
  // Larger body absorbs most of the mass
  const larger = m1 > m2 ? A : B;
  const smaller = m1 > m2 ? B : A;
  
  // Update larger body
  const newLargerMass = larger.mass + transferredMass * 0.7;
  const newLargerRadius = Math.pow(newLargerMass, 1/3) * 0.9;
  
  // Create debris/moon from remaining mass
  const debrisMass = transferredMass * 0.3;
  const debrisRadius = Math.pow(debrisMass, 1/3) * 0.7;
  
  // Debris gets orbital velocity around larger body
  const orbitalVelocity = Math.sqrt(G * newLargerMass / (larger.radius + debrisRadius * 2));
  const perpendicular = new THREE.Vector3(-normal.z, 0, normal.x).normalize();
  const debrisVelocity = comVelocity.clone()
    .add(perpendicular.multiplyScalar(orbitalVelocity));
  
  const debris = {
    id: `moon_${Date.now()}`,
    name: `${larger.name} Moon`,
    mass: debrisMass,
    radius: debrisRadius,
    baseRadius: debrisRadius,
    color: smaller.color,
    glowColor: smaller.glowColor,
    position: larger.position.clone().add(perpendicular.multiplyScalar(larger.radius + debrisRadius + 1)),
    velocity: debrisVelocity,
    fixed: false,
    importance: 4,
  };
  
  // Update larger body
  const updatedLarger = {
    ...larger,
    mass: newLargerMass,
    radius: newLargerRadius,
    baseRadius: newLargerRadius,
    velocity: comVelocity.clone().multiplyScalar(0.98), // Slight velocity damping
  };
  
  setLog(L => [`GRAZING IMPACT: ${smaller.name} hit ${larger.name}, creating a moon`, ...L.slice(0, 8)]);
  
  // Replace bodies
  setBodies(prev => [
    ...prev.filter(b => b.id !== A.id && b.id !== B.id),
    updatedLarger,
    debris
  ]);
}

function handlePlanetaryMerger(A, B, comVelocity, setLog, bodies, setBodies) {
  const m1 = A.mass;
  const m2 = B.mass;
  const totalMass = m1 + m2;
  
  // Create merged planet
  const mergedRadius = Math.pow(totalMass, 1/3) * 0.9;
  const mergedName = m1 > m2 ? 
    `${A.name} (Merged)` : 
    `${B.name} (Merged)`;
  
  // Blend colors
  const color1 = new THREE.Color(A.color);
  const color2 = new THREE.Color(B.color);
  const blendedColor = new THREE.Color();
  blendedColor.lerpColors(color1, color2, m2 / totalMass);
  
  const mergedPlanet = {
    id: `merged_${Date.now()}`,
    name: mergedName,
    mass: totalMass,
    radius: mergedRadius,
    baseRadius: mergedRadius,
    color: `#${blendedColor.getHexString()}`,
    glowColor: `#${blendedColor.getHexString()}`,
    position: comVelocity.clone().multiplyScalar(0.1).add(A.position), // Slight position adjustment
    velocity: comVelocity,
    fixed: false,
    importance: Math.max(A.importance, B.importance),
  };
  
  setLog(L => [`PLANETARY MERGER: ${A.name} and ${B.name} merged into ${mergedName}`, ...L.slice(0, 8)]);
  
  // Replace colliding planets with merged planet
  setBodies(prev => [
    ...prev.filter(b => b.id !== A.id && b.id !== B.id),
    mergedPlanet
  ]);
}

/* ---------- Enhanced predictive ellipse generator ---------- */
function computeEllipsePointsFromState(body, bodies, steps = 300) {
  const sun = bodies.find((b) => b.id === "sun");
  if (!sun) return [];

  const rVec = new THREE.Vector3().subVectors(body.position, sun.position);
  const vVec = new THREE.Vector3().subVectors(body.velocity, sun.velocity);

  const r = rVec.length();
  const v2 = vVec.lengthSq();
  if (r < 1e-6 || !isFinite(r) || !isFinite(v2)) return [];

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

  const periapsis = a * (1 - e);
  const minSafeDistance = sun.radius + body.radius + 1.0;
  
  if (periapsis < minSafeDistance) {
    const unitE = eVec.clone().normalize();
    const unitH = h.clone().normalize();
    const unitPerp = new THREE.Vector3().crossVectors(unitH, unitE).normalize();
    if (unitPerp.length() < 1e-8) return [];

    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const theta = (k / steps) * Math.PI * 2;
      let rTheta = p / (1 + e * Math.cos(theta));
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

/* ---------- Enhanced Planet Component ---------- */
function PlanetMesh({ body, onClick, showLabel, cameraDistance, onOrbitUpdate }) {
  const ref = useRef();
  const meshRef = useRef();
  
  const scaledRadius = useMemo(() => {
    if (!cameraDistance) return body.radius;
    const baseScale = 1.0;
    const distanceFactor = Math.min(1, cameraDistance / 150);
    const minVisibleSize = 0.3;
    const scale = baseScale + (distanceFactor * 1.2);
    const isInnerPlanet = body.baseRadius < 0.8;
    const aggressiveScale = isInnerPlanet ? scale * 1.2 : scale;
    return Math.max(body.baseRadius * aggressiveScale, minVisibleSize);
  }, [body.baseRadius, body.radius, cameraDistance]);

  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.copy(body.position);
    if (meshRef.current) {
      const scale = scaledRadius / body.baseRadius;
      meshRef.current.scale.setScalar(scale);
    }
    if (onOrbitUpdate) {
      onOrbitUpdate();
    }
  });

  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[scaledRadius * 1.1, 16, 16]} />
        <meshBasicMaterial 
          color={body.glowColor} 
          transparent 
          opacity={0.2}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
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
      
      {showLabel && (
        <Html 
          distanceFactor={25} 
          position={[0, scaledRadius + 0.2, 0]} 
          center
          style={{
            transform: `scale(${Math.min(1, 30 / (cameraDistance || 30))})`,
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

/* ---------- Enhanced Ellipse Lines ---------- */
function EllipseLine({ body, bodies, cameraDistance, forceUpdate }) {
  const ref = useRef();
  const [geometry] = useState(() => new THREE.BufferGeometry());
  
  const material = useMemo(() => new THREE.LineBasicMaterial({ 
    color: body.glowColor || body.color, 
    opacity: Math.min(0.6, 0.4 + (cameraDistance / 600)),
    transparent: true,
  }), [body.color, body.glowColor, cameraDistance]);

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

  useEffect(() => {
    updateEllipseGeometry();
  }, [updateEllipseGeometry, forceUpdate]);

  useFrame(() => {
    updateEllipseGeometry();
  });

  return <line ref={ref} geometry={geometry} material={material} />;
}

/* ---------- Physics Runner with Realistic Collisions ---------- */
function PhysicsRunner({ bodiesRef, running, timeScale, setBodies, collisionEnabled, setLog, onPhysicsUpdate }) {
  const last = useRef(performance.now());
  const collisionCooldown = useRef(new Map());
  
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

      // REALISTIC COLLISION DETECTION AND HANDLING
      if (collisionEnabled) {
        const currentTime = Date.now();
        
        for (let i = 0; i < local.length; i++) {
          for (let j = i + 1; j < local.length; j++) {
            const A = local[i], B = local[j];
            if (A.id === "sun" || B.id === "sun") continue;
            
            // Check cooldown to prevent multiple collision triggers
            const collisionKey = [A.id, B.id].sort().join('_');
            const lastCollision = collisionCooldown.current.get(collisionKey) || 0;
            if (currentTime - lastCollision < 1000) continue; // 1 second cooldown
            
            // Handle realistic collision
            const collisionOccurred = handleRealisticCollision(A, B, setLog, local, setBodies);
            if (collisionOccurred) {
              collisionCooldown.current.set(collisionKey, currentTime);
              break; // Break inner loop since bodies array will change
            }
          }
        }
      }
    }

    const newBodies = local.map(lb => ({ ...lb, position: lb.position, velocity: lb.velocity }));
    setBodies(newBodies);
    
    if (onPhysicsUpdate) {
      onPhysicsUpdate();
    }
  });
  
  return null;
}

/* ---------- Main Component ---------- */
export default function RealisticCollisionSolarSystem() {
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

  const triggerOrbitUpdate = () => {
    setOrbitUpdateTrigger(prev => prev + 1);
  };

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

  function addPlanet() {
    const id = `p_${Math.random().toString(36).slice(2, 8)}`;
    const outerOrbit = Math.max(...bodies.filter(b => b.id !== 'sun').map(b => b.orbitalElements.a / AU));
    const a = (outerOrbit + 2 + Math.random() * 3) * AU;
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
      radius: 0.3 + Math.random() * 0.4,
      baseRadius: 0.3 + Math.random() * 0.4,
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
          camera={{ position: [0, 40, 80], fov: 45 }}
          shadows
        >
          <color attach="background" args={[bgColor]} />
          
          <ambientLight intensity={0.5} />
          <directionalLight 
            position={[30, 50, 30]}
            intensity={1.2} 
            castShadow
          />
          <pointLight 
            position={[0, 0, 0]} 
            intensity={2.5} 
            distance={200}
            decay={1.5} 
            color="#ffaa33"
          />

          {showEllipses && bodies.map(b => b.id !== "sun" ? 
            <EllipseLine 
              key={`ell_${b.id}`} 
              body={b} 
              bodies={bodies}
              cameraDistance={cameraDistance}
              forceUpdate={orbitUpdateTrigger}
            /> 
          : null)}

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
            minDistance={10}
            maxDistance={500}
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
        
        <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white px-3 py-2 rounded text-sm">
          Zoom: {Math.round(cameraDistance)} units
        </div>
      </div>

      <div className="w-1/4 h-full bg-gray-900 text-white p-4 overflow-auto border-l border-gray-700">
        <h2 className="text-xl font-bold mb-3 text-yellow-200">Solar System Simulator</h2>
        <div className="mb-3 text-sm text-gray-300 bg-gray-800 p-2 rounded">
          Kramer Please Give Us an A
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
            <label className="text-sm font-medium">Enable Realistic Collisions</label>
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
                  max="3" 
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

        {log.length > 0 && (
          <div className="mt-6">
            <h3 className="font-bold mb-2 text-yellow-200">Collision Events</h3>
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