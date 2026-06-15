/**
 * HandStrengthMenu – Palm-attached "hand menu" that shows your poker hand strength
 * as a 0–100% number.
 *
 * It appears on the chosen palm (default LEFT) when you turn that palm toward you,
 * and follows the palm; it hides when the palm faces away or the hand isn't tracked.
 * The panel chrome is a SpectaclesUIKit Frame (assigned in the scene); the readout
 * itself is a native Text inside the Frame (UIKit has no text widget).
 *
 * Both game modes feed it the player's hole cards + the community cards and it runs
 * the same Monte-Carlo simulation (HandEvaluator: N random draws vs a random opponent)
 * to estimate the win %. Single-Player already knows the cards; Real-World gets them
 * from Gemini's detection. The menu doesn't care where the cards came from.
 */

import SIK from 'SpectaclesInteractionKit.lspkg/SIK'
import { Card } from './CardData'
import { HandEvaluator } from './HandEvaluator'

@component
export class HandStrengthMenu extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">HandStrengthMenu — palm menu showing win %</span>')
  @ui.separator

  @input
  @allowUndefined
  @hint('Panel root (the UIKit Frame object) moved to the palm and shown/hidden.')
  panelRoot: SceneObject

  @input
  @allowUndefined
  @hint('Large Text showing the win percentage, e.g. "73%".')
  percentText: Text

  @input
  @allowUndefined
  @hint('Small Text showing the hand label, e.g. "Pair of Kings".')
  labelText: Text

  @ui.separator
  @input
  @hint('Which hand the menu attaches to.')
  @widget(new ComboBoxWidget().addItem('Left', 'left').addItem('Right', 'right'))
  handType: string = 'left'

  @input
  @hint('Only show the menu while that palm faces you (like a classic hand menu).')
  requirePalmFacing: boolean = true

  @input
  @hint('Monte Carlo draws simulated per estimate.')
  samples: number = 100

  @input
  @allowUndefined
  @hint('Camera object — used to place the panel beside the hand and orient it.')
  camObject: SceneObject

  @input
  @hint('Offset beside the hand (cm) along camera-right. Negative puts it on the other side.')
  sideOffset: number = 14

  @input
  @hint('Offset above the hand (cm) along camera-up.')
  upOffset: number = 3

  @input
  @hint('Offset toward the camera (cm), lifting it off the palm.')
  forwardOffset: number = 4

  private hand: any = null
  private active = false // toggled by the active game mode
  private camTransform: Transform | null = null

  onAwake(): void {
    this.hand = SIK.HandInputData.getHand(this.handType as any)
    if (this.camObject) this.camTransform = this.camObject.getTransform()
    this.createEvent('OnStartEvent').bind(() => {
      this.setActive(false)
      this.clear()
    })
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  /** Enable/disable the whole menu for the current game mode. */
  setActive(active: boolean): void {
    this.active = active
    if (!active && this.panelRoot) this.panelRoot.enabled = false
  }

  /** Recompute and display the win % from the player's known cards. */
  setStrength(hole: Card[], field: Card[]): void {
    if (!hole || hole.length < 2) {
      this.clear()
      return
    }
    const s = HandEvaluator.estimateWinProbability(hole, field ?? [], this.samples)
    this.setStrengthValue(Math.round(s.winProbability * 100), s.categoryName)
  }

  /** Display an already-computed percentage + label (caller simulated it). */
  setStrengthValue(pct: number, label: string): void {
    pct = Math.max(0, Math.min(100, Math.round(pct)))
    if (this.percentText) {
      this.percentText.text = pct + '%'
      // Red (weak) → green (strong).
      const t = pct / 100
      this.percentText.textFill.color = new vec4(1 - t, t, 0.2, 1)
    }
    if (this.labelText) this.labelText.text = this.formatAnalysis(pct, label)
  }

  /** Show the "no read yet" placeholder. */
  clear(): void {
    if (this.percentText) {
      this.percentText.text = '--%'
      this.percentText.textFill.color = new vec4(0.8, 0.8, 0.8, 1)
    }
    if (this.labelText) this.labelText.text = ''
  }

  private formatAnalysis(pct: number, label: string): string {
    return 'Hands Level\n' + this.levelForPct(pct) +
      '\n\nwhat you have:\n' + (label || 'Unknown') +
      '\n\nrecommend actions:\n' + this.actionForPct(pct)
  }

  private levelForPct(pct: number): string {
    if (pct >= 75) return 'Premium Hand'
    if (pct >= 60) return 'Good Hand'
    if (pct >= 42) return 'Playable Hand'
    if (pct >= 28) return 'Risky Hand'
    return 'Weak Hand'
  }

  private actionForPct(pct: number): string {
    if (pct >= 75) return 'raise for value'
    if (pct >= 60) return 'check or raise'
    if (pct >= 42) return 'call small bets'
    if (pct >= 28) return 'check, avoid big pots'
    return 'fold to pressure'
  }

  private onUpdate(): void {
    if (!this.active || !this.panelRoot || !this.hand) return

    const tracked = this.hand.isTracked()
    const facing = this.requirePalmFacing ? this.hand.isFacingCamera() : true
    const show = tracked && facing
    this.panelRoot.enabled = show
    if (!show) return

    const palm: vec3 | null = this.hand.getPalmCenter()
    if (!palm) return

    let pos = palm
    if (this.camTransform) {
      const camPos = this.camTransform.getWorldPosition()
      const fwd = this.camTransform.forward
      const up = this.camTransform.up
      const right = up.cross(fwd).normalize() // camera-right
      const toCam = camPos.sub(palm).normalize()
      pos = palm
        .add(right.uniformScale(this.sideOffset))
        .add(up.uniformScale(this.upOffset))
        .add(toCam.uniformScale(this.forwardOffset))
    }
    // The Frame's billboard (xAlways/yAlways) keeps it facing the user; we only place it.
    this.panelRoot.getTransform().setWorldPosition(pos)
  }
}
