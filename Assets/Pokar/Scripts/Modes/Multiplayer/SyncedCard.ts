/**
 * SyncedCard – Networked card state for Connected Lenses multiplayer.
 *
 * Syncs position, rotation and face-up/down across peers using SpectaclesSyncKit.
 * Ownership model: the device that owns this SyncEntity's store writes its local
 * transform every frame; all other peers receive updates via onRemoteChange and
 * apply them. Peer-to-peer — no authoritative server.
 *
 * Attach alongside a CardView (for the flip visual) on the networked card prefab.
 */

import { SyncEntity } from 'SpectaclesSyncKit.lspkg/Core/SyncEntity'
import { StorageProperty } from 'SpectaclesSyncKit.lspkg/Core/StorageProperty'
import { CardView } from '../../Core/CardView'

@component
export class SyncedCard extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">SyncedCard — networked transform + flip</span>')
  @ui.separator

  @input
  @hint('CardView on this card (its flip is driven by the synced faceUp value).')
  cardView: CardView

  private syncEntity: SyncEntity
  private posProp: StorageProperty<any>
  private rotProp: StorageProperty<any>
  private faceUpProp: StorageProperty<any>

  private ready = false

  onAwake(): void {
    this.syncEntity = new SyncEntity(this)

    // Declare synced properties (manual: owner pushes values explicitly).
    this.posProp = StorageProperty.manualVec3('pos', vec3.zero())
    this.rotProp = StorageProperty.manualQuat('rot', quat.quatIdentity())
    this.faceUpProp = StorageProperty.manualBool('faceUp', false)

    this.syncEntity.addStorageProperty(this.posProp)
    this.syncEntity.addStorageProperty(this.rotProp)
    this.syncEntity.addStorageProperty(this.faceUpProp)

    // Remote → local: apply incoming changes (non-owners).
    this.posProp.onRemoteChange.add((v: vec3) => {
      this.getTransform().setWorldPosition(v)
    })
    this.rotProp.onRemoteChange.add((v: quat) => {
      this.getTransform().setWorldRotation(v)
    })
    this.faceUpProp.onRemoteChange.add((v: boolean) => {
      if (this.cardView) this.cardView.setFaceUp(v, true)
    })

    this.syncEntity.notifyOnReady(() => {
      this.ready = true
    })

    // Owner → network: push local transform every frame.
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    if (!this.ready || !this.syncEntity.doIOwnStore()) return
    const tr = this.getTransform()
    this.posProp.setPendingValue(tr.getWorldPosition())
    this.rotProp.setPendingValue(tr.getWorldRotation())
  }

  /** Owner-only: flip the card and broadcast the new face state. */
  setFaceUp(faceUp: boolean): void {
    if (this.cardView) this.cardView.setFaceUp(faceUp, true)
    if (this.ready && this.syncEntity.doIOwnStore()) {
      this.faceUpProp.setPendingValue(faceUp)
    }
  }

  get isOwner(): boolean {
    return this.ready && this.syncEntity.doIOwnStore()
  }
}
