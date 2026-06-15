/**
 * PokerSessionManager – Connected Lenses session lifecycle for multiplayer poker.
 *
 * Wraps SpectaclesSyncKit's SessionController: logs peers joining/leaving and
 * exposes simple state (local user id, player count). Card & pot syncing are
 * handled by SyncedCard / PotSync respectively (each its own SyncEntity), so this
 * manager stays thin — it just reports session readiness and roster changes.
 *
 * SETUP: the SpectaclesSyncKit "SyncKit" / session prefab must be present in the
 * scene (it bootstraps the ConnectedLensModule + SessionController). This component
 * only consumes the already-initialised SessionController.
 */

import { SessionController } from 'SpectaclesSyncKit.lspkg/Core/SessionController'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'

@component
export class PokerSessionManager extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">PokerSessionManager — Connected Lenses roster</span>')
  @ui.separator

  @input
  @hint('Log roster changes to the console.')
  enableLogging: boolean = true

  /** Fires when the local session is ready (connected & mapped). */
  readonly onSessionReady: Event<void> = new Event<void>()
  /** Fires when the player roster changes; payload = current player count. */
  readonly onRosterChanged: Event<number> = new Event<number>()

  private session: SessionController
  private playerCount = 0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.session = SessionController.getInstance()

    this.session.onUserJoinedSession.add((_s: any, userInfo: any) => {
      this.playerCount++
      if (this.enableLogging) {
        print('[Poker MP] Joined: ' + (userInfo?.displayName ?? userInfo?.connectionId) +
          ' (players: ' + this.playerCount + ')')
      }
      this.onRosterChanged.invoke(this.playerCount)
    })

    this.session.onUserLeftSession.add((_s: any, userInfo: any) => {
      this.playerCount = Math.max(0, this.playerCount - 1)
      if (this.enableLogging) {
        print('[Poker MP] Left: ' + (userInfo?.displayName ?? userInfo?.connectionId) +
          ' (players: ' + this.playerCount + ')')
      }
      this.onRosterChanged.invoke(this.playerCount)
    })

    // SessionController is a singleton bootstrapped by the SyncKit prefab; by the
    // time this mode is enabled it is typically already mapped.
    if (this.enableLogging) {
      print('[Poker MP] Local user id: ' + this.getLocalUserId())
    }
    this.onSessionReady.invoke()
  }

  getLocalUserId(): string {
    try {
      return this.session?.getLocalUserId() ?? '(unknown)'
    } catch (e) {
      return '(unknown)'
    }
  }

  getPlayerCount(): number {
    try {
      return this.session?.getUsers()?.length ?? this.playerCount
    } catch (e) {
      return this.playerCount
    }
  }
}
