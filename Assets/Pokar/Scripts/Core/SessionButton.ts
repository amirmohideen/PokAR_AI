/**
 * SessionButton – Repurposes the Surface-Placement Reset button by game state.
 *
 * - In the main menu (GameMode.None): label "Reset", press re-positions the
 *   surface (calls the placement helper's resetPlacement()).
 * - During a game: label "Menu", press ends the session and returns to the
 *   main menu (GameManager.setMode(None) + MainMenu.open()).
 *
 * Set the button's CapsuleButton `Add Callbacks` to FALSE so its inspector
 * callback no longer fires — this script owns the press via onTriggerUp.
 */

import { CapsuleButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/CapsuleButton'
import { Example } from 'SurfacePlacement.lspkg/Example'
import { GameManager, GameMode } from './GameManager'
import { MainMenu } from './MainMenu'

@component
export class SessionButton extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">SessionButton — Reset (menu) / Menu (in game)</span>')
  @ui.separator

  @input
  @hint('The Reset button (UIKit CapsuleButton). Set its Add Callbacks to false.')
  button: CapsuleButton

  @input
  @allowUndefined
  @hint('The button\'s label Text (switches between "Reset" and "Menu").')
  label: Text

  @input gameManager: GameManager
  @input mainMenu: MainMenu

  @input
  @allowUndefined
  @hint('The Surface-Placement Example component (for re-positioning in the menu).')
  placement: Example

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    if (this.button) {
      this.button.onInitialized.add(() => this.button.onTriggerUp.add(() => this.onPress()))
    }
    if (this.gameManager) {
      this.gameManager.onModeChanged.add((m) => this.updateLabel(m))
      this.updateLabel(this.gameManager.mode)
    }
  }

  private updateLabel(mode: GameMode): void {
    if (this.label) this.label.text = mode === GameMode.None ? 'Reset' : 'Menu'
  }

  private onPress(): void {
    const inGame = this.gameManager && this.gameManager.mode !== GameMode.None
    if (inGame) {
      // End the session → back to the main menu.
      this.gameManager.setMode(GameMode.None)
      if (this.mainMenu) this.mainMenu.open()
    } else {
      // In the menu → re-position the surface.
      if (this.placement) this.placement.resetPlacement()
    }
  }
}
