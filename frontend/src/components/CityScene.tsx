import { OrbitControls, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { city } from "../sim/city";
import { useSimulationStore } from "../state/simulationStore";
import type { Building, CandidateScore, CarAgent, ParkingSpot, RoadEdge, Vec2 } from "../types";

const nodePosition = (id: string) => city.nodes.find((node) => node.id === id)!.position;

const CAMERA_HOME = new THREE.Vector3(0, 166, 132);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const CAMERA_PAN_LIMITS = {
  minX: -62,
  maxX: 62,
  minZ: -42,
  maxZ: 42,
};

const cameraFitZoom = (width: number, height: number) => {
  const paddedWorldWidth = 214;
  const paddedWorldHeight = 178;
  return THREE.MathUtils.clamp(
    Math.min(width / paddedWorldWidth, height / paddedWorldHeight),
    1.65,
    5.2,
  );
};

export function CityScene() {
  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: CAMERA_HOME.toArray(), zoom: 4.7, near: 0.1, far: 1000 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#eaf2ef"]} />
      <ambientLight intensity={0.78} />
      <directionalLight position={[-46, 90, 62]} intensity={1.35} />
      <SceneContent />
      <CameraRig />
    </Canvas>
  );
}

function SceneContent() {
  const tick = useSimulationStore((state) => state.tick);
  const cars = useSimulationStore((state) => state.cars);
  const selectedCarId = useSimulationStore((state) => state.selectedCarId);
  const selectCar = useSimulationStore((state) => state.selectCar);
  const elapsedSeconds = useSimulationStore((state) => state.elapsedSeconds);
  const selectedCar = cars.find((car) => car.id === selectedCarId) ?? cars[0];
  const selectedScores = useMemo(
    () => new Map(selectedCar?.candidateScores?.map((score) => [score.spot_id, score]) ?? []),
    [selectedCar?.candidateScores],
  );

  useFrame((_, delta) => tick(Math.min(delta, 0.05)));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <planeGeometry args={[196, 154]} />
        <meshStandardMaterial color="#d7e7df" roughness={0.92} />
      </mesh>
      <DistrictBlocks />

      {city.edges.map((edge) => (
        <Road key={edge.id} edge={edge} />
      ))}

      {selectedCar && <RouteHighlight car={selectedCar} />}

      {city.buildings.map((building) => (
        <BuildingBlock key={building.id} building={building} />
      ))}

      {city.destinations.map((destination) => (
        <DestinationPin key={destination.id} position={destination.position} name={destination.name} />
      ))}

      {city.parkingSpots.map((spot) => (
        <ParkingSpotMarker
          key={spot.id}
          spot={spot}
          candidateScore={selectedScores.get(spot.id)}
          isChosen={spot.id === selectedCar?.chosenSpotId}
          isNearestBaseline={spot.id === selectedCar?.baselineSpotId}
          showPendingCandidate={!selectedCar?.candidateScores && spot.legal && spot.accessible}
        />
      ))}

      {city.nodes
        .filter((node) => node.control)
        .map((node) => (
          <TrafficControl
            key={node.id}
            position={node.position}
            kind={node.control!}
            elapsedSeconds={elapsedSeconds}
          />
        ))}

      {cars.map((car) => (
        <CarMarker
          key={car.id}
          car={car}
          isSelected={car.id === selectedCarId}
          onSelect={() => selectCar(car.id)}
        />
      ))}
    </group>
  );
}

function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    camera.position.copy(CAMERA_HOME);
    camera.zoom = cameraFitZoom(size.width, size.height);
    camera.near = 0.1;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    controlsRef.current?.target.copy(CAMERA_TARGET);
    controlsRef.current?.update();
  }, [camera, size.height, size.width]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const clampedX = THREE.MathUtils.clamp(
      controls.target.x,
      CAMERA_PAN_LIMITS.minX,
      CAMERA_PAN_LIMITS.maxX,
    );
    const clampedZ = THREE.MathUtils.clamp(
      controls.target.z,
      CAMERA_PAN_LIMITS.minZ,
      CAMERA_PAN_LIMITS.maxZ,
    );
    const dx = clampedX - controls.target.x;
    const dz = clampedZ - controls.target.z;
    if (dx === 0 && dz === 0) return;
    controls.target.x = clampedX;
    controls.target.z = clampedZ;
    camera.position.x += dx;
    camera.position.z += dz;
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      enablePan
      enableRotate={false}
      maxZoom={8.6}
      minZoom={1.65}
      target={CAMERA_TARGET.toArray()}
    />
  );
}

