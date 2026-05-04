// spike-narrator.ts
// Pure templated narrator that turns a cascade's verdict mix + alignment counts
// into 2-3 sentences of plain-English, slightly-personality copy.
// No LLM calls — deterministic, fast, cheap.

export type SpikeActionKind = 'TAIL' | 'TAIL_SMALL' | 'REVIEW' | 'FADE' | 'SKIP';

export interface SpikeNarrateInput {
  actionKind: SpikeActionKind;
  side: string;                  // "Over" | "Under" | "Yes" | "No"
  prop: string;                  // "Points Rebounds"
  totalLegs: number;
  strong: number;
  lean: number;
  neutral: number;
  weak: number;
  modelAgree: number;
  modelDisagree: number;
  defenseAgainst: number;
}

function pluralLegs(n: number): string {
  return n === 1 ? '1 pick' : `${n} picks`;
}

export function spikeNarrate(i: SpikeNarrateInput): string {
  const sideLower = (i.side || 'this side').toLowerCase();
  const total = i.totalLegs || (i.strong + i.lean + i.neutral + i.weak);

  switch (i.actionKind) {
    case 'TAIL': {
      const lead = i.strong >= 3
        ? `${i.strong} of ${total} picks line up clean on the ${sideLower}`
        : `${i.strong} rock-solid pick${i.strong === 1 ? '' : 's'} plus ${i.lean} leaning the same way`;
      const model = i.modelAgree >= Math.ceil(total / 2)
        ? ` and our L10 model agrees with ${i.modelAgree}/${total} of them`
        : '';
      const advice = total >= 5
        ? ` Don't chase the full ${total}-leg lottery — take the top 3 strongest legs as a smaller parlay.`
        : ` This is a real signal, not a coin flip.`;
      return `${lead}${model}.${advice}`;
    }
    case 'TAIL_SMALL': {
      return `${i.strong} STRONG and ${i.lean} LEAN out of ${total} — the signal is real but thin. Keep the stake small or play just the top 2-3 legs. Skip the full parlay.`;
    }
    case 'FADE': {
      const fadeSide = /over|yes/i.test(i.side) ? 'Under' : 'Over';
      return `Book is pushing the ${sideLower}, but our model disagrees on ${i.modelDisagree}/${total} legs and ${i.defenseAgainst}/${total} face tough defense. This is a fade spot — bet the ${fadeSide} side instead.`;
    }
    case 'SKIP': {
      return `${pluralLegs(i.weak)} weak, no STRONG legs, no model edge either way. Don't tail, don't fade — just skip and wait for a sharper spot.`;
    }
    case 'REVIEW':
    default: {
      if (i.strong + i.lean === 0) {
        return `Mixed bag — no leg is convincing on its own. If you're going to play, keep it tiny or wait for a sharper signal.`;
      }
      return `Some legs look good (${i.strong} STRONG, ${i.lean} LEAN) but ${i.weak + i.neutral} are noisy. Inspect the strong legs only — half stake max.`;
    }
  }
}