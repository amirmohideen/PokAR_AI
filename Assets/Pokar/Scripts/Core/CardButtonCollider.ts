/**
 * CardButtonCollider – Gives a flat card a proper BOX collider for SIK interaction.
 *
 * When a card visual is a flat plane, a fit-to-visual / sphere collider doesn't
 * give the pinch ray a reliable target. UIKit buttons work because they build a
 * box collider sized to the element; this does the same for our hand-built card
 * buttons so SIK PinchButton / Interactable can be hit.
 *
 * Runs at start: sets the ColliderComponent's shape to a Box of `localSize`
 * (in the object's local space, before its transform scale). Disables fitVisual.
 */

@component
export class CardButtonCollider extends BaseScriptComponent {
  @input
  @hint('Box collider size in LOCAL space (multiplied by the object scale). Plane is 1x1, so ~1,1,small.')
  localSize: vec3 = new vec3(1, 1, 0.4)

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.fit())
  }

  fit(): void {
    const collider: any = this.getSceneObject().getComponent('Physics.ColliderComponent')
    if (!collider) {
      print('[CardButtonCollider] No ColliderComponent on ' + this.getSceneObject().name)
      return
    }
    try {
      const box = Shape.createBoxShape()
      box.size = this.localSize
      collider.fitVisual = false
      collider.shape = box
    } catch (e) {
      print('[CardButtonCollider] Failed to set box shape: ' + e)
    }
  }
}
