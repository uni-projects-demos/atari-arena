import type { UserControlDir, UserControls } from "@/types";

const CONTROL_KEYS: Partial<Record<string, UserControlDir>> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  " ": "fire",
};
const MOVEMENT = [
  ["up_left", "up", "up_right"],
  ["left", "none", "right"],
  ["down_left", "down", "down_right"],
] as const;
type Movement = (typeof MOVEMENT)[number][number];
const WITH_FIRE: Record<Movement, UserControlDir> = {
  none: "fire",
  up: "up_fire",
  down: "down_fire",
  left: "left_fire",
  right: "right_fire",
  up_left: "up_left_fire",
  up_right: "up_right_fire",
  down_left: "down_left_fire",
  down_right: "down_right_fire",
};

export function isControlKey(key: string): boolean {
  return Object.hasOwn(CONTROL_KEYS, key);
}

export function controlDirection(
  pressed: ReadonlySet<string>,
  layout: UserControls["layout"],
): UserControlDir {
  const actions = new Set(Array.from(pressed, (key) => CONTROL_KEYS[key]));
  const up = actions.has("up") && !actions.has("down");
  const down = actions.has("down") && !actions.has("up");
  const left = actions.has("left") && !actions.has("right");
  const right = actions.has("right") && !actions.has("left");
  const fire = actions.has("fire");
  if (layout !== "joystick") {
    // Preserve the existing Python/Pong/Breakout input priorities.
    if (fire) return up ? "up_fire" : down ? "down_fire" : "fire";
    return up ? "up" : down ? "down" : left ? "left" : right ? "right" : "none";
  }
  const movement = MOVEMENT[up ? 0 : down ? 2 : 1][left ? 0 : right ? 2 : 1];
  return fire ? WITH_FIRE[movement] : movement;
}
