/**
 * CaptureSession – Resolution × Compression matrix benchmark.
 *
 * Flow:
 *   1. Lens starts → wait 20 s
 *   2. POST /session/start
 *   3. For each resolution (256 / 512 / 640 / 756 px):
 *        Create one camera stream, then run all 5 compression levels × 15 s each
 *        (MaximumCompression → LowQuality → IntermediateQuality → HighQuality → MaximumQuality)
 *   4. POST /session/end
 *
 * Total: 20 cells × 15 s = 5 min capture + 20 s startup.
 * Requires Extended Permissions (camera + internet together).
 */

const RESOLUTIONS = [256, 512, 640, 756]

type CompLevel = {key: string, quality: CompressionQuality}

const STARTUP_DELAY_S = 20
const ROUND_DURATION_S = 15

@component
export class CaptureSession extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CaptureSession – Resolution × Compression matrix</span><br/><span style="color: #94A3B8; font-size: 11px;">20 s startup → 20 rounds × 15 s (4 resolutions × 5 compression levels).</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Network</span>')
  @ui.group_start('Network')
  @input
  @hint("Base URL of your backend, e.g. http://192.168.1.42:3333")
  backendUrl: string = "http://192.168.1.42:3333"
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug</span>')
  @ui.group_start('Debug')
  @input
  @hint("Print verbose status messages")
  enableLogging: boolean = true
  @ui.group_end

  private cameraModule: CameraModule = require('LensStudio:CameraModule')
  private internetModule: InternetModule = require('LensStudio:InternetModule')

  private sessionId: string = ''
  private currentCamera: Texture | null = null

  // Defined in onStart so CompressionQuality enum is accessible at runtime
  private compLevels: CompLevel[] = []

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.onStart())
  }

  private onStart(): void {
    this.compLevels = [
      {key: 'maxComp', quality: CompressionQuality.MaximumCompression},
      {key: 'low',     quality: CompressionQuality.LowQuality},
      {key: 'medium',  quality: CompressionQuality.IntermediateQuality},
      {key: 'high',    quality: CompressionQuality.HighQuality},
      {key: 'maxQual', quality: CompressionQuality.MaximumQuality},
    ]

    this.sessionId = Date.now().toString()
    this.log('Session ' + this.sessionId + ' — starting in ' + STARTUP_DELAY_S + ' s')
    this.runSession().catch(err => print('[CaptureSession] FATAL: ' + err))
  }

  private async runSession(): Promise<void> {
    await this.delay(STARTUP_DELAY_S)
    await this.post('/session/start', {sessionId: this.sessionId, sessionType: 'matrix'})
    this.log('Session started')

    for (const resolution of RESOLUTIONS) {
      // Create the camera stream once per resolution; reuse it for all 5 compression rounds.
      this.currentCamera = this.createCameraStream(resolution)
      await this.delay(1) // let the stream initialise

      for (const comp of this.compLevels) {
        await this.runRound(resolution, comp)
      }
    }

    await this.post('/session/end', {sessionId: this.sessionId})
    this.log('All rounds complete. Session ended.')
  }

  private async runRound(resolution: number, comp: CompLevel): Promise<void> {
    const roundKey = resolution + '_' + comp.key
    this.log('Round: ' + roundKey + ' (' + ROUND_DURATION_S + ' s)')

    await this.post('/session/round-start', {
      sessionId: this.sessionId,
      roundKey,
      resolution,
      compressionKey: comp.key,
    })

    const roundEndMs = Date.now() + ROUND_DURATION_S * 1000
    let frameIndex = 0

    while (Date.now() < roundEndMs) {
      try {
        const snapshot = await this.captureFrame()
        const encoded = await this.encodeTexture(snapshot, comp.quality)
        await this.post('/upload', {
          sessionId: this.sessionId,
          roundKey,
          frameIndex: frameIndex++,
          timestamp: Date.now(),
          image: encoded,
        })
      } catch (err) {
        print('[CaptureSession] Frame error (' + roundKey + '): ' + err)
        await this.delay(0.5)
      }
    }

    await this.post('/session/round-end', {sessionId: this.sessionId, roundKey})
    this.log('Round ' + roundKey + ' done — ' + frameIndex + ' frames')
  }

  private createCameraStream(resolution: number): Texture {
    const request = CameraModule.createCameraRequest()
    request.cameraId = CameraModule.CameraId.Default_Color
    request.imageSmallerDimension = resolution
    return this.cameraModule.requestCamera(request)
  }

  private captureFrame(): Promise<Texture> {
    return new Promise((resolve, reject) => {
      if (!this.currentCamera) { reject(new Error('camera not ready')); return }
      const provider = this.currentCamera.control as CameraTextureProvider
      const reg = provider.onNewFrame.add(() => {
        provider.onNewFrame.remove(reg)
        resolve(ProceduralTextureProvider.createFromTexture(this.currentCamera!))
      })
    })
  }

  private encodeTexture(texture: Texture, compression: CompressionQuality): Promise<string> {
    return new Promise((resolve, reject) => {
      Base64.encodeTextureAsync(
        texture,
        resolve,
        () => reject(new Error('encode failed')),
        compression,
        EncodingType.Jpg,
      )
    })
  }

  private async post(path: string, body: object): Promise<void> {
    const response = await this.internetModule.fetch(
      new Request(this.backendUrl + path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {'Content-Type': 'application/json'},
      }),
    )
    if (response.status < 200 || response.status >= 300) {
      throw new Error('HTTP ' + response.status + ' on POST ' + path)
    }
  }

  private delay(seconds: number): Promise<void> {
    return new Promise(resolve => {
      const ev = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent
      ev.bind(() => resolve())
      ev.reset(seconds)
    })
  }

  private log(msg: string): void {
    if (this.enableLogging) print('[CaptureSession] ' + msg)
  }
}
