import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveGameState } from "../types";

type Kind = "football" | "hockey" | "soccer";

const CFG: Record<Kind, { surface: string; w: number; h: number; lines: string }> = {
  football: { surface: "#2f7a3a", w: 30, h: 13, lines: "white" },
  hockey: { surface: "#eaf3ff", w: 26, h: 12, lines: "#aac6e8" },
  soccer: { surface: "#2f7a3a", w: 30, h: 18, lines: "white" },
};

function Player({ x, z, color }: { x: number; z: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (!ref.current) return;
    ref.current.position.x = x + Math.sin(s.clock.elapsedTime + x) * 0.6;
    ref.current.position.z = z + Math.cos(s.clock.elapsedTime * 0.8 + z) * 0.6;
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh castShadow position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 1.6, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.85, 0]}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshStandardMaterial color="#f1c27d" />
      </mesh>
    </group>
  );
}

function BallOrPuck({ kind }: { kind: Kind }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const t = s.clock.elapsedTime;
    ref.current.position.x = Math.sin(t * 0.6) * 8;
    ref.current.position.z = Math.cos(t * 0.45) * 4;
    ref.current.position.y = kind === "hockey" ? 0.1 : 0.4 + Math.abs(Math.sin(t * 3)) * 0.3;
  });
  if (kind === "hockey") {
    return (
      <mesh ref={ref} castShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.12, 24]} />
        <meshStandardMaterial color="#111" />
      </mesh>
    );
  }
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[kind === "football" ? 0.3 : 0.32, 16, 16]} />
      <meshStandardMaterial color={kind === "football" ? "#7a3a16" : "white"} />
    </mesh>
  );
}

export function GenericFieldScene({
  state: _state,
  kind,
  perSide = 5,
}: {
  state: LiveGameState;
  kind: Kind;
  perSide?: number;
}) {
  const cfg = CFG[kind];
  const home = "#1e6fff";
  const away = "#ff3b3b";
  const positions: [number, number][] = [];
  const cols = perSide;
  for (let i = 0; i < cols; i++) {
    const z = -cfg.h / 2 + (cfg.h / (cols - 1)) * i;
    positions.push([-cfg.w / 4, z]);
    positions.push([cfg.w / 4, z]);
  }
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[cfg.w + 4, cfg.h + 3]} />
        <meshStandardMaterial color={cfg.surface} />
      </mesh>
      {/* center line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[0.15, cfg.h]} />
        <meshBasicMaterial color={cfg.lines} />
      </mesh>
      {/* center circle for soccer */}
      {kind === "soccer" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[2.4, 2.55, 64]} />
          <meshBasicMaterial color="white" />
        </mesh>
      )}
      {/* yard lines for football */}
      {kind === "football" &&
        [-12, -8, -4, 4, 8, 12].map((x) => (
          <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, 0]}>
            <planeGeometry args={[0.1, cfg.h]} />
            <meshBasicMaterial color="white" />
          </mesh>
        ))}
      <BallOrPuck kind={kind} />
      {positions.map(([x, z], i) => (
        <Player key={i} x={x} z={z} color={i % 2 === 0 ? home : away} />
      ))}
    </>
  );
}