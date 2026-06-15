/**
 * PotSync – Networked pot total for Connected Lenses multiplayer.
 *
 * Mirrors the shared pot across peers. Any peer can add chips (a bet) by calling
 * addToPot(); the change is written to the synced store and reflected to all peers.
 * The local BetController is kept in sync so its pot Text matches the network value.
 *
 * Because betting is additive and idempotent per-action, peer-to-peer additive
 * updates converge without an authoritative server (last-writer total wins on
 * concurrent edits, which is acceptable for a casual assistant).
 */

import { SyncEntity } from 'SpectaclesSyncKit.lspkg/Core/SyncEntity'
import { StorageProperty } from 'SpectaclesSyncKit.lspkg/Core/StorageProperty'
import { BetController } from '../../Core/BetController'

@component
export class PotSync extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">PotSync — networked pot total</span>')
  @ui.separator

  @input
  @hint('Local BetController whose pot mirrors the synced value.')
  betController: BetController

  private syncEntity: SyncEntity
  private potProp: StorageProperty<any>
  private ready = false

  onAwake(): void {
    this.syncEntity = new SyncEntity(this)
    this.potProp = StorageProperty.manualInt('pot', 0)
    this.syncEntity.addStorageProperty(this.potProp)

    // Remote → local: reflect the network pot onto the local controller.
    this.potProp.onRemoteChange.add((v: number) => {
      if (this.betController) this.betController.setPot(v)
    })

    this.syncEntity.notifyOnReady(() => {
      this.ready = true
      if (this.betController && this.potProp.currentValue != null) {
        this.betController.setPot(this.potProp.currentValue)
      }
      // When a local bet is committed, push the new pot total to the network.
      if (this.betController) {
        this.betController.onPotChanged.add((total: number) => this.pushPot(total))
      }
    })
  }

  /** Add chips to the shared pot and broadcast. */
  addToPot(amount: number): void {
    if (this.betController) this.betController.addToPot(amount) // triggers onPotChanged → pushPot
    else this.pushPot((this.potProp.currentValue ?? 0) + amount)
  }

  private pushPot(total: number): void {
    if (!this.ready) return
    // Anyone may modify the pot store in this casual P2P model.
    this.potProp.setPendingValue(total)
  }
}
