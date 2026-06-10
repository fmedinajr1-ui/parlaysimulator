import { useMemo } from "react";
import * as THREE from "three";
import { POSES, type PoseName } from "./poses";

// Shared geometries — instanced across all avatars in a scene.
const G_HEAD = new THREE.SphereGeometry(0.22, 16, 16);
const G_TORSO = new THREE.BoxGeometry(0.7, 0.85, 0.4);
const G_ARM_UPPER = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10);
const G_ARM_LOWER = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10);
const G_LEG_UPPER = new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10);
const G_LEG_LOWER = new THREE.CylinderGeometry(0.1, 0.1, 0.55, 10);
const G_FOOT = new THREE.BoxGeometry(0.22, 0.1, 0.36);

// pre-translate so child meshes pivot from joint (top of limb).
G_ARM_UPPER.translate(0, -0.275, 0);
G_ARM_LOWER.translate(0, -0.25, 0);
G_LEG_UPPER.translate(0, -0.3, 0);
G_LEG_LOWER.translate(0, -0.275, 0);

const SKIN = new THREE.MeshStandardMaterial({ color: "#d9a672", roughness: 0.7 });

// Cache jersey materials per (color|number) so identical avatars share GPU state.
const jerseyCache = new Map<string, THREE.MeshStandardMaterial>();
function jerseyMaterial(color: string, num?: number): THREE.MeshStandardMaterial {
  const key = `${color}|${num ?? ""}`;
  const hit = jerseyCache.get(key);
  if (hit) return hit;

  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  if (num != null) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "white";
    ctx.font = "bold 180px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(num), 128, 138);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    mat.map = tex;
  }
  jerseyCache.set(key, mat);
  return mat;
}

const shortsCache = new Map<string, THREE.MeshStandardMaterial>();
function shortsMaterial(color: string): THREE.MeshStandardMaterial {
  const hit = shortsCache.get(color);
  if (hit) return hit;
  // darken the jersey color for shorts
  const c = new THREE.Color(color).multiplyScalar(0.6);
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.65 });
  shortsCache.set(color, m);
  return m;
}

const shoeCache = new Map<string, THREE.MeshStandardMaterial>();
function shoeMaterial(color: string): THREE.MeshStandardMaterial {
  const hit = shoeCache.get(color);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.3),
    roughness: 0.8,
  });
  shoeCache.set(color, m);
  return m;
}

export type PlayerAvatarProps = {
  position?: [number, number, number];
  rotationY?: number;
  teamColor: string;
  number?: number;
  pose?: PoseName;
  scale?: number;
};

export function PlayerAvatar({
  position = [0, 0, 0],
  rotationY = 0,
  teamColor,
  number,
  pose = "idle",
  scale = 1,
}: PlayerAvatarProps) {
  const rig = POSES[pose];
  const jersey = useMemo(() => jerseyMaterial(teamColor, number), [teamColor, number]);
  const shorts = useMemo(() => shortsMaterial(teamColor), [teamColor]);
  const shoes = useMemo(() => shoeMaterial(teamColor), [teamColor]);

  // Joint y positions (legs grounded so feet touch y=0)
  const Y_HIP = 1.0;
  const Y_SHOULDER = 1.85;
  const Y_HEAD = 2.15;

  return (
    <group position={[position[0], position[1] + rig.crouch, position[2]]} rotation={[0, rotationY, 0]} scale={scale}>
      {/* head */}
      <mesh geometry={G_HEAD} material={SKIN} position={[0, Y_HEAD, 0]} castShadow />
      {/* torso (rotated for batting/running lean) */}
      <group position={[0, Y_HIP + 0.42, 0]} rotation={rig.torso}>
        <mesh geometry={G_TORSO} material={jersey} castShadow />
        {/* shorts as a thinner block under torso */}
        <mesh material={shorts} position={[0, -0.55, 0]} castShadow>
          <boxGeometry args={[0.72, 0.3, 0.42]} />
        </mesh>
      </group>

      {/* left arm */}
      <group position={[-0.42, Y_SHOULDER, 0]} rotation={rig.leftArm}>
        <mesh geometry={G_ARM_UPPER} material={jersey} castShadow />
        <group position={[0, -0.55, 0]} rotation={rig.leftForearm}>
          <mesh geometry={G_ARM_LOWER} material={SKIN} castShadow />
        </group>
      </group>
      {/* right arm */}
      <group position={[0.42, Y_SHOULDER, 0]} rotation={rig.rightArm}>
        <mesh geometry={G_ARM_UPPER} material={jersey} castShadow />
        <group position={[0, -0.55, 0]} rotation={rig.rightForearm}>
          <mesh geometry={G_ARM_LOWER} material={SKIN} castShadow />
        </group>
      </group>

      {/* left leg */}
      <group position={[-0.18, Y_HIP, 0]} rotation={rig.leftLeg}>
        <mesh geometry={G_LEG_UPPER} material={shorts} castShadow />
        <group position={[0, -0.6, 0]} rotation={rig.leftShin}>
          <mesh geometry={G_LEG_LOWER} material={shorts} castShadow />
          <mesh geometry={G_FOOT} material={shoes} position={[0, -0.6, 0.06]} castShadow />
        </group>
      </group>
      {/* right leg */}
      <group position={[0.18, Y_HIP, 0]} rotation={rig.rightLeg}>
        <mesh geometry={G_LEG_UPPER} material={shorts} castShadow />
        <group position={[0, -0.6, 0]} rotation={rig.rightShin}>
          <mesh geometry={G_LEG_LOWER} material={shorts} castShadow />
          <mesh geometry={G_FOOT} material={shoes} position={[0, -0.6, 0.06]} castShadow />
        </group>
      </group>
    </group>
  );
}