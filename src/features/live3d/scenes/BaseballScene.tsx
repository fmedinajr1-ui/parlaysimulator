import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveGameState } from "../types";
import { PlayerAvatar } from "../components/PlayerAvatar";
import type { PoseName } from "../components/poses";

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

function Fielder({
  x,
  z,
  color,
  num,
  pose = "idle",
  facing = 0,
}: {
  x: number;
  z: number;
  color: string;
  num: number;
  pose?: PoseName;
  facing?: number;
}) {
  return (
    <PlayerAvatar
      position={[x, 0, z]}
      rotationY={facing}
      teamColor={color}
      number={num}
      pose={pose}
      scale={0.9}
    />
  );
}

export function BaseballScene({ state: _state }: { state: LiveGameState }) {
  const def = "#1e6fff";
  const fielders: Array<{ x: number; z: number; num: number; pose: PoseName }> = [
    { x: 0, z: -4.5, num: 17, pose: "pitching" },
    { x: 0, z: 0.5, num: 8, pose: "catcher" },
    { x: 5, z: -3, num: 25, pose: "idle" },
    { x: 3, z: -7, num: 4, pose: "idle" },
    { x: -3, z: -7, num: 11, pose: "idle" },
    { x: -5, z: -3, num: 2, pose: "idle" },
    { x: -8, z: -12, num: 19, pose: "idle" },
    { x: 0, z: -15, num: 22, pose: "idle" },
    { x: 8, z: -12, num: 27, pose: "idle" },
  ];
  return (
    <>
      <Diamond />
      <Ball />
      {fielders.map((f, i) => (
        <Fielder
          key={i}
          x={f.x}
          z={f.z}
          color={def}
          num={f.num}
          pose={f.pose}
          facing={Math.PI}
        />
      ))}
      {/* batter */}
      <Fielder x={-0.6} z={0.2} color="#ff3b3b" num={34} pose="batting" facing={-Math.PI / 2} />
    </>
  );
}