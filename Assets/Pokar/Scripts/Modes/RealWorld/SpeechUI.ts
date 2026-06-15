import animate, { CancelSet } from "SpectaclesInteractionKit.lspkg/Utils/animate";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const UI_CAM_DISTANCE = 50;
const UI_CAM_HEIGHT = -9;

@component
export class SpeechUI extends BaseScriptComponent {
  @input @allowUndefined mainCamObj: SceneObject;
  @input @allowUndefined speecBocAnchor: SceneObject;
  @input @allowUndefined micRend: RenderMeshVisual;
  @input @allowUndefined speechText: Text;
  @input @allowUndefined speechButtonCollider: ColliderComponent;

  onSpeechReady = new Event<string>();

  private speechBubbleTrans: Transform;
  private trans: Transform;
  private mainCamTrans: Transform;
  private animationCancelSet: CancelSet = new CancelSet();

  onAwake() {
    this.speechBubbleTrans = this.speecBocAnchor.getTransform();
    this.speechBubbleTrans.setLocalScale(vec3.one());
    this.trans = this.getSceneObject().getTransform();
    this.mainCamTrans = this.mainCamObj.getTransform();

    this.speechText.text = "Pinch to read your poker odds";
    this.createEvent("OnStartEvent").bind(this.onStart.bind(this));
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  private onStart() { }

  activateSpeechButton(activate: boolean) {
    this.speechButtonCollider.enabled = activate;
  }

  onSpeechButtonDown() {
    this.speechText.text = "Analysing the scene...";
    this.animateSpeechBubble(true);
  }

  stopListening() {
  }

  hideSpeechBubble() {
    this.animateSpeechBubble(false);
  }

  showSpeechBubble() {
    this.animateSpeechBubble(true);
  }

  private onUpdate() {
    var camPos = this.mainCamTrans.getWorldPosition();
    var desiredPosition = camPos.add(
      this.mainCamTrans.forward.uniformScale(-UI_CAM_DISTANCE)
    );
    desiredPosition = desiredPosition.add(
      this.mainCamTrans.up.uniformScale(UI_CAM_HEIGHT)
    );
    this.trans.setWorldPosition(
      vec3.lerp(
        this.trans.getWorldPosition(),
        desiredPosition,
        getDeltaTime() * 10
      )
    );
    var desiredRotation = quat.lookAt(this.mainCamTrans.forward, vec3.up());
    this.trans.setWorldRotation(
      quat.slerp(
        this.trans.getWorldRotation(),
        desiredRotation,
        getDeltaTime() * 10
      )
    );
  }

  private animateSpeechBubble(open: boolean) {
    // Cancel any existing animation
    this.animationCancelSet.cancel();

    var currScale = this.speechBubbleTrans.getLocalScale();
    var desiredScale = open ? vec3.one() : vec3.zero();
    animate({
      easing: open ? "ease-out-elastic" : "ease-in-quad",
      duration: open ? 1 : 0.4,
      update: (t) => {
        this.speechBubbleTrans.setLocalScale(
          vec3.lerp(currScale, desiredScale, t)
        );
      },
      ended: null,
      cancelSet: this.animationCancelSet,
    });
  }
}
