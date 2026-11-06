import type { Emulator } from "../../browser/src/environment";

export function applyOpening(emu: Pick<Emulator, "getRAM" | "setRAM">): boolean {
  const vel = emu.getRAM()[58];
  if (vel === 0) return true;
  if (vel < 128) emu.setRAM(58, -vel & 255);
  return false;
}
