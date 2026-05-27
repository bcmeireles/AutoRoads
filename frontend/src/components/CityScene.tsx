import { OrbitControls, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import { city } from "../sim/city";
import { useSimulationStore } from "../state/simulationStore";
import type { Building, RoadEdge, Vec2 } from "../types";

const nodePosition = (id: string) => city.nodes.find((node) => node.id === id)!.position;

export function CityScene() {
  return (
    <Canvas orthographic camera={{ position: [0, 150, 150], zoom: 5.5, near: 0.1, far: 1000 }}>
      <color attach="background" args={["#e8f1ef"]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[30, 80, 40]} intensity={1.3} />
      <SceneContent />
      <OrbitControls
        enablePan
        enableRotate={false}
        minZoom={3.4}
        maxZoom={9}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}

function SceneContent() {
  const tick = useSimulationStore((state) => state.tick);
  const cars = useSimulationStore((state) => state.cars);
  const selectedCarId = useSimulationStore((state) => state.selectedCarId);
  const selectCar = useSimulationStore((state) => state.selectCar);
  const elapsedSeconds = useSimulationStore((state) => state.elapsedSeconds);

  useFrame((_, delta) => tick(Math.min(delta, 0.05)));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <planeGeometry args={[190, 150]} />
        <meshStandardMaterial color="#d5e5dc" />
      </mesh>

      {city.edges.map((edge) => (
        <Road key={edge.id} edge={edge} />
      ))}

      {city.buildings.map((building) => (
        <BuildingBlock key={building.id} building={building} />
      ))}

      {city.destinations.map((destination) => (
        <DestinationPin key={destination.id} position={destination.position} name={destination.name} />
      ))}

      {city.parkingSpots.map((spot) => (
        <mesh key={spot.id} position={[spot.position.x, 0.08, spot.position.z]}>
          <boxGeometry args={[5, 0.3, 7]} />
          <meshStandardMaterial color={spot.legal ? "#f8fafc" : "#f87171"} />
        </mesh>
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
        <mesh
          key={car.id}
          position={[car.position.x, 1.15, car.position.z]}
          onClick={(event) => {
            event.stopPropagation();
            selectCar(car.id);
          }}
        >
          <boxGeometry args={[4.5, 2.2, 7]} />
          <meshStandardMaterial
            color={car.id === selectedCarId ? "#facc15" : car.color}
            emissive={car.state === "choosing_parking" ? "#f59e0b" : "#000000"}
            emissiveIntensity={car.state === "choosing_parking" ? 0.5 : 0}
          />
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
        <boxGeometry args={[length, 0.2, 9]} />
        <meshStandardMaterial color="#475569" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[Math.max(2, length - 6), 0.08, 0.28]} />
        <meshStandardMaterial color={edge.oneWay ? "#fbbf24" : "#e2e8f0"} />
      </mesh>
    </group>
  );
}

function BuildingBlock({ building }: { building: Building }) {
  const colorByKind = {
    civic: "#64748b",
    office: "#7c3aed",
    residential: "#0f766e",
    retail: "#ea580c",
  };
  return (
    <mesh position={[building.position.x, building.height / 2, building.position.z]}>
      <boxGeometry args={[building.size.x, building.height, building.size.z]} />
      <meshStandardMaterial color={colorByKind[building.kind]} roughness={0.55} />
    </mesh>
  );
}

function DestinationPin({ position, name }: { position: Vec2; name: string }) {
  return (
    <group position={[position.x, 0.3, position.z]}>
      <mesh>
        <cylinderGeometry args={[3.2, 3.2, 0.45, 24]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <Text
        position={[0, 7.5, 0]}
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
  const color = kind === "stop" ? "#dc2626" : isGreen ? "#22c55e" : "#ef4444";
  const geometry = useMemo(() => new THREE.CylinderGeometry(1.8, 1.8, 4, 16), []);
  return (
    <mesh position={[position.x + 5, 2, position.z + 5]} geometry={geometry}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

