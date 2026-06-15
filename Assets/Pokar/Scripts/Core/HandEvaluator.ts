/**
 * HandEvaluator – Mock Monte Carlo poker hand-strength estimator. No Lens Studio deps.
 *
 * Given the player's hole cards and the known community (field) cards, it estimates
 * the win probability by simulating N random completions of the board and random
 * opponent hands, then scoring with a simplified 5-card evaluator.
 *
 * NOTE: This is intentionally a *mock* with a clean interface. The 5-card category
 * ranking is real (high-card → straight-flush), but the simulation is simplified
 * (single opponent, uniform random) so it runs cheaply on-device. Swap in a full
 * equity solver later by replacing `estimateWinProbability` — the signature stays.
 */

import { Card, Deck, RANKS } from './CardData'

export interface HandStrength {
  /** 0..1 estimated probability the player wins or ties favourably. */
  winProbability: number
  /** Human-readable best-hand category for the player's current 5–7 cards. */
  categoryName: string
  /** Number of Monte Carlo simulations run. */
  samples: number
}

// 5-card hand categories, higher = stronger.
enum Category {
  HighCard = 0,
  Pair,
  TwoPair,
  ThreeKind,
  Straight,
  Flush,
  FullHouse,
  FourKind,
  StraightFlush,
}

const CATEGORY_NAMES: string[] = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
]

export class HandEvaluator {
  /**
   * Estimate win probability via Monte Carlo simulation.
   * @param hole   the player's 2 hole cards
   * @param field  0–5 community cards already known
   * @param samples number of random simulations (default 300; higher = smoother, slower)
   */
  static estimateWinProbability(hole: Card[], field: Card[], samples = 300): HandStrength {
    if (hole.length < 2) {
      return { winProbability: 0, categoryName: '—', samples: 0 }
    }

    const known = hole.concat(field)
    let wins = 0
    let ties = 0

    for (let s = 0; s < samples; s++) {
      const deck = new Deck()
      deck.remove(known)
      deck.shuffle()

      // Deal opponent 2 cards
      const opp = [deck.draw()!, deck.draw()!]

      // Complete the board to 5 cards
      const board = field.slice()
      while (board.length < 5) board.push(deck.draw()!)

      const myScore = HandEvaluator.bestScore(hole.concat(board))
      const oppScore = HandEvaluator.bestScore(opp.concat(board))

      if (myScore > oppScore) wins++
      else if (myScore === oppScore) ties++
    }

    // Count ties as half a win.
    const winProbability = (wins + ties * 0.5) / samples
    const myBest = HandEvaluator.categorize(known.length >= 5 ? known : hole.concat(field))

    return {
      winProbability,
      categoryName: CATEGORY_NAMES[myBest] ?? 'High Card',
      samples,
    }
  }

  /**
   * Returns the 5 cards forming the best hand out of the given 5–7 cards
   * (e.g. the cards that actually win at showdown, for highlighting).
   */
  static bestFiveOf(cards: Card[]): Card[] {
    if (cards.length <= 5) return cards.slice()
    let best: Card[] = []
    let bestScore = -1
    for (const combo of HandEvaluator.combinations(cards, 5)) {
      const s = HandEvaluator.bestScore(combo)
      if (s > bestScore) {
        bestScore = s
        best = combo
      }
    }
    return best
  }

  /** All k-card combinations of the given cards. */
  private static combinations(cards: Card[], k: number): Card[][] {
    const result: Card[][] = []
    const combo: Card[] = []
    const recurse = (start: number) => {
      if (combo.length === k) {
        result.push(combo.slice())
        return
      }
      for (let i = start; i < cards.length; i++) {
        combo.push(cards[i])
        recurse(i + 1)
        combo.pop()
      }
    }
    recurse(0)
    return result
  }

  /**
   * Score the best 5-card hand out of 5–7 cards as a single comparable number:
   * category * 1e10 + tiebreaker on rank counts. Higher is better.
   */
  private static bestScore(cards: Card[]): number {
    const cat = HandEvaluator.categorize(cards)
    // Tiebreaker: rank multiplicities sorted desc, then high ranks.
    const counts = HandEvaluator.rankCounts(cards)
    const tiebreak = counts
      .map(c => c.count * 100 + c.rankValue)
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((acc, v) => acc * 1000 + v, 0)
    return cat * 1e12 + tiebreak
  }

  private static categorize(cards: Card[]): Category {
    const counts = HandEvaluator.rankCounts(cards)
    const multiplicities = counts.map(c => c.count).sort((a, b) => b - a)
    const isFlush = HandEvaluator.hasFlush(cards)
    const isStraight = HandEvaluator.hasStraight(cards)

    if (isStraight && isFlush) return Category.StraightFlush
    if (multiplicities[0] === 4) return Category.FourKind
    if (multiplicities[0] === 3 && multiplicities[1] >= 2) return Category.FullHouse
    if (isFlush) return Category.Flush
    if (isStraight) return Category.Straight
    if (multiplicities[0] === 3) return Category.ThreeKind
    if (multiplicities[0] === 2 && multiplicities[1] === 2) return Category.TwoPair
    if (multiplicities[0] === 2) return Category.Pair
    return Category.HighCard
  }

  private static rankCounts(cards: Card[]): { rankValue: number; count: number }[] {
    const map: { [k: number]: number } = {}
    for (const c of cards) map[c.rankValue] = (map[c.rankValue] ?? 0) + 1
    return Object.keys(map).map(k => ({ rankValue: +k, count: map[+k] }))
  }

  private static hasFlush(cards: Card[]): boolean {
    const bySuit: { [k: string]: number } = {}
    for (const c of cards) {
      bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1
      if (bySuit[c.suit] >= 5) return true
    }
    return false
  }

  private static hasStraight(cards: Card[]): boolean {
    const present = new Array(RANKS.length).fill(false)
    for (const c of cards) present[c.rankValue] = true
    // Ace can be low (A-2-3-4-5): treat index 12 as also -1.
    let run = present[12] ? 1 : 0 // ace-low seed
    for (let i = 0; i < RANKS.length; i++) {
      run = present[i] ? run + 1 : 0
      if (run >= 5) return true
    }
    return false
  }
}
