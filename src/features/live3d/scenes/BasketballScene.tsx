import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { LiveGameState } from "../types";

function Court() {
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[28, 15]} />
        <meshStandardMaterial color="#b8884a" />
      </mesh>
      {/* center circle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[1.7, 1.85, 64]} />
        <meshBasicMaterial color="white" />
      </mesh>
      {/* center line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[0.1, 15]} />
        <meshBasicMaterial color="white" />
      </mesh>
      {/* sidelines */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0, 0, 4]} />
      </mesh>
      {[-14, 14].map((x) => (
        <Hoop key={x} x={x} />
      ))}
      {/* 3pt arcs */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[12.5 * s, 0.01, 0]}
        >
          <ringGeometry args={[6.7, 6.85, 32, 1, Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="white" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Hoop({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[0.15, 1.2, 2]} />
        <meshStandardMaterial color="white" />
      </mesh>
      <mesh
        position={[-Math.sign(x) * 0.5, 1.6, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.5, 0.05, 8, 24]} />
        <meshStandardMaterial color="#ff6a00" />
      </mesh>
    </group>
  );
}

function PlayerMarker({
  x,
  z,
  color,
  num,
}: {
  x: number;
  z: number;
  color: string;
  num: string;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (!ref.current) return;
    ref.current.position.x = x + Math.sin(s.clock.elapsedTime + Number(num)) * 0.4;
    ref.current.position.z = z + Math.cos(s.clock.elapsedTime * 0.7 + Number(num)) * 0.4;
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh castShadow position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 1.8, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 2.05, 0]}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color="#f1c27d" />
      </mesh>
      <Text
        position={[0, 0.9, 0.46]}
        fontSize={0.45}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {num}
      </Text>
    </group>
  );
}

function Ball({ possession }: { possession: "home" | "away" | "neutral" }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const t = s.clock.elapsedTime;
    const target = possession === "home" ? -11 : possession === "away" ? 11 : 0;
    ref.current.position.x += (target + Math.sin(t * 2) * 2 - ref.current.position.x) * 0.02;
    ref.current.position.y = 1.2 + Math.abs(Math.sin(t * 4)) * 0.6;
    ref.current.position.z = Math.sin(t * 1.3) * 3;
  });
  return (
    <mesh ref={ref} castShadow position={[0, 1.2, 0]}>
      <sphereGeometry args={[0.35, 24, 24]} />
      <meshStandardMaterial color="#d2691e" />
    </mesh>
  );
}

export function BasketballScene({ state }: { state: LiveGameState }) {
  const possession =
    state.possession === state.home_team
      ? "home"
      : state.possession === state.away_team
        ? "away"
        : "neutral";
  const home = "#1e6fff";
  const away = "#ff3b3b";
  // 5 per team in stagger
  const lineup = [
    [-8, -3],
    [-6, 0],
    [-9, 3],
    [-4, -2],
    [-5, 2],
  ];
  return (
    <>
      <Court />
      <Ball possession={possession} />
      {lineup.map(([x, z], i) => (
        <PlayerMarker key={`h${i}`} x={x} z={z} color={home} num={String(i + 1)} />
      ))}
      {lineup.map(([x, z], i) => (
        <PlayerMarker key={`a${i}`} x={-x} z={z} color={away} num={String(i + 6)} />
      ))}
    </>
  );
}