function DistrictBlocks() {
  return (
    <group>
      {[
        { position: [-48, 0.02, -24], size: [36, 0.08, 34], color: "#cfe0dc" },
        { position: [0, 0.02, -22], size: [34, 0.08, 36], color: "#d8dfcf" },
        { position: [48, 0.02, -22], size: [38, 0.08, 34], color: "#d6dde7" },
        { position: [-48, 0.02, 24], size: [36, 0.08, 36], color: "#d6e4d2" },
        { position: [0, 0.02, 24], size: [34, 0.08, 34], color: "#d7e4e2" },
        { position: [48, 0.02, 24], size: [38, 0.08, 36], color: "#e2dccf" },
      ].map((block) => (
        <mesh key={block.position.join(":")} position={block.position as [number, number, number]}>
          <boxGeometry args={block.size as [number, number, number]} />
          <meshStandardMaterial color={block.color} roughness={0.96} />
        </mesh>
      ))}
    </group>
  );
}

function Road({ edge }: { edge: RoadEdge }) {
  const from = nodePosition(edge.from);
  const to = nodePosition(edge.to);
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const angle = Math.atan2(to.z - from.z, to.x - from.x);
  return (
    <group position={[(from.x + to.x) / 2, 0, (from.z + to.z) / 2]} rotation={[0, -angle, 0]}>
      <mesh>
        <boxGeometry args={[length, 0.18, 10.6]} />
        <meshStandardMaterial color="#334155" roughness={0.86} />
      </mesh>
      <mesh position={[0, 0.16, -4.72]}>
        <boxGeometry args={[length, 0.16, 0.44]} />
        <meshStandardMaterial color="#e6ede9" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.16, 4.72]}>
        <boxGeometry args={[length, 0.16, 0.44]} />
        <meshStandardMaterial color="#e6ede9" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[Math.max(2, length - 7.2), 0.08, edge.oneWay ? 0.44 : 0.28]} />
        <meshStandardMaterial color={edge.oneWay ? "#facc15" : "#e2e8f0"} />
      </mesh>
      {edge.oneWay && (
        <mesh position={[length / 2 - 6, 0.28, 0]} rotation={[0, 0, -Math.PI / 4]}>
          <coneGeometry args={[1.4, 2.8, 3]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
      )}
    </group>
  );
}

