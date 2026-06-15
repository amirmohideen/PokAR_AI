/**
 * GameManager – Central state & mode coordinator for the AR Poker Assistant.
 *
 * Holds the shared deck/pot state and the active GameMode, and enables exactly one
 * mode subtree (SinglePlayer / Multiplayer / RealWorld) at a time. Mode controllers
 * read `mode` and subscribe to onModeChanged.
 *
 * This keeps mode logic decoupled: each mode is its own object subtree with its own
 * controller; GameManager just owns the switch and the shared betting state.
 */

import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { Deck } from './CardData'
import { BetController } from './BetController'

export enum GameMode {
  None = 'none',
  SinglePlayer = 'single',
  Multiplayer = 'multi',
  RealWorld = 'realworld',
}

@component
export class GameManager extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">GameManager — mode switch & shared state</span>')
  @ui.separator

  @input
  @hint('Mode to start in. Can be changed at runtime via setMode().')
  @widget(
    new ComboBoxWidget()
      .addItem('None', 'none')
      .addItem('Single Player', 'single')
      .addItem('Multiplayer', 'multi')
      .addItem('Real World', 'realworld'),
  )
  startMode: string = 'none'

  @ui.separator
  @input
  @hint('Root object for Single-Player mode (enabled only in that mode).')
  singlePlayerRoot: SceneObject
  @input
  @hint('Root object for Multiplayer mode.')
  multiplayerRoot: SceneObject
  @input
  @hint('Root object for Real-World (Gemini) mode.')
  realWorldRoot: SceneObject

  @ui.separator
  @input
  @hint('Shared game content (virtual table: cards, chips, action buttons). Hidden until a mode is chosen.')
  gameContentRoot: SceneObject

  @input
  @hint('Shared BetController (pot / stack).')
  betController: BetController

  readonly onModeChanged: Event<GameMode> = new Event<GameMode>()

  private _mode: GameMode = GameMode.None
  private _deck: Deck = new Deck()

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.setMode(this.startMode as GameMode)
    })
  }

  get mode(): GameMode {
    return this._mode
  }
  get deck(): Deck {
    return this._deck
  }
  get bets(): BetController | null {
    return this.betController ?? null
  }

  /** Switch active mode, enabling only that mode's root subtree. */
  setMode(mode: GameMode): void {
    this._mode = mode
    if (this.singlePlayerRoot) this.singlePlayerRoot.enabled = mode === GameMode.SinglePlayer
    if (this.multiplayerRoot) this.multiplayerRoot.enabled = mode === GameMode.Multiplayer
    if (this.realWorldRoot) this.realWorldRoot.enabled = mode === GameMode.RealWorld
    // Shared virtual table (cards/chips/bet & action buttons) is only used by the
    // on-table modes. Real-World mode reads physical cards, so it stays hidden there.
    if (this.gameContentRoot) {
      this.gameContentRoot.enabled =
        mode === GameMode.SinglePlayer || mode === GameMode.Multiplayer
    }
    print('[GameManager] Mode → ' + mode)
    this.onModeChanged.invoke(mode)
  }

  /** Fresh shuffled deck for a new hand. */
  newShuffledDeck(): Deck {
    this._deck = new Deck()
    this._deck.shuffle()
    return this._deck
  }
}
