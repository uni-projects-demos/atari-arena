import type { MatchMode, MatchModeKey, MatchSide } from "@/types";

const LEFT_SIDE_PRIORITY: readonly MatchSide[] = ["model", "user"];
const RIGHT_SIDE_PRIORITY: readonly MatchSide[] = ["game", "model", "user"];

const KNOWN_MODE_SIDES: Readonly<
  Partial<Record<MatchModeKey, { left: MatchSide; right: MatchSide }>>
> = {
  game: { left: "model", right: "game" },
  model: { left: "model", right: "model" },
  user: { left: "model", right: "user" },
  "model-user": { left: "model", right: "user" },
  "user-game": { left: "user", right: "game" },
  "user-model": { left: "user", right: "model" },
};

export function sideFromLabel(
  label: string,
  modeKey?: MatchModeKey,
  side?: "left" | "right",
): MatchSide {
  const normalized: string = label.trim().toLowerCase();

  if (normalized.includes("model")) return "model";
  if (normalized.includes("you") || normalized.includes("user") || normalized.includes("human")) {
    return "user";
  }
  if (normalized.includes("game")) return "game";

  if (modeKey === "user") return side === "left" ? "user" : "model";
  if (modeKey === "model") return "model";
  if (modeKey === "user-game") return side === "left" ? "user" : "game";
  return side === "left" ? "model" : "game";
}

export function modeSides(mode: Pick<MatchMode, "key" | "left_label" | "right_label">): {
  left: MatchSide;
  right: MatchSide;
} {
  const known: { left: MatchSide; right: MatchSide } | undefined = KNOWN_MODE_SIDES[mode.key];
  if (known) return known;

  return {
    left: sideFromLabel(mode.left_label, mode.key, "left"),
    right: sideFromLabel(mode.right_label, mode.key, "right"),
  };
}

export function sideLabelKey(side: MatchSide): string {
  return `mode.${side}`;
}

export function sortSides(
  sides: Iterable<MatchSide>,
  position: "left" | "right" = "left",
): MatchSide[] {
  const unique: Set<MatchSide> = new Set(sides);
  const priority: readonly MatchSide[] =
    position === "left" ? LEFT_SIDE_PRIORITY : RIGHT_SIDE_PRIORITY;
  return priority.filter((side: MatchSide): boolean => unique.has(side));
}
