/**
 * MenuCardDealer – Deals the three mode-select cards out of a stack on reveal.
 *
 * When the menu becomes visible (i.e. after the user places the experience on a
 * surface), the three mode cards start collapsed on top of the deck stack, face
 * down, then fly out one-by-one to their home positions and flip face-up — like
 * dealing/revealing cards.
 *
 * Each card's "home" is captured from its initial local position/rotation at
 * start, so you just lay the cards out where you want them in the editor and the
 * dealer animates them in from the stack.
 */

import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'

@component
export class MenuCardDealer extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">MenuCardDealer — deal mode cards from the stack</span>')
  @ui.separator

  @input
  @hint('The deck stack object the cards are dealt from (their start position).')
  stackAnchor: SceneObject

  @ui.separator
  @input card1: SceneObject
  @input card2: SceneObject
  @input card3: SceneObject

  @ui.separator
  @input
  @hint('Seconds each card takes to fly to its position.')
  flyDuration: number = 0.45

  @input
  @hint('Delay between consecutive card deals (seconds).')
  stagger: number = 0.35

  @input
  @hint('Re-deal every time the menu is shown (vs. only the first time).')
  dealOnEachShow: boolean = true

  @input
  @allowUndefined
  @hint('AudioComponent played each time a card is dealt.')
  dealSound: AudioComponent

  private cards: SceneObject[] = []
  private homePositions: vec3[] = []
  private homeRotations: quat[] = []
  private captured = false
  private hasDealt = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.capture()
      this.deal()
    })
    // Fires when the menu subtree is re-enabled (e.g. surface re-placed / back to menu).
    this.createEvent('OnEnableEvent').bind(() => {
      if (this.captured && this.dealOnEachShow) this.deal()
    })
  }

  private capture(): void {
    this.cards = [this.card1, this.card2, this.card3].filter(c => !!c)
    this.homePositions = []
    this.homeRotations = []
    for (const c of this.cards) {
      const tr = c.getTransform()
      this.homePositions.push(tr.getLocalPosition())
      this.homeRotations.push(tr.getLocalRotation())
    }
    this.captured = true
  }

  /** Snap all cards onto the stack (face down), then fly them out one-by-one. */
  private deal(): void {
    if (!this.cards.length) return
    this.hasDealt = true

    const stackPos = this.stackAnchor
      ? this.stackAnchor.getTransform().getLocalPosition()
      : this.homePositions[0]
    // Face-down = rotated 180° about Y from the home (face-up) orientation.
    const faceDownOffset = quat.angleAxis(Math.PI, vec3.up())

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      const tr = card.getTransform()
      const homePos = this.homePositions[i]
      const homeRot = this.homeRotations[i]
      const startRot = faceDownOffset.multiply(homeRot)

      // Collapse onto the stack, face down, slightly fanned by index.
      tr.setLocalPosition(stackPos)
      tr.setLocalRotation(startRot)

      // Stagger the deal so cards come out one at a time.
      const delayEv = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent
      delayEv.bind(() => {
        if (this.dealSound) this.dealSound.play(1)
        animate({
          duration: this.flyDuration,
          easing: 'ease-out-cubic',
          update: (t: number) => {
            tr.setLocalPosition(vec3.lerp(stackPos, homePos, t))
            tr.setLocalRotation(quat.slerp(startRot, homeRot, t))
          },
          ended: () => {
            tr.setLocalPosition(homePos)
            tr.setLocalRotation(homeRot)
          },
        })
      })
      delayEv.reset(i * this.stagger)
    }
  }
}
