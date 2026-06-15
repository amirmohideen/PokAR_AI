/**
 * HandStrengthBarometer – Left-hand-anchored hand-strength HUD for Real-World mode.
 *
 * Anchors a personal "barometer" to the user's LEFT hand (wrist), so it travels
 * with them as a stable, glanceable readout. It listens to GeminiCardVision for
 * recognised cards, runs the mock Monte Carlo evaluator, and displays the win %
 * plus a fill bar that scales with strength.
 *
 * The HUD hides itself when the left hand is not tracked.
 */

import { HandInputData } from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData'
import WorldCameraFinderProvider from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider'
import { GeminiCardVision, RecognizedCards } from './GeminiCardVision'
import { HandEvaluator } from '../../Core/HandEvaluator'

@component
export class HandStrengthBarometer extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">HandStrengthBarometer — left-hand HUD</span>')
  @ui.separator

  @input
  @hint('Card source. When it reports new cards, the barometer recomputes.')
  vision: GeminiCardVision

  @ui.separator
  @input
  @hint('Root object of the barometer HUD (positioned on the left wrist).')
  hudRoot: SceneObject

  @input
  @hint('Text for the win percentage.')
  percentText: Text

  @input
  @hint('Text for the best-hand category.')
  categoryText: Text

  @input
  @hint('Optional fill bar object; its local X scale is set to winProbability (0..1).')
  fillBar: SceneObject

  @ui.separator
  @input
  @hint('Offset from the wrist in cm (x=right, y=up, z=toward viewer).')
  wristOffset: vec3 = new vec3(0, 6, 4)

  @input
  @hint('Position smoothing factor (0..1 per frame; higher = snappier).')
  smoothing: number = 0.4

  @input
  @hint('Monte Carlo samples per evaluation.')
  samples: number = 300

  private handProvider = HandInputData.getInstance()
  private camera = WorldCameraFinderProvider.getInstance()
  private leftHand: any
  private smoothedPos: vec3 | null = null

  onAwake(): void {
    this.leftHand = this.handProvider.getHand('left')

    this.createEvent('OnStartEvent').bind(() => {
      if (this.vision) {
        this.vision.onCardsUpdated.add((cards: RecognizedCards) => this.recompute(cards))
      }
      // Seed from whatever the vision buffer already holds.
      if (this.vision) this.recompute(this.vision.current)
    })

    this.createEvent('UpdateEvent').bind(() => this.followWrist())
  }

  private recompute(cards: RecognizedCards): void {
    if (cards.hand.length < 2) return
    const strength = HandEvaluator.estimateWinProbability(cards.hand, cards.field, this.samples)
    const pct = Math.round(strength.winProbability * 100)
    if (this.percentText) this.percentText.text = pct + '%'
    if (this.categoryText) this.categoryText.text = strength.categoryName
    if (this.fillBar) {
      const s = this.fillBar.getTransform().getLocalScale()
      this.fillBar.getTransform().setLocalScale(
        new vec3(Math.max(0.001, strength.winProbability), s.y, s.z),
      )
    }
  }

  private followWrist(): void {
    if (!this.hudRoot) return
    const tracked = this.leftHand && this.leftHand.isTracked && this.leftHand.isTracked()
    if (!tracked) {
      if (this.hudRoot.enabled) this.hudRoot.enabled = false
      this.smoothedPos = null
      return
    }
    if (!this.hudRoot.enabled) this.hudRoot.enabled = true

    const wrist = this.leftHand.wrist
    if (!wrist || !wrist.position) return
    const target = wrist.position.add(this.wristOffset)

    // Exponential smoothing to damp hand-tracking jitter.
    this.smoothedPos = this.smoothedPos
      ? vec3.lerp(this.smoothedPos, target, this.smoothing)
      : target

    const tr = this.hudRoot.getTransform()
    tr.setWorldPosition(this.smoothedPos)

    // Face the camera.
    const camPos = this.camera.getTransform().getWorldPosition()
    const dir = camPos.sub(this.smoothedPos).normalize()
    tr.setWorldRotation(quat.lookAt(dir.uniformScale(-1), vec3.up()))
  }
}
