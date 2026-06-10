import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ReactNode } from "react";

export function SceneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-full h-full bg-gradient-to-b from-slate-900 to-slate-950 rounded-lg overflow-hidden">
      <Canvas shadows camera={{ position: [0, 18, 22], fov: 45 }}>
        <color attach="background" args={["#0b1220"]} />
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[10, 18, 10]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-10, 12, -8]} intensity={0.35} />
        {children}
        <OrbitControls
          enablePan={false}
          minDistance={10}
          maxDistance={45}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
      <div className="absolute bottom-2 right-2 text-[10px] uppercase tracking-wider text-white/40 bg-black/40 px-2 py-1 rounded">
        Visualized · not player-tracked
      </div>
    </div>
  );
}