function BuildingBlock({ building }: { building: Building }) {
  const colorByKind = {
    civic: "#667085",
    office: "#7c3aed",
    residential: "#0f766e",
    retail: "#d97706",
  };
  const capColorByKind = {
    civic: "#98a2b3",
    office: "#a78bfa",
    residential: "#2dd4bf",
    retail: "#f59e0b",
  };
  return (
    <group position={[building.position.x, 0, building.position.z]}>
      <mesh position={[0, building.height / 2, 0]}>
        <boxGeometry args={[building.size.x, building.height, building.size.z]} />
        <meshStandardMaterial color={colorByKind[building.kind]} roughness={0.58} />
      </mesh>
      <mesh position={[0, building.height + 0.34, 0]}>
        <boxGeometry args={[building.size.x + 0.8, 0.7, building.size.z + 0.8]} />
        <meshStandardMaterial color={capColorByKind[building.kind]} roughness={0.5} />
      </mesh>
      <BuildingWindows building={building} />
      <Text
        position={[0, building.height + 2.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={2.3}
        color="#24332f"
        anchorX="center"
        anchorY="middle"
      >
        {building.name}
      </Text>
    </group>
  );
}

function BuildingWindows({ building }: { building: Building }) {
  const frontCount = Math.max(2, Math.floor(building.size.x / 6));
  const floors = Math.max(1, Math.floor(building.height / 6));
  return (
    <group>
      {Array.from({ length: floors }).map((_, floor) =>
        Array.from({ length: frontCount }).map((__, index) => (
          <mesh
            key={`${floor}-${index}`}
            position={[
              -building.size.x / 2 + 3.6 + index * ((building.size.x - 7.2) / Math.max(1, frontCount - 1)),
              4 + floor * 5,
              building.size.z / 2 + 0.06,
            ]}
          >
            <boxGeometry args={[2.3, 1.4, 0.12]} />
            <meshStandardMaterial color="#d9f99d" emissive="#84cc16" emissiveIntensity={0.12} />
          </mesh>
        )),
      )}
    </group>
  );
}

function DestinationPin({ position, name }: { position: Vec2; name: string }) {
  return (
    <group position={[position.x, 0.48, position.z]}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[5.1, 5.1, 0.38, 28]} />
        <meshStandardMaterial color="#0f172a" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <torusGeometry args={[6.1, 0.3, 8, 36]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 4.3, 0]}>
        <coneGeometry args={[2.4, 7.2, 24]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.48} />
      </mesh>
      <Text
        position={[0, 9.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={3.2}
        color="#0f172a"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </group>
  );
}

function RouteHighlight({ car }: { car: CarAgent }) {
  const points = routePoints(car);
  if (points.length < 2) return null;
  const routeColor = car.chosenSpotId ? "#f59e0b" : car.color;

  return (
    <group>
      {points.slice(0, -1).map((point, index) => (
        <RouteSegment
          key={`${point.x}:${point.z}:${index}`}
          from={point}
          to={points[index + 1]}
          color={routeColor}
          isActiveLeg={index === 0}
        />
      ))}
      {points.slice(1).map((point, index) => (
        <mesh key={`${point.x}:${point.z}:node:${index}`} position={[point.x, 0.44, point.z]}>
          <cylinderGeometry args={[2.05, 2.05, 0.32, 16]} />
          <meshStandardMaterial color={routeColor} emissive={routeColor} emissiveIntensity={0.12} />
        </mesh>
      ))}
    </group>
  );
}

function RouteSegment({
  from,
  to,
  color,
  isActiveLeg,
}: {
  from: Vec2;
  to: Vec2;
  color: string;
  isActiveLeg: boolean;
}) {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length < 0.1) return null;
  const angle = Math.atan2(to.z - from.z, to.x - from.x);

  return (
    <group position={[(from.x + to.x) / 2, 0.43, (from.z + to.z) / 2]} rotation={[0, -angle, 0]}>
      <mesh>
        <boxGeometry args={[Math.max(0.1, length - 3.2), isActiveLeg ? 0.42 : 0.3, isActiveLeg ? 3.7 : 2.7]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActiveLeg ? 0.18 : 0.08} />
      </mesh>
      {isActiveLeg && (
        <mesh position={[length / 2 - 3, 0.38, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[1.8, 3.8, 3]} />
          <meshStandardMaterial color="#fef3c7" emissive={color} emissiveIntensity={0.25} />
        </mesh>
      )}
    </group>
  );
}

function routePoints(car: CarAgent): Vec2[] {
  const nextNodeIds = car.path.slice(Math.min(car.pathIndex + 1, car.path.length));
  return [car.position, ...nextNodeIds.map(nodePosition)];
}

function ParkingSpotMarker({
  spot,
  candidateScore,
  isChosen,
  isNearestBaseline,
  showPendingCandidate,
}: {
  spot: ParkingSpot;
  candidateScore?: CandidateScore;
  isChosen: boolean;
  isNearestBaseline: boolean;
  showPendingCandidate: boolean;
}) {
  const isCandidate = Boolean(candidateScore) || showPendingCandidate;
  const isEligibleCandidate = candidateScore?.eligible ?? showPendingCandidate;
  const baseColor = !spot.legal ? "#fecaca" : !spot.accessible ? "#cbd5e1" : "#f8fafc";
  const edgeColor = !spot.legal ? "#dc2626" : !spot.accessible ? "#475569" : "#94a3b8";

  return (
    <group position={[spot.position.x, 0, spot.position.z]}>
      {isCandidate && (
        <CandidateParkingCue rank={candidateScore?.rank} eligible={isEligibleCandidate} />
      )}
      {isNearestBaseline && <NearestBaselineCue />}
      {isChosen && <ChosenParkingCue />}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[5.8, 0.36, 7.8]} />
        <meshStandardMaterial color={baseColor} roughness={0.76} />
      </mesh>
      <mesh position={[0, 0.4, -3.6]}>
        <boxGeometry args={[5.6, 0.18, 0.34]} />
        <meshStandardMaterial color={edgeColor} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.4, 3.6]}>
        <boxGeometry args={[5.6, 0.18, 0.34]} />
        <meshStandardMaterial color={edgeColor} roughness={0.7} />
      </mesh>
      {spot.legal && spot.accessible && <ParkingLetter />}
      {!spot.legal && <IllegalParkingCue />}
      {spot.legal && !spot.accessible && <InaccessibleParkingCue />}
    </group>
  );
}

