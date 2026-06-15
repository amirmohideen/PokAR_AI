/**
 * MainMenu – Mode-selection menu shown on the placed table surface.
 *
 * Three SIK PinchButtons (Single-Player / Multiplayer / Real-World) call
 * GameManager.setMode(). The menu hides itself once a mode is chosen and can be
 * reopened via open().
 *
 * Selection is driven by each button's SIK Interactable (onTriggerStart), so it
 * fires for BOTH a far-field pinch AND a direct index-finger poke.
 *
 * The proximity HIGHLIGHT (label turns light blue, card lifts by `liftAmount` on
 * +Y) is driven separately, every frame, from the raw index-fingertip position —
 * because SIK's poke "hover" volume is essentially touch-distance and gives no
 * early "near" signal. We compute the fingertip→card distance each frame and
 * highlight while it's within `hoverDistance`.
 */

import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { GameManager, GameMode } from './GameManager'
import SIK from 'SpectaclesInteractionKit.lspkg/SIK'
import TrackedHand from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand'

// Highlight colour for a hovered card label (#60A5FA — the menu's accent blue).
const LIGHT_BLUE = new vec4(0.376, 0.647, 0.98, 1.0)

/** Per-card runtime state for hover highlight / selection. */
interface MenuEntry {
  card: SceneObject
  label: Text | null
  mode: GameMode
  interactive: boolean
  baseLocalPos: vec3
  baseColor: vec4 | null
  hovered: boolean
}

