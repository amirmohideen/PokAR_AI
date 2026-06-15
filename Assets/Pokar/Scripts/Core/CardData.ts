/**
 * CardData – Pure poker card model & deck logic. No Lens Studio dependencies.
 *
 * A card is identified by a 2-char code: rank char + suit char, e.g. "Qs", "Th", "Ad".
 *   Ranks: 2 3 4 5 6 7 8 9 T J Q K A
 *   Suits: s(♠) h(♥) d(♦) c(♣)
 * This matches the JSON Gemini returns in the real-world mode ({"hand_cards":["Ah","Kd"]}).
 */

export enum Suit {
  Spades = 's',
  Hearts = 'h',
  Diamonds = 'd',
  Clubs = 'c',
}

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUITS: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs]

/** Unicode glyphs for rendering suits on the card face. */
export const SUIT_GLYPH: { [k: string]: string } = {
  s: '♠', // ♠
  h: '♥', // ♥
  d: '♦', // ♦
  c: '♣', // ♣
}

/** Suits rendered in red. */
export function isRedSuit(suit: string): boolean {
  return suit === Suit.Hearts || suit === Suit.Diamonds
}

export class Card {
  constructor(
    readonly rank: string, // '2'..'9','T','J','Q','K','A'
    readonly suit: string, // 's','h','d','c'
  ) {}

  /** Compact code, e.g. "Qs". */
  get code(): string {
    return this.rank + this.suit
  }

  /** 0..12 ordinal used by the evaluator (2 = 0 … A = 12). */
  get rankValue(): number {
    return RANKS.indexOf(this.rank as any)
  }

  get suitGlyph(): string {
    return SUIT_GLYPH[this.suit] ?? '?'
  }

  get isRed(): boolean {
    return isRedSuit(this.suit)
  }

  toString(): string {
    return this.code
  }

  /** Parse a code like "Ah" / "10s" / "Td" into a Card, or null if invalid. */
  static parse(code: string): Card | null {
    if (!code || code.length < 2) return null
    let raw = code.trim()
    // Accept "10x" as well as "Tx"
    if (raw.length === 3 && raw.slice(0, 2) === '10') raw = 'T' + raw[2]
    const rank = raw[0].toUpperCase()
    const suit = raw[1].toLowerCase()
    if (RANKS.indexOf(rank as any) === -1) return null
    if (SUITS.indexOf(suit as Suit) === -1) return null
    return new Card(rank, suit)
  }

  equals(other: Card | null): boolean {
    return !!other && other.rank === this.rank && other.suit === this.suit
  }
}

/** A standard 52-card deck with seeded-free shuffle (uses a passed RNG for determinism in tests). */
export class Deck {
  private cards: Card[] = []

  constructor() {
    this.reset()
  }

  reset(): void {
    this.cards = []
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(new Card(rank, suit))
      }
    }
  }

  get remaining(): number {
    return this.cards.length
  }

  /** Fisher–Yates shuffle. rng defaults to Math.random. */
  shuffle(rng: () => number = Math.random): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = this.cards[i]
      this.cards[i] = this.cards[j]
      this.cards[j] = tmp
    }
  }

  /** Draw the top card, or null if empty. */
  draw(): Card | null {
    return this.cards.pop() ?? null
  }

  /** Remove specific cards from the deck (e.g. cards already known on the table). */
  remove(toRemove: Card[]): void {
    this.cards = this.cards.filter(c => !toRemove.some(r => r.equals(c)))
  }
}
