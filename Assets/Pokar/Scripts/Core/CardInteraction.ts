/**
 * CardInteraction – Makes a card grabbable with the hand (SIK) and snaps it back
 * to its assigned table slot on release.
 *
 * Relies on SIK's InteractableManipulation for the actual grab/drag (add that
 * component + an Interactable + a Collider to the card object in the editor).
 * This script only listens for manipulation start/end and animates the return.
 *
 * Assign `homeSlot` (a SceneObject anchor) — on release the card lerps back to it.
 * If `homeSlot` is null, the card stays where it was dropped.
 */

import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation'
import WorldCameraFinderProvider from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { CardView } from './CardView'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'

@component
export class CardInteraction extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">CardInteraction — grab, reveal to camera, snap-back</span>')
  @ui.separator

  @input
  @allowUndefined
  @hint('The SIK InteractableManipulation on this card. If empty, it is looked up on this object.')
  manipulation: InteractableManipulation

  @input
  @allowUndefined
  @hint('Anchor the card returns to when released. Can be set at runtime via setHomeSlot().')
  homeSlot: SceneObject

  @input
  @allowUndefined
  @hint('CardView on this card — flipped face-up while held, face-down when returned.')
  cardView: CardView

  @input
  @hint('While held, rotate the card so its front faces your camera.')
  faceCameraWhileHeld: boolean = true

  @input
  @hint('Snap-back duration in seconds.')
  snapDuration: number = 0.35

  readonly onPickup: Event<void> = new Event<void>()
  readonly onRelease: Event<void> = new Event<void>()

  private isHeld: boolean = false
  private camera = WorldCameraFinderProvider.getInstance()
  private homePos: vec3 | null = null
  private homeRot: quat | null = null
  private partner: CardInteraction | null = null
  private following: boolean = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
    this.createEvent('LateUpdateEvent').bind(() => this.onLateUpdate())
  }

  private init(): void {
    if (!this.manipulation) {
      this.manipulation = this.getSceneObject().getComponent(
        InteractableManipulation.getTypeName(),
      ) as InteractableManipulation
    }
    if (!this.cardView) {
      this.cardView = this.getSceneObject().getComponent(CardView.getTypeName()) as CardView
    }
    if (!this.manipulation) {
      print('[CardInteraction] No InteractableManipulation found — grab disabled.')
      return
    }

    this.manipulation.onManipulationStart.add(() => {
      this.isHeld = true
      if (this.cardView) this.cardView.setFaceUp(true, false)
      this.onPickup.invoke(undefined)
      if (this.partner) this.partner.followAsFan() // bring the other hole card along
    })
    this.manipulation.onManipulationEnd.add(() => {
      this.isHeld = false
      if (this.cardView) this.cardView.setFaceUp(false, false)
      this.onRelease.invoke(undefined)
      this.snapToHome()
      if (this.partner) this.partner.stopFollow()
    })
  }

  /** Link the two hole cards so grabbing one fans both into the hand. */
  setPartner(p: CardInteraction): void {
    this.partner = p
  }

  /** Partner-mode: come along with the held card, revealed. */
  followAsFan(): void {
    this.following = true
    if (this.cardView) this.cardView.setFaceUp(true, false)
  }

  /** Partner-mode end: flip down and return home. */
  stopFollow(): void {
    this.following = false
    if (this.cardView) this.cardView.setFaceUp(false, false)
    this.snapToHome()
  }

  /** Called by the held leader each frame to fan this partner beside it. */
  placeFanned(leaderPos: vec3, leaderRot: quat): void {
    const tr = this.getSceneObject().getTransform()
    tr.setWorldPosition(leaderPos.add(new vec3(7, -1, 0)))
    tr.setWorldRotation(leaderRot.multiply(quat.angleAxis(-0.35, vec3.forward())))
  }

  /** Rotation that turns the card's front toward the camera. */
  private faceCameraRot(pos: vec3): quat {
    const camPos = this.camera.getTransform().getWorldPosition()
    const dir = camPos.sub(pos).normalize()
    return quat.lookAt(dir, vec3.up())
  }

  /** While held, face the leader to the camera and fan the partner beside it. */
  private onLateUpdate(): void {
    if (!this.isHeld || !this.faceCameraWhileHeld) return
    const tr = this.getSceneObject().getTransform()
    const R = this.faceCameraRot(tr.getWorldPosition())
    // Tilt the held card slightly so the fanned pair reads as a hand.
    tr.setWorldRotation(R.multiply(quat.angleAxis(0.2, vec3.forward())))
    if (this.partner && this.partner.following) {
      this.partner.placeFanned(tr.getWorldPosition(), R)
    }
  }

  /** Reassign the slot this card returns to (e.g. when dealt to a new position). */
  setHomeSlot(slot: SceneObject): void {
    this.homeSlot = slot
  }

  /** Set an explicit world home (used when cards are dealt to computed positions). */
  setHomeTransform(pos: vec3, rot: quat): void {
    this.homePos = pos
    this.homeRot = rot
  }

  private homeTarget(): { pos: vec3; rot: quat } | null {
    if (this.homePos && this.homeRot) return { pos: this.homePos, rot: this.homeRot }
    if (this.homeSlot) {
      const t = this.homeSlot.getTransform()
      return { pos: t.getWorldPosition(), rot: t.getWorldRotation() }
    }
    return null
  }

  /** Immediately place the card at its home (no animation). */
  placeAtHome(): void {
    const home = this.homeTarget()
    if (!home) return
    const tr = this.getSceneObject().getTransform()
    tr.setWorldPosition(home.pos)
    tr.setWorldRotation(home.rot)
  }

  private snapToHome(): void {
    const home = this.homeTarget()
    if (!home) return
    const tr = this.getSceneObject().getTransform()
    const startPos = tr.getWorldPosition()
    const startRot = tr.getWorldRotation()
    const endPos = home.pos
    const endRot = home.rot

    animate({
      duration: this.snapDuration,
      easing: 'ease-out-back',
      update: (t: number) => {
        // If the user grabs it again mid-animation, abort the snap.
        if (this.isHeld) return
        tr.setWorldPosition(vec3.lerp(startPos, endPos, t))
        tr.setWorldRotation(quat.slerp(startRot, endRot, t))
      },
      ended: () => {
        if (this.isHeld) return
        tr.setWorldPosition(endPos)
        tr.setWorldRotation(endRot)
      },
    })
  }
}
