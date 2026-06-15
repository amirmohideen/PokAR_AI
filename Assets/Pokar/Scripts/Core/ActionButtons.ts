/**
 * ActionButtons – Fold / Call / Raise UIKit buttons wired to the BetController.
 *
 * Each button is a SpectaclesUIKit CapsuleButton (the same component the
 * Surface-Placement Reset button uses — it self-builds its visual, collider and
 * interaction). We subscribe to the button's onTriggerUp event in code, so no
 * inspector callback wiring is needed. On press the poker action fires and is
 * broadcast for the active game-mode controller to react to.
 */

import { CapsuleButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/CapsuleButton'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { BetController } from './BetController'

export enum PokerAction {
  Fold = 'fold',
  Call = 'call',
  Raise = 'raise',
}

@component
export class ActionButtons extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">ActionButtons — Fold / Call / Raise</span>')
  @ui.separator

  @input foldButton: CapsuleButton
  @input callButton: CapsuleButton
  @input raiseButton: CapsuleButton

  @input
  @hint('BetController used to commit the bet on Call / Raise.')
  betController: BetController

  @input
  @hint('Default amount used for Call if the current bet is 0.')
  callAmount: number = 10

  /** Fires with the action taken and the amount committed (0 for fold). */
  readonly onAction: Event<{ action: PokerAction; amount: number }> = new Event<{
    action: PokerAction
    amount: number
  }>()

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.wire(this.foldButton, () => this.handleFold())
    this.wire(this.callButton, () => this.handleCall())
    this.wire(this.raiseButton, () => this.handleRaise())
  }

  /** Subscribe to a UIKit button's release event (once it's initialized). */
  private wire(button: CapsuleButton, action: () => void): void {
    if (!button) return
    // onInitialized is a replay event: fires immediately if already set up.
    button.onInitialized.add(() => button.onTriggerUp.add(action))
  }

  private handleFold(): void {
    if (this.betController) {
      this.betController.setBet(0)
      this.betController.clearStack() // discard the staged chips (they don't go to the pot)
    }
    this.onAction.invoke({ action: PokerAction.Fold, amount: 0 })
  }

  private handleCall(): void {
    let amount = 0
    if (this.betController) {
      if (this.betController.currentBet <= 0) this.betController.setBet(this.callAmount)
      amount = this.betController.commitBet()
    }
    this.onAction.invoke({ action: PokerAction.Call, amount })
  }

  private handleRaise(): void {
    // The player sets the raise size by dragging the chip; commit whatever is staged.
    const amount = this.betController ? this.betController.commitBet() : 0
    this.onAction.invoke({ action: PokerAction.Raise, amount })
  }
}
