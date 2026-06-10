import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveGameState } from "../types";
import { PlayerAvatar } from "../components/PlayerAvatar";
import type { PoseName } from "../components/poses";

type Kind = "football" | "hockey" | "soccer";

const CFG: Record<Kind, { surface: string; w: number; h: number; lines: string }> = {
  football: { surface: "#2f7a3a", w: 30, h: 13, lines: "white" },
  hockey: { surface: "#eaf3ff", w: 26, h: 12, lines: "#aac6e8" },
  soccer: { surface: "#2f7a3a", w: 30, h: 18, lines: "white" },
};

function Player({
  x,
  z,
  color,
  num,
  pose,
  facing,
}: {
  x: number;
  z: number;
  color: string;
  num: number;
  pose: PoseName;
  facing: number;
}) {
  return (
    <PlayerAvatar
      position={[x, 0, z]}
      rotationY={facing}
      teamColor={color}
      number={num}
      pose={pose}
    />
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
  const positions: Array<{ x: number; z: number; side: "home" | "away"; idx: number }> = [];
  const cols = perSide;
  for (let i = 0; i < cols; i++) {
    const z = -cfg.h / 2 + (cfg.h / (cols - 1)) * i;
    positions.push({ x: -cfg.w / 4, z, side: "home", idx: i });
    positions.push({ x: cfg.w / 4, z, side: "away", idx: i });
  }
  const defaultPose: PoseName =
    kind === "hockey" ? "skating" : kind === "football" ? "running" : "running";
  // mark the last index per side as a goalie/keeper for hockey & soccer
  const keeperIdx = cols - 1;
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
      {positions.map((p, i) => {
        const isKeeper = (kind === "hockey" || kind === "soccer") && p.idx === keeperIdx;
        return (
          <Player
            key={i}
            x={p.x}
            z={p.z}
            color={p.side === "home" ? home : away}
            num={(p.side === "home" ? 1 : 50) + p.idx}
            pose={isKeeper ? "goalie" : defaultPose}
            facing={p.side === "home" ? Math.PI / 2 : -Math.PI / 2}
          />
        );
      })}
    </>
  );
}