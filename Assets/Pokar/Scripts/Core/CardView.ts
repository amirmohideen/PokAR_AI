/**
 * CardView – Visual representation of a single poker card with flip state.
 *
 * The card object is expected to have:
 *   - a `frontRoot` SceneObject (white face) with up to 4 corner Text components
 *   - a `backRoot` SceneObject (shared generic back texture)
 * Flipping enables one root and disables the other and animates a 180° Y rotation.
 *
 * The face text/colour is driven entirely by setCard(); no per-card materials are
 * required because the rank + suit glyph are rendered with Text components.
 */

import { Card, isRedSuit } from './CardData'
import { CardTextureLibrary } from './CardTextureLibrary'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'

const RED = new vec4(0.86, 0.13, 0.13, 1)
const BLACK = new vec4(0.06, 0.06, 0.06, 1)
const FACE_U_SCALE = 0.93
const FACE_V_SCALE = 0.99

@component
export class CardView extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">CardView — procedural card face/back & flip</span>')
  @ui.separator

  @input
  @allowUndefined
  @hint('Root object holding the white front face (corner Text components live under here).')
  frontRoot: SceneObject

  @input
  @allowUndefined
  @hint('Root object holding the shared generic card-back visual.')
  backRoot: SceneObject

  @input
  @allowUndefined
  @hint('Corner Text components on the front (e.g. top-left & bottom-right). Rank+suit are written here.')
  cornerTexts: Text[] = []

  @input
  @hint('Start the card face-down.')
  startFaceDown: boolean = true

  @ui.separator
  @input
  @allowUndefined
  @hint('Texture library — when set, the front shows the real card image and the back shows card_back.')
  library: CardTextureLibrary

  private _card: Card | null = null
  private _faceUp: boolean = false
  private frontVisual: any = null // RenderMeshVisual (front face)
  private backVisual: any = null // RenderMeshVisual (back face)
  private cached: boolean = false

  private _explicitFace: boolean = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.ensureCached()
      this.applyBackTexture()
      if (this._card) this.refreshFace()
      // Only fall back to the startFaceDown default if no one set the face yet
      // (spawnCard sets it explicitly before OnStart for dealt cards).
      if (!this._explicitFace) this.setFaceUp(!this.startFaceDown, false)
      else this.setFaceUp(this._faceUp, false)
    })
  }

  /**
   * Grab + clone the front/back mesh materials once. Idempotent and lazy so it
   * works even when setCard() is called before OnStart (e.g. dealt on OnEnable).
   */
  private ensureCached(): void {
    if (this.cached) return
    if (this.frontRoot) {
      this.frontVisual = this.frontRoot.getComponent('Component.RenderMeshVisual')
      if (this.frontVisual && this.frontVisual.mainMaterial) {
        this.frontVisual.mainMaterial = this.frontVisual.mainMaterial.clone()
      }
      this.makeTwoSided(this.frontVisual)
    }
    if (this.backRoot) {
      this.backVisual = this.backRoot.getComponent('Component.RenderMeshVisual')
      this.makeTwoSided(this.backVisual)
    }
    // Only mark cached once the visuals actually exist (components are ready).
    if (this.frontVisual || this.backVisual) this.cached = true
  }

  /** Render a card plane from both sides so grabbing/billboarding never culls it. */
  private makeTwoSided(visual: any): void {
    if (visual && visual.mainPass) {
      try { visual.mainPass.twoSided = true } catch (e) {}
    }
  }

  private applyBackTexture(): void {
    this.ensureCached()
    if (this.library && this.backVisual && this.backVisual.mainPass && this.library.back) {
      this.backVisual.mainPass.baseTex = this.library.back
    }
  }

  get card(): Card | null {
    return this._card
  }

  get isFaceUp(): boolean {
    return this._faceUp
  }

  /** Assign which card this view represents and refresh the face text. */
  setCard(card: Card | null): void {
    this._card = card
    this.refreshFace()
  }

  private refreshFace(): void {
    if (!this._card) return
    this.ensureCached()

    // Preferred: real card-face texture by code.
    const tex = this.library ? this.library.getFront(this._card.code) : null
    if (tex && this.frontVisual && this.frontVisual.mainPass) {
      this.frontVisual.mainPass.baseTex = tex
      this.applyFaceTextureCover()
      // The image already shows the rank/suit — clear the overlay text.
      for (const t of this.cornerTexts) { if (t) t.text = '' }
      return
    }

    // Fallback: rank + suit glyph as text (no texture available).
    const label = this._card.rank + this._card.suitGlyph // e.g. "Q♠"
    const colour = isRedSuit(this._card.suit) ? RED : BLACK
    for (const t of this.cornerTexts) {
      if (!t) continue
      t.text = label
      t.textFill.color = colour
    }
  }

  /** Zoom the face texture slightly so card art fills the 5:7 card plane. */
  private applyFaceTextureCover(): void {
    if (!this.frontVisual || !this.frontVisual.mainPass) return

    const transform = mat3.identity()
    transform.column0 = new vec3(FACE_U_SCALE, 0, 0)
    transform.column1 = new vec3(0, FACE_V_SCALE, 0)
    transform.column2 = new vec3((1 - FACE_U_SCALE) * 0.5, (1 - FACE_V_SCALE) * 0.5, 1)

    try {
      this.frontVisual.mainPass.baseTexTransform = transform
    } catch (e) {}
  }

  /** Flip the card. Animated unless `animateFlip` is false. */
  setFaceUp(faceUp: boolean, animateFlip: boolean = true): void {
    this._faceUp = faceUp
    this._explicitFace = true

    const applyVisibility = () => {
      if (this.frontRoot) this.frontRoot.enabled = faceUp
      if (this.backRoot) this.backRoot.enabled = !faceUp
    }

    if (!animateFlip) {
      applyVisibility()
      return
    }

    const tr = this.getSceneObject().getTransform()
    const startRot = tr.getLocalRotation()
    const flipRot = quat.angleAxis(Math.PI, vec3.up()).multiply(startRot)
    let swapped = false

    animate({
      duration: 0.28,
      easing: 'ease-in-out-cubic',
      update: (t: number) => {
        // Swap front/back visibility at the halfway point (edge-on to camera).
        if (t >= 0.5 && !swapped) {
          applyVisibility()
          swapped = true
        }
        tr.setLocalRotation(quat.slerp(startRot, flipRot, t))
      },
      ended: () => {
        tr.setLocalRotation(startRot)
        if (!swapped) applyVisibility()
      },
    })
  }

  toggleFace(): void {
    this.setFaceUp(!this._faceUp)
  }
}