function CandidateParkingCue({ rank, eligible }: { rank?: number; eligible: boolean }) {
  const color = eligible ? "#38bdf8" : "#fb7185";
  const height = rank ? Math.max(0.7, 2.2 - rank * 0.22) : 0.85;
  return (
    <group>
      <mesh position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.4, eligible ? 0.22 : 0.16, 8, 42]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[-3.8, 0.55 + height / 2, -4.5]}>
        <cylinderGeometry args={[0.52, 0.52, height, 10]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  );
}

function ChosenParkingCue() {
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[4.7, 4.7, 0.54, 6]} />
        <meshStandardMaterial color="#facc15" emissive="#eab308" emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[3.9, 4.3, -3.9]}>
        <coneGeometry args={[1.45, 5.4, 4]} />
        <meshStandardMaterial color="#f59e0b" emissive="#facc15" emissiveIntensity={0.18} />
      </mesh>
    </group>
  );
}

function NearestBaselineCue() {
  return (
    <group>
      <mesh position={[0, 0.96, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6.8, 0.26, 8, 42]} />
        <meshStandardMaterial color="#8b5cf6" emissive="#7c3aed" emissiveIntensity={0.2} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          position={[
            Math.cos((index / 3) * Math.PI * 2) * 6.2,
            1.24,
            Math.sin((index / 3) * Math.PI * 2) * 6.2,
          ]}
        >
          <coneGeometry args={[0.8, 1.9, 3]} />
          <meshStandardMaterial color="#8b5cf6" roughness={0.44} />
        </mesh>
      ))}
    </group>
  );
}

function ParkingLetter() {
  return (
    <Text
      position={[0, 0.62, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={3.3}
      color="#475569"
      anchorX="center"
      anchorY="middle"
    >
      P
    </Text>
  );
}

function IllegalParkingCue() {
  return (
    <group>
      <mesh position={[0, 0.68, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.72, 0.46, 8.9]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[0.72, 0.46, 8.9]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      <mesh position={[-3.8, 2.7, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.38, 1.38, 0.22, 28]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
      <mesh position={[-3.8, 2.7, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.38, 0.42, 2.9]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-3.8, 1.38, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 2.6, 8]} />
        <meshStandardMaterial color="#7f1d1d" />
      </mesh>
    </group>
  );
}

function InaccessibleParkingCue() {
  return (
    <group>
      {[-2.2, 0, 2.2].map((offset) => (
        <mesh key={offset} position={[offset, 0.73, 0]} rotation={[0, -Math.PI / 5, 0]}>
          <boxGeometry args={[0.38, 0.42, 8.5]} />
          <meshStandardMaterial color="#64748b" roughness={0.68} />
        </mesh>
      ))}
      {[-3.1, 3.1].map((offset) => (
        <mesh key={offset} position={[offset, 1.42, 3.3]}>
          <cylinderGeometry args={[0.48, 0.6, 2.1, 12]} />
          <meshStandardMaterial color="#1f2937" roughness={0.52} />
        </mesh>
      ))}
    </group>
  );
}

function TrafficControl({
  position,
  kind,
  elapsedSeconds,
}: {
  position: Vec2;
  kind: "stop" | "traffic-light";
  elapsedSeconds: number;
}) {
  const isGreen = Math.floor(elapsedSeconds / 7) % 2 === 1;
  return (
    <group position={[position.x + 5.4, 0, position.z + 5.4]}>
      {kind === "stop" ? <StopSign /> : <TrafficLight isGreen={isGreen} />}
    </group>
  );
}

function StopSign() {
  return (
    <group>
      <mesh position={[0, 1.9, 0]}>
        <cylinderGeometry args={[0.16, 0.18, 3.8, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.2} roughness={0.42} />
      </mesh>
      <mesh position={[0, 4.55, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.48, 1.48, 0.28, 8]} />
        <meshStandardMaterial color="#dc2626" roughness={0.38} />
      </mesh>
      <Text
        position={[0, 4.55, 0.22]}
        fontSize={0.72}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        STOP
      </Text>
    </group>
  );
}

function TrafficLight({ isGreen }: { isGreen: boolean }) {
  return (
    <group>
      <mesh position={[0, 2.1, 0]}>
        <cylinderGeometry args={[0.16, 0.18, 4.2, 10]} />
        <meshStandardMaterial color="#475569" metalness={0.2} roughness={0.42} />
      </mesh>
      <mesh position={[0, 4.7, 0]}>
        <boxGeometry args={[1.35, 3.45, 0.9]} />
        <meshStandardMaterial color="#111827" roughness={0.34} />
      </mesh>
      {[
        { y: 5.72, color: "#ef4444", active: !isGreen },
        { y: 4.7, color: "#f59e0b", active: false },
        { y: 3.68, color: "#22c55e", active: isGreen },
      ].map((light) => (
        <mesh key={light.y} position={[0, light.y, 0.49]}>
          <sphereGeometry args={[0.34, 16, 12]} />
          <meshStandardMaterial
            color={light.color}
            emissive={light.color}
            emissiveIntensity={light.active ? 0.85 : 0.08}
          />
        </mesh>
      ))}
    </group>
  );
}

function CarMarker({
  car,
  isSelected,
  onSelect,
}: {
  car: CarAgent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const heading = carHeading(car);
  const stateColor = carStateColor(car);
  return (
    <group
      position={[car.position.x, 0.18, car.position.z]}
      rotation={[0, heading, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {isSelected && (
        <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[4.85, 0.3, 8, 40]} />
          <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.22} />
        </mesh>
      )}
      {car.state === "parked" && (
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[4.2, 4.2, 0.18, 20]} />
          <meshStandardMaterial color="#10b981" roughness={0.6} />
        </mesh>
      )}
      <mesh position={[0, 1.06, 0]}>
        <boxGeometry args={[4.55, 1.5, 7.2]} />
        <meshStandardMaterial color={isSelected ? "#facc15" : car.color} roughness={0.46} />
      </mesh>
      <mesh position={[0, 2.1, -0.5]}>
        <boxGeometry args={[3.25, 1.2, 3.6]} />
        <meshStandardMaterial color="#bae6fd" roughness={0.25} metalness={0.05} />
      </mesh>
      <mesh position={[0, 2.9, 2.9]}>
        <boxGeometry args={[2.4, 0.38, 1.1]} />
        <meshStandardMaterial color={stateColor} emissive={stateColor} emissiveIntensity={0.25} />
      </mesh>
      {[-2.4, 2.4].map((x) =>
        [-2.4, 2.4].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.76, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.54, 0.54, 0.5, 14]} />
            <meshStandardMaterial color="#111827" roughness={0.38} />
          </mesh>
        )),
      )}
      <CarStateCue state={car.state} color={stateColor} />
    </group>
  );
}

