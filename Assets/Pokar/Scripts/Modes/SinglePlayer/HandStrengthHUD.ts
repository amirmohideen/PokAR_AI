/**
 * HandStrengthHUD – Floating world-space HUD showing win % and best-hand category.
 *
 * A reusable display: call show(strength) to reveal and populate it, hide() to
 * dismiss. Billboards toward the camera each frame so it's always readable.
 * Used by both the Single-Player tutorial and (optionally) other modes.
 */

import { HandStrength } from '../../Core/HandEvaluator'
import WorldCameraFinderProvider from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'

@component
export class HandStrengthHUD extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">HandStrengthHUD — floating win% display</span>')
  @ui.separator

  @input
  @hint('Root object scaled in/out when shown/hidden.')
  panelRoot: SceneObject

  @input
  @hint('Large Text for the win percentage, e.g. "72%".')
  percentText: Text

  @input
  @hint('Text for the best-hand category, e.g. "Two Pair".')
  categoryText: Text

  @input
  @hint('Billboard the HUD toward the camera each frame.')
  faceCamera: boolean = true

  private camera = WorldCameraFinderProvider.getInstance()
  private visible = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.panelRoot) this.panelRoot.getTransform().setLocalScale(vec3.zero())
    })
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  /** Populate and reveal the HUD. */
  show(strength: HandStrength): void {
    const pct = Math.round(strength.winProbability * 100)
    if (this.percentText) {
      this.percentText.text = pct + '%'
    }
    if (this.categoryText) {
      this.categoryText.text =
        'Hands Level: ' + this.levelForPct(pct) +
        '\nWhat you have: ' + strength.categoryName +
        '\nRecommend: ' + this.actionForPct(pct)
    }
    this.setVisible(true)
  }

  hide(): void {
    this.setVisible(false)
  }

  private setVisible(v: boolean): void {
    if (this.visible === v) return
    this.visible = v
    if (!this.panelRoot) return
    const tr = this.panelRoot.getTransform()
    const from = tr.getLocalScale()
    const to = v ? vec3.one() : vec3.zero()
    animate({
      duration: 0.3,
      easing: 'ease-out-back',
      update: (t: number) => tr.setLocalScale(vec3.lerp(from, to, t)),
      ended: () => tr.setLocalScale(to),
    })
  }

  private onUpdate(): void {
    if (!this.visible || !this.faceCamera || !this.panelRoot) return
    const camPos = this.camera.getTransform().getWorldPosition()
    const myPos = this.panelRoot.getTransform().getWorldPosition()
    const dir = camPos.sub(myPos).normalize()
    this.panelRoot.getTransform().setWorldRotation(quat.lookAt(dir.uniformScale(-1), vec3.up()))
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
    if (pct >= 28) return 'check, avoid big pots'
    return 'fold to pressure'
  }
}
