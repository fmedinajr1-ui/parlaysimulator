// Joint rotations (radians) per pose. Used by PlayerAvatar.
// Axes are local to each limb; +x bends forward, +z to the side.

export type PoseName =
  | "idle"
  | "running"
  | "shooting"
  | "batting"
  | "pitching"
  | "skating"
  | "goalie"
  | "catcher";

export type PoseRig = {
  // shoulders / elbows
  leftArm: [number, number, number];
  rightArm: [number, number, number];
  leftForearm: [number, number, number];
  rightForearm: [number, number, number];
  // hips / knees
  leftLeg: [number, number, number];
  rightLeg: [number, number, number];
  leftShin: [number, number, number];
  rightShin: [number, number, number];
  torso: [number, number, number];
  // crouch — y offset added to the whole avatar
  crouch: number;
};

const ZERO: [number, number, number] = [0, 0, 0];

export const POSES: Record<PoseName, PoseRig> = {
  idle: {
    leftArm: [0.1, 0, 0.15],
    rightArm: [0.1, 0, -0.15],
    leftForearm: [0.2, 0, 0],
    rightForearm: [0.2, 0, 0],
    leftLeg: ZERO,
    rightLeg: ZERO,
    leftShin: ZERO,
    rightShin: ZERO,
    torso: ZERO,
    crouch: 0,
  },
  running: {
    leftArm: [-0.9, 0, 0.1],
    rightArm: [0.9, 0, -0.1],
    leftForearm: [1.0, 0, 0],
    rightForearm: [1.0, 0, 0],
    leftLeg: [0.7, 0, 0],
    rightLeg: [-0.7, 0, 0],
    leftShin: [0.4, 0, 0],
    rightShin: [0.9, 0, 0],
    torso: [0.15, 0, 0],
    crouch: -0.05,
  },
  shooting: {
    leftArm: [-2.4, 0, 0.4],
    rightArm: [-2.4, 0, -0.4],
    leftForearm: [-0.7, 0, 0],
    rightForearm: [-0.7, 0, 0],
    leftLeg: [-0.2, 0, 0.1],
    rightLeg: [-0.2, 0, -0.1],
    leftShin: [0.4, 0, 0],
    rightShin: [0.4, 0, 0],
    torso: [-0.1, 0, 0],
    crouch: -0.1,
  },
  batting: {
    leftArm: [-1.6, 0, 1.1],
    rightArm: [-1.6, 0, 0.9],
    leftForearm: [-0.6, 0, 0.3],
    rightForearm: [-0.6, 0, 0.3],
    leftLeg: [0.2, 0, 0.3],
    rightLeg: [0.2, 0, -0.3],
    leftShin: [0.3, 0, 0],
    rightShin: [0.3, 0, 0],
    torso: [0, 0.4, 0],
    crouch: -0.2,
  },
  pitching: {
    leftArm: [-2.6, 0, 0.6],
    rightArm: [1.4, 0, -0.6],
    leftForearm: [-0.8, 0, 0],
    rightForearm: [0.6, 0, 0],
    leftLeg: [-0.6, 0, 0.2],
    rightLeg: [0.4, 0, -0.2],
    leftShin: [0.5, 0, 0],
    rightShin: [0.6, 0, 0],
    torso: [0.2, 0, 0],
    crouch: -0.1,
  },
  skating: {
    leftArm: [-0.4, 0, 0.6],
    rightArm: [-0.4, 0, -0.6],
    leftForearm: [0.8, 0, 0],
    rightForearm: [0.8, 0, 0],
    leftLeg: [0.3, 0, 0.3],
    rightLeg: [-0.2, 0, -0.3],
    leftShin: [0.5, 0, 0],
    rightShin: [0.5, 0, 0],
    torso: [0.35, 0, 0],
    crouch: -0.15,
  },
  goalie: {
    leftArm: [-0.3, 0, 1.3],
    rightArm: [-0.3, 0, -1.3],
    leftForearm: [-0.5, 0, 0],
    rightForearm: [-0.5, 0, 0],
    leftLeg: [0.1, 0, 0.5],
    rightLeg: [0.1, 0, -0.5],
    leftShin: [0.2, 0, 0],
    rightShin: [0.2, 0, 0],
    torso: [0.1, 0, 0],
    crouch: -0.25,
  },
  catcher: {
    leftArm: [-1.4, 0, 0.4],
    rightArm: [-1.0, 0, -0.4],
    leftForearm: [-0.6, 0, 0],
    rightForearm: [-0.4, 0, 0],
    leftLeg: [1.5, 0, 0.4],
    rightLeg: [1.5, 0, -0.4],
    leftShin: [1.6, 0, 0],
    rightShin: [1.6, 0, 0],
    torso: [0.3, 0, 0],
    crouch: -0.6,
  },
};