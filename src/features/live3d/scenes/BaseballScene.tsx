import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveGameState } from "../types";

function Diamond() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[18, 64]} />
        <meshStandardMaterial color="#3a7d3a" />
      </mesh>
      {/* infield dirt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[7.5, 64]} />
        <meshStandardMaterial color="#a0703f" />
      </mesh>
      {/* bases */}
      {[
        [0, 0, 0], // home
        [4.5, 0.02, -4.5], // 1st
        [0, 0.02, -9], // 2nd
        [-4.5, 0.02, -4.5], // 3rd
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <planeGeometry args={[0.9, 0.9]} />
          <meshStandardMaterial color="white" />
        </mesh>
      ))}
      {/* pitcher mound */}
      <mesh position={[0, 0.05, -4.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.9, 24]} />
        <meshStandardMaterial color="#c79064" />
      </mesh>
    </group>
  );
}

function Ball() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const t = (s.clock.elapsedTime % 3) / 3;
    // pitch from mound (-4.5z) to plate (0z)
    ref.current.position.z = -4.5 + t * 4.5;
    ref.current.position.y = 1.5 - t * 0.6;
    ref.current.position.x = Math.sin(t * 6) * 0.1;
  });
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshStandardMaterial color="white" />
    </mesh>
  );
}

function Fielder({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1.4, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.65, 0]}>
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshStandardMaterial color="#f1c27d" />
      </mesh>
    </group>
  );
}

export function BaseballScene({ state: _state }: { state: LiveGameState }) {
  const def = "#1e6fff";
  const positions: [number, number][] = [
    [0, -4.5], // pitcher
    [0, 0.5], // catcher
    [5, -3], // 1B
    [3, -7], // 2B
    [-3, -7], // SS
    [-5, -3], // 3B
    [-8, -12], // LF
    [0, -15], // CF
    [8, -12], // RF
  ];
  return (
    <>
      <Diamond />
      <Ball />
      {positions.map(([x, z], i) => (
        <Fielder key={i} x={x} z={z} color={def} />
      ))}
      {/* batter */}
      <Fielder x={-0.6} z={0.2} color="#ff3b3b" />
    </>
  );
}