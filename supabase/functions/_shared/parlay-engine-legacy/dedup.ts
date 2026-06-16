// ============================================================================
// dedup.ts — Direct port of dedup.py
// ExposureTracker for player/game/combo exposure caps
// ============================================================================

import * as config from "./config.ts";
import { CandidateLeg, Parlay, comboHash, fingerprint } from "./models.ts";

function inc(map: Map<string, number>, key: string, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

function topN(map: Map<string, number>, n: number): Array<[string, number]> {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export class ExposureTracker {
  player_exposure = new Map<string, number>();
  game_exposure = new Map<string, number>();
  combo_hashes = new Map<string, number>();
  leg_fingerprints = new Map<string, number>();
  total_parlays = 0;
  duplicate_skips = 0;

  canAccept(parlay: Parlay): readonly [boolean, string] {
    const combo = comboHash(parlay);
    if ((this.combo_hashes.get(combo) ?? 0) >= config.MAX_SAME_COMBO_HASH_REPEATS) {
      return [false, `combo_already_shipped:${combo}`];
    }

    for (const leg of parlay.legs) {
      if (leg.player_name == null) continue;
      if ((this.player_exposure.get(leg.player_name) ?? 0) + 1 > config.MAX_SAME_PLAYER_EXPOSURE) {
        return [false, `player_exposure_cap:${leg.player_name}`];
      }
    }

    for (const leg of parlay.legs) {
      const gk = ExposureTracker.gameKey(leg);
      if ((this.game_exposure.get(gk) ?? 0) + 1 > config.MAX_SAME_GAME_EXPOSURE) {
        return [false, `game_exposure_cap:${gk}`];
      }
    }

    const projected_total = this.total_parlays + 1;
    const projected_unique = this.combo_hashes.size + (this.combo_hashes.has(combo) ? 0 : 1);
    const projected_dup_ratio = 1.0 - projected_unique / projected_total;
    if (projected_dup_ratio > config.MAX_DAILY_DUPLICATION_RATIO) {
      return [false, `daily_dup_ratio_${projected_dup_ratio.toFixed(2)}`];
    }

    return [true, "ok"];
  }

  accept(parlay: Parlay): void {
    this.total_parlays += 1;
    inc(this.combo_hashes, comboHash(parlay));
    for (const leg of parlay.legs) {
      if (leg.player_name != null) inc(this.player_exposure, leg.player_name);
      inc(this.game_exposure, ExposureTracker.gameKey(leg));
      inc(this.leg_fingerprints, fingerprint(leg));
    }
  }

  rejectDuplicate(): void {
    this.duplicate_skips += 1;
  }

  get duplicationRatio(): number {
    if (this.total_parlays === 0) return 0.0;
    return 1.0 - this.combo_hashes.size / this.total_parlays;
  }

  summary(): Record<string, unknown> {
    return {
      total_parlays: this.total_parlays,
      unique_combos: this.combo_hashes.size,
      duplication_ratio: this.duplicationRatio,
      duplicate_skips: this.duplicate_skips,
      top_player_exposure: topN(this.player_exposure, 3),
      top_game_exposure: topN(this.game_exposure, 3),
      top_leg_reuses: topN(this.leg_fingerprints, 5),
    };
  }

  static gameKey(leg: CandidateLeg): string {
    const a = leg.team, b = leg.opponent;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
}