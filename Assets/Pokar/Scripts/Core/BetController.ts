/**
 * BetController – Stack-the-chips betting + pot tracking.
 *
 * Grab the bet chip and pull UP (Y only): for every `dragStepCm` of vertical
 * pull, a chip clone is added to a growing stack, each worth `creditsPerChip`
 * (default 10). The bet = number of stacked chips × creditsPerChip. On release
 * the dragged handle chip snaps back to its rest spot and the stack + bet amount
 * remain. Horizontal motion is ignored (locked to the Y axis).
 *
 * Other systems read currentBet / pot and call commitBet() (e.g. "Raise").
 */

import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'

@component
export class BetController extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">BetController — stack chips to bet</span>')
  @ui.separator

  @input
  @hint('Draggable bet chip (handle) with an InteractableManipulation component.')
  betChip: SceneObject

  @input
  @hint('Chip visual prefab cloned to build the stack (no interaction needed).')
  chipPrefab: ObjectPrefab

  @input
  @hint('Uniform local scale applied to each instantiated stack chip (overrides the prefab\'s baked scale).')
  chipScale: number = 2

  @ui.separator
  @input
  @hint('Credits each stacked chip is worth.')
  creditsPerChip: number = 10

  @input
  @hint('Centimetres of upward pull needed to add one chip.')
  dragStepCm: number = 2

  @input
  @hint('Vertical spacing between stacked chips (cm).')
  chipSpacing: number = 0.6

  @input
  @hint('Maximum chips that can be stacked in one bet.')
  maxChips: number = 30

  @ui.separator
  @input
  @hint('Target the staged chips fly to on Raise/Call (place an empty SceneObject near the pot prefab).')
  potAnchor: SceneObject
  @input
  @hint('Seconds for a chip to fly to the pot.')
  flyDuration: number = 0.45
  @input
  @hint('Arc height of the chip toss (cm). 0 = straight line.')
  flyArc: number = 3
  @input
  @allowUndefined
  @hint('Poker-chip clink sound played when chips fly to the pot (antes, raises, CPU bets).')
  chipSound: AudioComponent
  @input
  @allowUndefined
  @hint('Chip-clink audio track. Assigned to the Chip Sound component at runtime if it has none.')
  chipSoundTrack: AudioTrackAsset

  @ui.separator
  @input betText: Text
  @input potText: Text
  @input
  @hint('Player\'s starting chip stack.')
  startingStack: number = 1000

  readonly onBetChanged: Event<number> = new Event<number>()
  readonly onPotChanged: Event<number> = new Event<number>()

  private manipulation: InteractableManipulation | null = null
  private restPos: vec3 = vec3.zero()
  private grabStartY: number = 0
  private stackPool: SceneObject[] = []
  /** Chips that have flown to and are resting at the pot (cleared each hand). */
  private potPile: SceneObject[] = []

  private _currentBet: number = 0
  private _pot: number = 0
  private _stack: number = 0
  private _chipCount: number = 0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this._stack = this.startingStack
    this.refreshText()

    // Assign the chip-clink track to its AudioComponent if one wasn't wired in the editor.
    if (this.chipSound && this.chipSoundTrack && !this.chipSound.audioTrack) {
      this.chipSound.audioTrack = this.chipSoundTrack
    }

    if (!this.betChip) {
      print('[BetController] No bet chip assigned — drag-to-bet disabled.')
      return
    }
    this.restPos = this.betChip.getTransform().getWorldPosition()

    // Build a pool of stack chips (disabled until the bet grows).
    if (this.chipPrefab) {
      const parent = this.betChip.getParent() ?? this.getSceneObject()
      for (let i = 0; i < this.maxChips; i++) {
        const clone = this.chipPrefab.instantiate(parent)
        clone.getTransform().setLocalScale(vec3.one().uniformScale(this.chipScale))
        clone.enabled = false
        this.stackPool.push(clone)
      }
    }

    this.manipulation = this.betChip.getComponent(
      InteractableManipulation.getTypeName(),
    ) as InteractableManipulation
    if (!this.manipulation) {
      print('[BetController] Bet chip has no InteractableManipulation — drag-to-bet disabled.')
      return
    }

    this.manipulation.onManipulationStart.add(() => {
      this.grabStartY = this.betChip.getTransform().getWorldPosition().y
    })
    this.manipulation.onManipulationUpdate.add(() => this.onDrag())
    this.manipulation.onManipulationEnd.add(() => this.snapChipBack())
  }

  /** Y-locked drag: ignore X/Z, convert upward pull into a stack of chips. */
  private onDrag(): void {
    const tr = this.betChip.getTransform()
    const p = tr.getWorldPosition()
    // Lock horizontal axes to the rest position — only Y is meaningful.
    tr.setWorldPosition(new vec3(this.restPos.x, p.y, this.restPos.z))

    const dyCm = Math.max(0, p.y - this.grabStartY)
    const chips = Math.max(0, Math.min(this.maxChips, Math.floor(dyCm / this.dragStepCm)))
    if (chips !== this._chipCount) this.updateStack(chips)
  }

  /** Show `n` stacked chips and set the bet accordingly. */
  private updateStack(n: number): void {
    this._chipCount = n
    for (let i = 0; i < this.stackPool.length; i++) {
      const chip = this.stackPool[i]
      if (i < n) {
        chip.enabled = true
        chip.getTransform().setWorldPosition(
          this.restPos.add(new vec3(0, (i + 1) * this.chipSpacing, 0)),
        )
      } else {
        chip.enabled = false
      }
    }
    this.setBet(n * this.creditsPerChip)
  }

  get currentBet(): number {
    return this._currentBet
  }
  get pot(): number {
    return this._pot
  }
  get stack(): number {
    return this._stack
  }

  /** Set the pending bet (clamped to [0, stack]). */
  setBet(amount: number): void {
    const clamped = Math.max(0, Math.min(this._stack, amount))
    if (clamped === this._currentBet) return
    this._currentBet = clamped
    this.refreshText()
    this.onBetChanged.invoke(this._currentBet)
  }

  /** Move the current bet into the pot, deduct from stack, fly the chips to the pot. */
  commitBet(): number {
    const amount = Math.min(this._currentBet, this._stack)
    this._stack -= amount
    this.addToPot(amount)
    // Use the staged chip count if the player dragged a stack, else derive it from
    // the amount (e.g. a default Call with no drag).
    const chips = this._chipCount > 0 ? this._chipCount : this.chipsForAmount(amount)
    this.recycleStack() // hide the dragged "pending" stack…
    this.flyChipsToPot(this.restPos, chips) // …and toss fresh chips that stay in the pot
    this._currentBet = 0
    this.refreshText()
    this.onBetChanged.invoke(0)
    return amount
  }

  /** Convert a credit amount into a chip count (at least one chip when positive). */
  chipsForAmount(amount: number): number {
    if (amount <= 0) return 0
    return Math.max(1, Math.round(amount / this.creditsPerChip))
  }

  /**
   * Spawn `count` chips at `from`, then toss them one-by-one to the pot where they
   * stay stacked until clearPotChips()/resetPot(). A chip-clink sound plays once
   * per toss. This is the single entry point for every "chips travel to the pot"
   * animation — the player's committed bet, forced antes/blinds, and CPU bets.
   */
  flyChipsToPot(from: vec3, count: number): void {
    if (!this.chipPrefab || count <= 0) return
    const n = Math.min(count, this.maxChips)
    this.playChipSound()
    const parent = this.getSceneObject()
    const base = this.potWorldPos()
    for (let i = 0; i < n; i++) {
      const chip = this.chipPrefab.instantiate(parent)
      chip.getTransform().setLocalScale(vec3.one().uniformScale(this.chipScale))
      chip.enabled = true
      const tr = chip.getTransform()
      // Start as a small stack at the source so a multi-chip bet reads clearly.
      const fromPos = from.add(new vec3(0, (i + 1) * this.chipSpacing, 0))
      tr.setWorldPosition(fromPos)
      const to = base.add(this.potChipOffset(this.potPile.length + i))
      animate({
        duration: this.flyDuration,
        delayFrames: i * 2, // stagger so chips peel off one after another
        easing: 'ease-in-out-cubic',
        update: (t: number) => {
          const p = vec3.lerp(fromPos, to, t)
          const arc = Math.sin(t * Math.PI) * this.flyArc // parabolic toss
          tr.setWorldPosition(new vec3(p.x, p.y + arc, p.z))
        },
        ended: () => {
          tr.setWorldPosition(to)
          this.potPile.push(chip) // leave it resting in the pot
        },
      })
    }
  }

  private playChipSound(): void {
    if (this.chipSound) this.chipSound.play(1)
  }

  private potWorldPos(): vec3 {
    return this.potAnchor ? this.potAnchor.getTransform().getWorldPosition() : this.restPos
  }

  /** Resting offset for the index-th chip in the pot (wraps into side-by-side columns). */
  private potChipOffset(index: number): vec3 {
    const perColumn = 12
    const col = Math.floor(index / perColumn)
    const row = index % perColumn
    return new vec3(col * 0.8, row * this.chipSpacing * 0.35, 0)
  }

  /** Hide the staged (dragged) chip stack, returning its clones to the pool. */
  private recycleStack(): void {
    this._chipCount = 0
    for (const chip of this.stackPool) {
      chip.enabled = false
      chip.getTransform().setWorldPosition(this.restPos)
    }
  }

  /** Destroy the chips resting at the pot (visual only — pot totals are untouched). */
  clearPotChips(): void {
    for (const chip of this.potPile) if (chip) chip.destroy()
    this.potPile = []
  }

  /** Instantly hide the staged chip stack (e.g. on Fold) without sending them to the pot. */
  clearStack(): void {
    this._chipCount = 0
    for (const chip of this.stackPool) chip.enabled = false
  }

  addToPot(amount: number): void {
    this._pot += amount
    this.refreshText()
    this.onPotChanged.invoke(this._pot)
  }

  setPot(total: number): void {
    this._pot = total
    this.refreshText()
    this.onPotChanged.invoke(this._pot)
  }

  resetPot(): void {
    this.clearPotChips()
    this.setPot(0)
  }

  /** Return the handle chip to its rest spot; the stack + bet amount remain. */
  private snapChipBack(): void {
    if (!this.betChip) return
    const tr = this.betChip.getTransform()
    const from = tr.getWorldPosition()
    animate({
      duration: 0.2,
      easing: 'ease-out-quad',
      update: (t: number) => tr.setWorldPosition(vec3.lerp(from, this.restPos, t)),
      ended: () => tr.setWorldPosition(this.restPos),
    })
  }

  private refreshText(): void {
    if (this.betText) this.betText.text = 'Bet: ' + this._currentBet
    if (this.potText) this.potText.text = 'Pot: ' + this._pot
  }
}
