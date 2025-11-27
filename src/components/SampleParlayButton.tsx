import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";
import { Shuffle } from "lucide-react";

const sampleParlays = [
  {
    name: "The Classic Degen",
    legs: [
      { desc: "Lakers ML", odds: -110 },
      { desc: "Chiefs -3.5", odds: -115 },
      { desc: "Ohtani HR", odds: +350 },
      { desc: "Celtics/Knicks Over 215", odds: -105 },
    ],
    stake: 25
  },
  {
    name: "The Moon Shot",
    legs: [
      { desc: "Packers ML", odds: +240 },
      { desc: "Liverpool to win 3-0", odds: +650 },
      { desc: "McGregor KO Round 1", odds: +450 },
      { desc: "Curry 40+ points", odds: +380 },
      { desc: "Djokovic in straight sets", odds: +175 },
    ],
    stake: 10
  },
  {
    name: "The Sweat Session",
    legs: [
      { desc: "49ers -7", odds: -110 },
      { desc: "Yankees ML", odds: -145 },
      { desc: "Suns +4.5", odds: -105 },
    ],
    stake: 50
  }
];

export function SampleParlayButton() {
  const navigate = useNavigate();

  const runSample = () => {
    const sample = sampleParlays[Math.floor(Math.random() * sampleParlays.length)];
    const legs = sample.legs.map(l => createLeg(l.desc, l.odds));
    const simulation = simulateParlay(legs, sample.stake);
    navigate('/results', { state: { simulation } });
  };

  return (
    <Button variant="muted" size="sm" onClick={runSample}>
      <Shuffle className="w-4 h-4" />
      Try Sample
    </Button>
  );
}