function CarStateCue({ state, color }: { state: CarAgent["state"]; color: string }) {
  if (state === "choosing_parking") {
    return (
      <group>
        <mesh position={[0, 4.1, 0]}>
          <sphereGeometry args={[1.05, 18, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} />
        </mesh>
        <mesh position={[1.25, 3.4, 1.25]} rotation={[0, 0, -Math.PI / 4]}>
          <cylinderGeometry args={[0.18, 0.18, 1.8, 10]} />
          <meshStandardMaterial color="#78350f" />
        </mesh>
      </group>
    );
  }

  if (state === "parking") {
    return (
      <mesh position={[0, 4.0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[1.15, 3.2, 3]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} />
      </mesh>
    );
  }

  if (state === "blocked") {
    return (
      <group>
        <mesh position={[0, 3.8, 0]} rotation={[0, Math.PI / 4, 0]}>
          <boxGeometry args={[0.46, 0.5, 3.7]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
        <mesh position={[0, 3.8, 0]} rotation={[0, -Math.PI / 4, 0]}>
          <boxGeometry args={[0.46, 0.5, 3.7]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      </group>
    );
  }

  return null;
}

function carStateColor(car: CarAgent) {
  if (car.state === "choosing_parking") return "#f97316";
  if (car.state === "parking") return "#f59e0b";
  if (car.state === "parked") return "#10b981";
  if (car.state === "blocked") return "#dc2626";
  return "#38bdf8";
}

function carHeading(car: CarAgent) {
  const nextNodeId = car.path[car.pathIndex + 1] ?? car.path[car.pathIndex];
  const nextNode = nextNodeId ? nodePosition(nextNodeId) : undefined;
  if (!nextNode) return 0;
  const dx = nextNode.x - car.position.x;
  const dz = nextNode.z - car.position.z;
  if (Math.hypot(dx, dz) < 0.1) return 0;
  return Math.atan2(dx, dz);
}
