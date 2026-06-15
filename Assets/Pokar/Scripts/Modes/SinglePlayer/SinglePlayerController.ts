/**
 * SinglePlayerController – Heads-up Texas Hold'em vs a CPU (tutorial mode).
 *
 * Flow (one hand):
 *   1. Deal 2 hole cards to player (face-down on the table, grabbable to peek)
 *      and 2 to the CPU (face-down, hidden until showdown).
 *   2. Player acts (Fold / Call / Raise via ActionButtons). CPU responds.
 *   3. Streets advance: Flop (3) → Turn (1) → River (1), dealt from the deck.
 *   4. Showdown: best 5-card hand wins the pot (HandEvaluator). New hand begins.
 *
 * The CPU decides with the same mock Monte Carlo evaluator. Card visuals come
 * from the Card prefab; community cards are dealt face-up, hole cards face-down.
 *
 * NOTE: first-pass gameplay — verify/tune on device.
 */

import { Card, Deck } from '../../Core/CardData'
import { HandEvaluator } from '../../Core/HandEvaluator'
import { CardView } from '../../Core/CardView'
import { CardInteraction } from '../../Core/CardInteraction'
import { TableLayout } from '../../Core/TableLayout'
import { BetController } from '../../Core/BetController'
import { ActionButtons, PokerAction } from '../../Core/ActionButtons'
import { HandStrengthHUD } from './HandStrengthHUD'
import { HandStrengthMenu } from '../../Core/HandStrengthMenu'
import { GameManager, GameMode } from '../../Core/GameManager'
import { MainMenu } from '../../Core/MainMenu'
import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI'
import { OpenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'

enum Street { PreFlop, Flop, Turn, River, Showdown }

@component
export class SinglePlayerController extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">SinglePlayerController — Hold\'em vs CPU</span>')
  @ui.separator

  @input cardPrefab: ObjectPrefab
  @input
  @allowUndefined
  @hint('Blue quad placed just under each winning card (slightly larger) for a highlight border.')
  highlightPrefab: ObjectPrefab
  @input tableLayout: TableLayout
  @input betController: BetController
  @input actionButtons: ActionButtons

  @ui.separator
  @input hud: HandStrengthHUD
  @input
  @allowUndefined
  @hint('Palm hand-menu showing your live win % while you watch your hand.')
  handMenu: HandStrengthMenu
  @input
  @allowUndefined
  @hint('Optional deck-stack object shown during play (the draw pile).')
  deckStack: SceneObject

  @ui.separator
  @input @allowUndefined @hint('Text showing your money.') playerMoneyText: Text
  @input @allowUndefined @hint('Text showing the CPU\'s money.') cpuMoneyText: Text
  @input @allowUndefined @hint('Text showing the current pot.') potText: Text

  @ui.separator
  @input @allowUndefined @hint('GameManager — used to return to the menu on game over.') gameManager: GameManager
  @input @allowUndefined @hint('MainMenu — reopened on game over.') mainMenu: MainMenu

  @ui.separator
  @input @hint('Starting money for each player.') startingMoney: number = 500
  @input @hint('Forced ante posted by each player at the start of a hand.') ante: number = 10
  @input @hint('Default bet/call size when no chips are staked.') defaultBet: number = 20
  @input @hint('Seconds the CPU "thinks" before acting.') cpuThinkSeconds: number = 1.0
  @input @hint('Seconds to reveal CPU cards / show the result before the next hand.') revealSeconds: number = 3.0
  @input @hint('Seconds to hold the end-of-game screen before returning to the menu.') gameOverSeconds: number = 4.0
  @input @hint('Monte Carlo samples for CPU decisions / hand-strength queries.') samples: number = 200
  @input @hint('Auto-start a hand when this mode becomes active.') autoStart: boolean = true
  @input @allowUndefined @hint('AudioComponent played each time a card is dealt.') dealSound: AudioComponent
  @input @allowUndefined @hint('AudioComponent played when YOU win a hand.') winSound: AudioComponent
  @input @allowUndefined @hint('AudioComponent played when you LOSE a hand.') loseSound: AudioComponent
  @input @allowUndefined @hint('AudioComponent used to play short AI hand-analysis voice clips.')
  analysisVoiceAudio: AudioComponent
  @input @hint('Speak a short analysis when the player picks up their hole cards.')
  speakAnalysisOnPickup: boolean = true
  @input @hint('Seconds between spoken hand-analysis clips.')
  analysisVoiceCooldown: number = 8.0

  private playerMoney = 0
  private cpuMoney = 0
  private pot = 0
  private deck: Deck = new Deck()
  private playerHole: Card[] = []
  private cpuHole: Card[] = []
  private community: Card[] = []
  private street: Street = Street.PreFlop
  private spawned: SceneObject[] = []
  private playerHoleObjs: SceneObject[] = []
  private communityObjs: SceneObject[] = []
  private cpuHoleObjs: SceneObject[] = []
  private handActive = false

  private hasStarted = false
  private lastAnalysisVoiceAt = -999
  private analysisVoiceRequest = 0

  onAwake(): void {
    // First activation: OnStart fires once (after onAwake/onEnable) — deal here.
    this.createEvent('OnStartEvent').bind(() => {
      if (this.actionButtons) {
        this.actionButtons.onAction.add((e) => this.onPlayerAction(e.action))
      }
      this.playerMoney = this.startingMoney
      this.cpuMoney = this.startingMoney
      this.updateMoneyText()
      this.hasStarted = true
      if (this.autoStart) this.startHand()
    })
    // Re-entry (mode toggled off then on again): re-deal a fresh hand.
    this.createEvent('OnEnableEvent').bind(() => {
      if (this.autoStart && this.hasStarted) this.startHand()
    })
    // Leaving the mode hides the (globally-rooted) hand menu.
    this.createEvent('OnDisableEvent').bind(() => {
      if (this.handMenu) this.handMenu.setActive(false)
    })
  }

  /** Push the player's current cards to the palm hand menu. */
  private updateHandMenu(): void {
    if (this.handMenu) this.handMenu.setStrength(this.playerHole, this.community)
  }

  // ── Hand lifecycle ──────────────────────────────────────────────────────────

  startHand(): void {
    this.clearTable()
    if (this.betController) this.betController.clearPotChips() // clear last hand's pot pile
    if (this.hud) this.hud.hide()
    if (this.deckStack) this.deckStack.enabled = true

    this.deck = new Deck()
    this.deck.shuffle()
    this.playerHole = [this.deck.draw()!, this.deck.draw()!]
    this.cpuHole = [this.deck.draw()!, this.deck.draw()!]
    this.community = []
    this.street = Street.PreFlop
    this.handActive = true

    // Post antes into the pot (chips fly in from each player's bet spot).
    this.pot = 0
    this.takeFromPlayer(this.ante)
    this.takeFromCpu(this.ante)
    this.updateMoneyText()
    this.animateBet(this.playerBetPos(), this.ante)
    this.animateBet(this.cpuBetPos(), this.ante)

    // Player hole cards: face-down on the table, grabbable to peek (grab one → both fan up).
    const h0 = this.spawnCard(this.playerHole[0], this.tableLayout.getHandSlotPosition(0), false, 0, true)
    const h1 = this.spawnCard(this.playerHole[1], this.tableLayout.getHandSlotPosition(1), false, 0.18, true)
    this.linkHoleCards(h0, h1)
    this.playerHoleObjs = [h0, h1].filter(Boolean) as SceneObject[]
    // CPU hole cards: face-down across the table (not grabbable). Keep the objects
    // so we can flip THESE face-up at showdown (don't spawn duplicates).
    this.cpuHoleObjs = this.cpuHole.map((c, i) =>
      this.spawnCard(c, this.cpuPos(i), false, 0.36 + i * 0.18, false) as SceneObject)

    // Palm hand menu: show it for this mode and seed the pre-flop strength.
    if (this.handMenu) this.handMenu.setActive(true)
    this.updateHandMenu()

    print('[Holdem] New hand. You: ' + this.playerHole.map(c => c.code).join(',') +
      '  CPU: (hidden)')
    print('[Holdem] PreFlop — your move (Fold / Call / Raise).')
  }

  /** Player pressed an action button. */
  private onPlayerAction(action: PokerAction): void {
    if (!this.handActive) return

    if (action === PokerAction.Fold) {
      print('[Holdem] You folded. CPU wins the pot.')
      this.endHand(false)
      return
    }
    // Determine the player's wager from the staked chips (or a default), pay it.
    let amount = this.betController ? this.betController.currentBet : 0
    if (amount <= 0) amount = this.defaultBet
    if (this.betController) this.betController.commitBet() // clears the chip stack visual
    amount = this.takeFromPlayer(amount)
    this.updateMoneyText()
    print('[Holdem] You ' + action + ' ' + amount + '. CPU thinking…')
    this.delay(this.cpuThinkSeconds, () => this.cpuAct(action, amount))
  }

  /** CPU responds, then the street advances. */
  private cpuAct(playerAction: PokerAction, playerAmount: number): void {
    if (!this.handActive) return
    const strength = HandEvaluator.estimateWinProbability(this.cpuHole, this.community, this.samples)
    const wp = strength.winProbability

    // Fold weak hands facing a raise; otherwise match the wager.
    if (playerAction === PokerAction.Raise && wp < 0.30) {
      print('[Holdem] CPU folds (wp ' + Math.round(wp * 100) + '%). You win!')
      this.endHand(true)
      return
    }
    const cpuBet = this.takeFromCpu(Math.max(playerAmount, this.ante))
    this.updateMoneyText()
    this.animateBet(this.cpuBetPos(), cpuBet) // CPU's chips travel from its seat to the pot
    print('[Holdem] CPU calls ' + cpuBet + ' (wp ' + Math.round(wp * 100) + '%).')

    this.advanceStreet()
  }

  private advanceStreet(): void {
    switch (this.street) {
      case Street.PreFlop:
        this.street = Street.Flop
        this.dealCommunity(3)
        print('[Holdem] Flop dealt. Your move.')
        break
      case Street.Flop:
        this.street = Street.Turn
        this.dealCommunity(1)
        print('[Holdem] Turn dealt. Your move.')
        break
      case Street.Turn:
        this.street = Street.River
        this.dealCommunity(1)
        print('[Holdem] River dealt. Your move.')
        break
      case Street.River:
        this.street = Street.Showdown
        this.showdown()
        break
      default:
        break
    }
  }

  /** Deal `n` community cards face-up into the next field slots, dealt one-by-one. */
  private dealCommunity(n: number): void {
    for (let k = 0; k < n; k++) {
      const c = this.deck.draw()
      if (!c) break
      const idx = this.community.length
      this.community.push(c)
      const obj = this.spawnCard(c, this.tableLayout.getFieldSlotPosition(idx), true, k * 0.2, false)
      this.communityObjs[idx] = obj as SceneObject
    }
    // Board changed → refresh the palm hand-menu strength.
    this.updateHandMenu()
  }

  private showdown(): void {
    const mine = HandEvaluator.estimateWinProbability(this.playerHole, this.community, this.samples)
    const theirs = HandEvaluator.estimateWinProbability(this.cpuHole, this.community, this.samples)
    const iWin = mine.winProbability >= theirs.winProbability
    print('[Holdem] Showdown — You: ' + mine.categoryName + ' vs CPU: ' + theirs.categoryName +
      ' → ' + (iWin ? 'YOU WIN' : 'CPU WINS'))
    this.endHand(iWin)
  }

  /** Reveal the CPU's hole cards by flipping the EXISTING cards (no duplicates). */
  private revealCpu(): void {
    this.flipFaceUp(this.cpuHoleObjs)
  }

  /** Lift + enlarge the winner's best 5 cards (their hole cards + board cards used). */
  private highlightWinningHand(winnerHole: Card[], winnerHoleObjs: SceneObject[]): void {
    const best = HandEvaluator.bestFiveOf(winnerHole.concat(this.community))
    for (const card of best) {
      let obj: SceneObject | null = null
      const ci = this.community.findIndex(c => c.equals(card))
      if (ci >= 0) obj = this.communityObjs[ci]
      else {
        const hi = winnerHole.findIndex(c => c.equals(card))
        if (hi >= 0) obj = winnerHoleObjs[hi]
      }
      if (obj) this.highlightCard(obj)
    }
  }

  /**
   * Visual highlight: drop a blue quad just BELOW the card (no lifting/scaling the
   * card itself). The quad is a touch larger than the card, so from above it reads
   * as a blue border/glow around the winning card.
   */
  private highlightCard(obj: SceneObject): void {
    if (!this.highlightPrefab) return
    // Parent to the card so it inherits the flat orientation (and any card scaling),
    // and is cleaned up automatically when the card is destroyed next hand.
    const hl = this.highlightPrefab.instantiate(obj)
    hl.enabled = true
    const tr = hl.getTransform()
    // The card faces local +Z; -Z sits behind it (toward the table) so the card
    // stays on top and the larger quad shows around the edges.
    tr.setLocalPosition(new vec3(0, 0, -0.05))
    tr.setLocalRotation(quat.quatIdentity())
  }

  /** Flip the player's hole cards face-up on the table at the end of the hand. */
  private revealPlayer(): void {
    this.flipFaceUp(this.playerHoleObjs)
  }

  private flipFaceUp(objs: SceneObject[]): void {
    for (const obj of objs) {
      if (!obj) continue
      const view = obj.getComponent(CardView.getTypeName()) as CardView
      if (view) view.setFaceUp(true, true)
    }
  }

  private endHand(playerWon: boolean): void {
    this.handActive = false
    if (playerWon) { if (this.winSound) this.winSound.play(1) }
    else { if (this.loseSound) this.loseSound.play(1) }
    this.revealCpu() // show the CPU's cards for the reveal window
    this.revealPlayer() // and open the player's hole cards too

    // Highlight the winning 5 cards (winner's hole + the board cards used).
    if (this.community.length >= 3) {
      const winnerHole = playerWon ? this.playerHole : this.cpuHole
      const winnerObjs = playerWon ? this.playerHoleObjs : this.cpuHoleObjs
      this.highlightWinningHand(winnerHole, winnerObjs)
    }

    // Award the pot to the winner, then either continue or end the match.
    this.delay(this.revealSeconds, () => {
      if (playerWon) this.playerMoney += this.pot
      else this.cpuMoney += this.pot
      print('[Holdem] Pot ' + this.pot + ' → ' + (playerWon ? 'you' : 'CPU') +
        '.  You: ' + this.playerMoney + '  CPU: ' + this.cpuMoney)
      this.pot = 0
      this.updateMoneyText()

      if (this.playerMoney <= 0 || this.cpuMoney <= 0) {
        this.gameOver()
        return
      }
      if (this.getSceneObject().enabled) this.startHand()
    })
  }

  /** Match over: someone is broke → show the result, hold, then return to the menu. */
  private gameOver(): void {
    const youWon = this.cpuMoney <= 0
    print('[Holdem] GAME OVER — ' + (youWon ? 'You win the match! 🎉' : 'You are out of money.'))
    this.handActive = false
    // Show the end-of-game result on the pot text (the win/lose sound already played).
    if (this.potText) this.potText.text = youWon ? 'YOU WIN!' : 'GAME OVER'
    // Hold the end screen for a few seconds, then end the session → main menu.
    this.delay(this.gameOverSeconds, () => {
      this.clearTable()
      if (this.betController) this.betController.clearPotChips()
      if (this.potText) this.potText.text = 'Pot: $0'
      if (this.gameManager) this.gameManager.setMode(GameMode.None)
      if (this.mainMenu) this.mainMenu.open()
    })
  }

  // ── Money ─────────────────────────────────────────────────────────────────────

  /** Move up to `amount` from the player into the pot; returns the amount actually taken. */
  private takeFromPlayer(amount: number): number {
    const a = Math.max(0, Math.min(amount, this.playerMoney))
    this.playerMoney -= a
    this.pot += a
    return a
  }

  private takeFromCpu(amount: number): number {
    const a = Math.max(0, Math.min(amount, this.cpuMoney))
    this.cpuMoney -= a
    this.pot += a
    return a
  }

  private updateMoneyText(): void {
    if (this.playerMoneyText) this.playerMoneyText.text = 'You: $' + this.playerMoney
    if (this.cpuMoneyText) this.cpuMoneyText.text = 'CPU: $' + this.cpuMoney
    if (this.potText) this.potText.text = 'Pot: $' + this.pot
  }

  // ── Card spawning ─────────────────────────────────────────────────────────────

  /**
   * Flat-on-table orientation: the TABLE's world rotation tilted -90° about its
   * own X axis. Using the table's rotation (not world) keeps cards aligned with
   * the table no matter how the surface was placed — otherwise they look yawed.
   */
  private flatRot(): quat {
    const base = this.tableLayout
      ? this.tableLayout.getSceneObject().getTransform().getWorldRotation()
      : quat.quatIdentity()
    return base.multiply(quat.angleAxis(-Math.PI / 2, vec3.right()))
  }

  /** Where cards are dealt FROM (the draw pile). */
  private deckWorldPos(): vec3 {
    if (this.deckStack) return this.deckStack.getTransform().getWorldPosition()
    return this.tableLayout
      ? this.tableLayout.deckPosition
      : this.getSceneObject().getTransform().getWorldPosition()
  }

  /** Spawn a card flat on the table; it flies in from the deck after `delaySec`. */
  private spawnCard(card: Card, pos: vec3, faceUp: boolean, delaySec: number, grabbable: boolean): SceneObject | null {
    if (!this.cardPrefab) return null
    const obj = this.cardPrefab.instantiate(this.getSceneObject())
    obj.enabled = true
    this.spawned.push(obj)

    const tr = obj.getTransform()
    const rot = this.flatRot()
    const from = this.deckWorldPos()
    tr.setWorldPosition(from)
    tr.setWorldRotation(rot)

    const view = obj.getComponent(CardView.getTypeName()) as CardView
    if (view) {
      view.setCard(card)
      view.setFaceUp(faceUp, false)
    }
    const interaction = obj.getComponent(CardInteraction.getTypeName()) as CardInteraction
    if (interaction) {
      interaction.setHomeTransform(pos, rot)
      if (grabbable) {
        interaction.onPickup.add(() => this.onPlayerHolePickup())
      }
    }

    // Only the player's hole cards may be grabbed; disable interaction otherwise
    // (community + CPU cards stay put).
    if (!grabbable) {
      const collider: any = obj.getComponent('Physics.ColliderComponent')
      if (collider) collider.enabled = false
      if (interaction) interaction.enabled = false
    }

    // Deal animation: glide from the deck to the table slot.
    this.delay(delaySec, () => {
      if (this.dealSound) this.dealSound.play(1)
      animate({
        duration: 0.4,
        easing: 'ease-out-cubic',
        update: (t: number) => tr.setWorldPosition(vec3.lerp(from, pos, t)),
        ended: () => tr.setWorldPosition(pos),
      })
    })
    return obj
  }

  /** Make each hole card the other's partner so grabbing one fans both up. */
  private linkHoleCards(a: SceneObject | null, b: SceneObject | null): void {
    if (!a || !b) return
    const ca = a.getComponent(CardInteraction.getTypeName()) as CardInteraction
    const cb = b.getComponent(CardInteraction.getTypeName()) as CardInteraction
    if (ca && cb) {
      ca.setPartner(cb)
      cb.setPartner(ca)
    }
  }

  private clearTable(): void {
    for (const o of this.spawned) if (o) o.destroy()
    this.spawned = []
    this.playerHoleObjs = []
    this.communityObjs = []
    this.cpuHoleObjs = []
  }

  /** CPU hole-card position: from the TableLayout CPU slots (movable in the scene). */
  private cpuPos(index: number): vec3 {
    return this.tableLayout
      ? this.tableLayout.getCpuSlotPosition(index)
      : this.getSceneObject().getTransform().getWorldPosition().add(new vec3(-4 + index * 8, 0.2, -18))
  }

  // ── Bet chip animation ──────────────────────────────────────────────────────

  /** Toss chips worth `amount` from `from` into the pot (with sound), if any. */
  private animateBet(from: vec3, amount: number): void {
    if (!this.betController || amount <= 0) return
    this.betController.flyChipsToPot(from, this.betController.chipsForAmount(amount))
  }

  /** Where the player's bet chips spawn (the draggable bet chip's rest spot). */
  private playerBetPos(): vec3 {
    return this.tableLayout
      ? this.tableLayout.betPosition
      : this.getSceneObject().getTransform().getWorldPosition()
  }

  /** Where the CPU's bet chips spawn (its own seat near the table). */
  private cpuBetPos(): vec3 {
    return this.tableLayout
      ? this.tableLayout.cpuBetPosition
      : this.getSceneObject().getTransform().getWorldPosition()
  }

  // ── Hand-strength HUD (voice query) ─────────────────────────────────────────

  showPlayerStrength(): void {
    if (this.playerHole.length < 2) return
    const s = HandEvaluator.estimateWinProbability(this.playerHole, this.community, this.samples)
    print('[Holdem] Your win chance: ' + Math.round(s.winProbability * 100) + '% (' + s.categoryName + ')')
    if (this.hud) this.hud.show(s)
  }

  private onPlayerHolePickup(): void {
    if (!this.handActive || this.playerHole.length < 2) return
    const s = HandEvaluator.estimateWinProbability(this.playerHole, this.community, this.samples)
    const pct = Math.round(s.winProbability * 100)

    if (this.hud) this.hud.show(s)
    if (this.handMenu) this.handMenu.setStrengthValue(pct, s.categoryName)

    if (!this.speakAnalysisOnPickup || !this.analysisVoiceAudio) return
    const now = getTime()
    if (now - this.lastAnalysisVoiceAt < this.analysisVoiceCooldown) return
    this.lastAnalysisVoiceAt = now
    this.speakHandAnalysis(pct, s.categoryName)
  }

  private speakHandAnalysis(pct: number, category: string): void {
    const requestId = ++this.analysisVoiceRequest
    const text = this.buildVoiceAnalysis(pct, category)
    const request: OpenAITypes.Speech.Request = {
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
      speed: 1.08,
      instructions: 'Poker coach voice. Clear, calm, concise. Keep it under fifteen seconds.',
    }

    OpenAI.speech(request).then((audio: AudioTrackAsset) => {
      if (requestId !== this.analysisVoiceRequest || !this.analysisVoiceAudio) return
      if (this.analysisVoiceAudio.isPlaying()) {
        this.analysisVoiceAudio.fadeOutTime = 0.15
        this.analysisVoiceAudio.stop(true)
      }
      this.analysisVoiceAudio.audioTrack = audio
      this.analysisVoiceAudio.volume = 0.85
      this.analysisVoiceAudio.play(1)
    }).catch((e) => {
      print('[Holdem] Analysis voice failed: ' + e)
    })
  }

  private buildVoiceAnalysis(pct: number, category: string): string {
    const level = this.levelForPct(pct)
    const action = this.actionForPct(pct)
    const board = this.community.length > 0
      ? 'Board is ' + this.community.map(c => c.code).join(', ') + '. '
      : 'Pre-flop. '
    return 'You have ' + category + ', about ' + pct + ' percent to win. ' +
      level + ' spot. ' + board + 'Recommended action: ' + action + '.'
  }

  private levelForPct(pct: number): string {
    if (pct >= 75) return 'Premium'
    if (pct >= 60) return 'Good'
    if (pct >= 42) return 'Playable'
    if (pct >= 28) return 'Risky'
    return 'Weak'
  }

  private actionForPct(pct: number): string {
    if (pct >= 75) return 'raise for value'
    if (pct >= 60) return 'check or raise'
    if (pct >= 42) return 'call small bets'
    if (pct >= 28) return 'check and avoid big pots'
    return 'fold to pressure'
  }

  private delay(seconds: number, fn: () => void): void {
    const ev = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent
    ev.bind(() => fn())
    ev.reset(seconds)
  }
}
