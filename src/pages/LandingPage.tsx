import type { GameInfo, MatchModeKey, ModeCatalog } from "@/types";
import GameLib from "../components/GameLib";
import ModeLib from "../components/ModeLib";

interface LandingPageProps {
  games: GameInfo[];
  modes: ModeCatalog[];
  selectedMode: MatchModeKey;
  onMode: (mode: MatchModeKey) => void;
  onPlay: (gameKey: string, modeKey: MatchModeKey) => void;
}

export default function LandingPage({
  games,
  modes,
  selectedMode,
  onMode,
  onPlay,
}: LandingPageProps) {
  return (
    <>
      <ModeLib modes={modes} selected={selectedMode} onSelect={onMode} />
      <GameLib games={games} modeKey={selectedMode} onPlay={onPlay} />
    </>
  );
}
