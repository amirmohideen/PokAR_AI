/**
 * TableLayout – Defines the virtual poker table's anchor slots in world space.
 *
 * Slots are plain SceneObjects you position in the editor (or auto-generated as
 * children if left unassigned). Other systems (dealing, snap-back) read slot
 * world transforms from here so there's a single source of truth for the layout.
 */

@component
export class TableLayout extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">TableLayout — slot anchors for cards, field & pot</span>')
  @ui.separator

  @input
  @hint('Anchor objects for the local player\'s hole cards (usually 2).')
  handSlots: SceneObject[] = []

  @input
  @hint('Anchor objects for the community / field cards (usually 5).')
  fieldSlots: SceneObject[] = []

  @input
  @hint('Anchor objects for the CPU opponent\'s hole cards (usually 2).')
  cpuSlots: SceneObject[] = []

  @input
  @allowUndefined
  @hint('Anchor object marking the centre pot / chip area.')
  potAnchor: SceneObject

  @input
  @allowUndefined
  @hint('Anchor where the draw deck sits.')
  deckAnchor: SceneObject

  @input
  @allowUndefined
  @hint('Anchor where the draggable bet chip rests.')
  betAnchor: SceneObject

  @input
  @allowUndefined
  @hint('Anchor where the CPU\'s bet chips stack before flying to the pot.')
  cpuBetAnchor: SceneObject

  /** World position of a hand slot. Falls back to two cards close to the player. */
  getHandSlotPosition(index: number): vec3 {
    const slot = this.handSlots[index]
    if (slot) return slot.getTransform().getWorldPosition()
    // Two cards centred, near the player edge of the table (+Z toward player).
    const origin = this.getSceneObject().getTransform().getWorldPosition()
    return origin.add(new vec3(-4 + index * 8, 0.2, 22))
  }

  /** World position of a community slot: flop (0-2) centre-left, turn (3) & river (4) to the right. */
  getFieldSlotPosition(index: number): vec3 {
    const slot = this.fieldSlots[index]
    if (slot) return slot.getTransform().getWorldPosition()
    const origin = this.getSceneObject().getTransform().getWorldPosition()
    return origin.add(new vec3(-18 + index * 9, 0.2, 4))
  }

  getCpuSlot(index: number): SceneObject | null {
    return this.cpuSlots[index] ?? null
  }

  /** World position of a CPU hole-card slot. Falls back to two cards across the table. */
  getCpuSlotPosition(index: number): vec3 {
    const slot = this.cpuSlots[index]
    if (slot) return slot.getTransform().getWorldPosition()
    const origin = this.getSceneObject().getTransform().getWorldPosition()
    return origin.add(new vec3(-4 + index * 8, 0.2, -18))
  }

  get betPosition(): vec3 {
    return this.betAnchor
      ? this.betAnchor.getTransform().getWorldPosition()
      : this.getSceneObject().getTransform().getWorldPosition()
  }

  /** Where the CPU's bet chips spawn. Falls back part-way from the CPU cards toward the pot. */
  get cpuBetPosition(): vec3 {
    if (this.cpuBetAnchor) return this.cpuBetAnchor.getTransform().getWorldPosition()
    return vec3.lerp(this.getCpuSlotPosition(0), this.potPosition, 0.4)
  }

  getHandSlot(index: number): SceneObject | null {
    return this.handSlots[index] ?? null
  }

  getFieldSlot(index: number): SceneObject | null {
    return this.fieldSlots[index] ?? null
  }

  get potPosition(): vec3 {
    return this.potAnchor
      ? this.potAnchor.getTransform().getWorldPosition()
      : this.getSceneObject().getTransform().getWorldPosition()
  }

  get deckPosition(): vec3 {
    return this.deckAnchor
      ? this.deckAnchor.getTransform().getWorldPosition()
      : this.getSceneObject().getTransform().getWorldPosition()
  }

  private slotPos(slots: SceneObject[], index: number): vec3 {
    const slot = slots[index]
    if (slot) return slot.getTransform().getWorldPosition()
    // Fallback: spread along local X relative to the table origin (~6 cm spacing).
    const origin = this.getSceneObject().getTransform().getWorldPosition()
    return origin.add(new vec3(index * 6, 0, 0))
  }
}