@component
export class MainMenu extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">MainMenu — pick a game mode on the table</span>')
  @ui.separator

  @input
  @hint('The GameManager whose mode this menu switches.')
  gameManager: GameManager

  @input
  @hint('Root object containing the menu visuals (hidden after a choice).')
  menuRoot: SceneObject

  @ui.separator
  @input singlePlayerButton: PinchButton
  @input multiplayerButton: PinchButton
  @input realWorldButton: PinchButton

  @ui.separator
  @ui.label('Optional per-button card visual + label. Left empty, the card defaults to the button object and the label is auto-detected from it.')
  @input
  @allowUndefined
  singlePlayerCard: SceneObject
  @input
  @allowUndefined
  singlePlayerLabel: Text
  @input
  @allowUndefined
  multiplayerCard: SceneObject
  @input
  @allowUndefined
  multiplayerLabel: Text
  @input
  @allowUndefined
  realWorldCard: SceneObject
  @input
  @allowUndefined
  realWorldLabel: Text

  @ui.separator
  @input
  @hint('Multiplayer is not supported yet — when false, its button ignores presses and touches.')
  multiplayerEnabled: boolean = false

  @input
  @hint('Hide the menu after a mode is selected.')
  hideOnSelect: boolean = true

  @ui.separator
  @input
  @hint('Fingertip distance (cm) within which a card highlights and lifts.')
  hoverDistance: number = 5.625

  @input
  @hint('How far a hovered card lifts on its local +Y axis.')
  liftAmount: number = 0.2

  @input
  @hint('Print fingertip→card distances to the Logger so you can tune hoverDistance. Turn off once tuned.')
  debugLogging: boolean = true

  private entries: MenuEntry[] = []
  private hands: TrackedHand[] = []
  private handsReady: boolean = false
  private logTimer: number = 0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.setupEntry(this.singlePlayerButton, this.singlePlayerCard, this.singlePlayerLabel,
                    GameMode.SinglePlayer, true)
    this.setupEntry(this.multiplayerButton, this.multiplayerCard, this.multiplayerLabel,
                    GameMode.Multiplayer, this.multiplayerEnabled)
    this.setupEntry(this.realWorldButton, this.realWorldCard, this.realWorldLabel,
                    GameMode.RealWorld, true)

    // Bind the update loop FIRST — before any SIK hand access. MainMenu runs at
    // app start, before SIK's hand provider is ready; touching SIK here would
    // throw and kill the rest of init (including this binding). Hands are
    // acquired lazily in onUpdate() once SIK is ready.
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())

    print('[MainMenu] init done — entries=' + this.entries.length +
          ' menuRoot=' + (this.menuRoot ? this.menuRoot.name : 'null'))
  }

  /** Lazily grab the hand inputs once SIK is initialised; retries each frame until then. */
  private ensureHands(): void {
    if (this.handsReady) return
    try {
      const handData = SIK.HandInputData
      if (!handData) return
      this.hands = [handData.getHand('right'), handData.getHand('left')]
      this.handsReady = true
      print('[MainMenu] hand input acquired (' + this.hands.length + ' hands)')
    } catch (e) {
      // SIK not ready yet — try again next frame.
    }
  }

  /** Build a card entry and wire its Interactable trigger (poke push or pinch) → select. */
  private setupEntry(button: PinchButton, card: SceneObject, label: Text,
                     mode: GameMode, interactive: boolean): void {
    if (!button) return
    const so = button.getSceneObject()
    const cardObj = card ?? so
    const labelComp = label ?? this.findText(cardObj)
    const baseColor = labelComp ? this.copyColor(labelComp.textFill.color) : null
    const basePos = cardObj.getTransform().getLocalPosition()

    const entry: MenuEntry = {
      card: cardObj,
      label: labelComp,
      mode,
      interactive,
      baseLocalPos: new vec3(basePos.x, basePos.y, basePos.z),
      baseColor,
      hovered: false,
    }
    this.entries.push(entry)

    const interactable = so.getComponent(Interactable.getTypeName()) as Interactable
    if (interactable) {
      interactable.onTriggerStart.add(() => {
        if (entry.interactive) this.choose(entry.mode)
      })
    } else {
      print('[MainMenu] WARNING: no Interactable on button for ' + mode + ' — selection disabled.')
    }
  }

  /** Per-frame: highlight each card whose nearest index fingertip is within hoverDistance. */
  private onUpdate(): void {
    // Throttled heartbeat so we can see, in the Logger, whether this runs at all.
    this.logTimer += getDeltaTime()
    const beat = this.debugLogging && this.logTimer >= 0.5
    if (beat) this.logTimer = 0

    if (this.menuRoot && !this.menuRoot.enabled) {
      this.resetAll()
      if (beat) print('[MainMenu] menu hidden (menuRoot "' + this.menuRoot.name + '" disabled) — skipping')
      return
    }

    this.ensureHands()
    if (!this.handsReady) {
      this.resetAll()
      if (beat) print('[MainMenu] waiting for SIK hand input…')
      return
    }

    const tips: vec3[] = []
    for (const hand of this.hands) {
      if (hand && hand.isTracked()) {
        const tip = hand.indexTip.position
        if (tip) tips.push(tip)
      }
    }

    if (tips.length === 0) {
      this.resetAll()
      if (beat) print('[MainMenu] menu visible but NO index fingertip tracked')
      return
    }

    let dbg = ''
    for (const entry of this.entries) {
      if (!entry.interactive) {
        this.applyHover(entry, false)
        continue
      }
      const cardPos = entry.card.getTransform().getWorldPosition()
      let minDist = Infinity
      for (const tip of tips) {
        const d = cardPos.distance(tip)
        if (d < minDist) minDist = d
      }
      this.applyHover(entry, minDist <= this.hoverDistance)
      dbg += '  ' + entry.mode + '=' + minDist.toFixed(1) + 'cm'
    }
    if (beat) print('[MainMenu] tip→card:' + dbg + '  (hoverDistance=' + this.hoverDistance + ')')
  }

  /** Apply / clear the highlight: light-blue label + card lifted on +Y. */
  private applyHover(entry: MenuEntry, hovered: boolean): void {
    if (entry.hovered === hovered) return
    entry.hovered = hovered

    if (entry.label && entry.baseColor) {
      entry.label.textFill.color = hovered ? LIGHT_BLUE : entry.baseColor
    }
    const tr = entry.card.getTransform()
    tr.setLocalPosition(
      hovered ? entry.baseLocalPos.add(new vec3(0, this.liftAmount, 0)) : entry.baseLocalPos,
    )
  }

  private resetAll(): void {
    for (const entry of this.entries) this.applyHover(entry, false)
  }

  private findText(root: SceneObject): Text | null {
    const direct = root.getComponent('Component.Text') as Text
    if (direct) return direct
    const n = root.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const c = root.getChild(i).getComponent('Component.Text') as Text
      if (c) return c
    }
    return null
  }

  private copyColor(c: vec4): vec4 {
    return new vec4(c.x, c.y, c.z, c.w)
  }

  private choose(mode: GameMode): void {
    print('[MainMenu] Selected mode: ' + mode)
    if (this.gameManager) this.gameManager.setMode(mode)
    if (this.hideOnSelect && this.menuRoot) {
      this.resetAll()
      this.menuRoot.enabled = false
    }
  }

  /** Reopen the menu (e.g. from a "back to menu" action). */
  open(): void {
    if (this.menuRoot) this.menuRoot.enabled = true
    this.resetAll()
    if (this.gameManager) this.gameManager.setMode(GameMode.None)
  }
}
