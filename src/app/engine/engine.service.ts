import {ElementRef, Injectable, NgZone, OnDestroy} from '@angular/core'
import {
  AmbientLight, BoxGeometry, Clock, DoubleSide, EdgesGeometry,
  Euler, LineBasicMaterial, LineSegments, LoadingManager, Mesh,
  MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
  Raycaster, RepeatWrapping, Scene, TextureLoader,
  Vector2, Vector3, WebGLRenderer
} from 'three'
import * as JSZip from 'jszip'
import JSZipUtils from 'jszip-utils'
import {UserService} from './../user/user.service'
import {config} from '../app.config'
import {RWXLoader} from '../utils/rwxloader'
import {User} from '../user/user.model'

export const RES_PATH = config.url.resource
export const enum PressedKey { up = 0, right, down, left, pgUp, pgDown, plus, minus, ctrl, shift }

@Injectable({providedIn: 'root'})
export class EngineService implements OnDestroy {
  public avatarList: string[] = []

  private canvas: HTMLCanvasElement
  private labelZone: HTMLDivElement
  private renderer: WebGLRenderer
  private clock: Clock
  private camera: PerspectiveCamera
  private thirdCamera: PerspectiveCamera
  private activeCamera: PerspectiveCamera
  private scene: Scene
  private light: AmbientLight
  private avatar: Mesh

  private frameId: number = null
  private deltaSinceLastFrame = 0

  private rwxLoader: any
  private selectionBox: LineSegments
  private controls: boolean[] = Array(9).fill(false)

  private mouse = new Vector2()
  private raycaster = new Raycaster()

  public constructor(private ngZone: NgZone, private userSvc: UserService) {
  }

  public ngOnDestroy(): void {
    if (this.frameId != null) {
      cancelAnimationFrame(this.frameId)
    }
  }

  public createScene(canvas: ElementRef<HTMLCanvasElement>, labelZone: ElementRef<HTMLDivElement>): void {
    this.canvas = canvas.nativeElement
    this.labelZone = labelZone.nativeElement

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,    // transparent background
      antialias: true // smooth edges
    })
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    const loader = new TextureLoader()
    const bgTexture = loader.load(`${RES_PATH}/textures/faesky02right.jpg`)

    this.scene = new Scene()
    this.scene.background = bgTexture

    this.camera = new PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 1000
    )
    this.camera.rotation.order = 'YXZ'
    this.camera.position.z = 0
    this.camera.position.y = 0.2
    this.scene.add(this.camera)

    this.thirdCamera = new PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 1000
    )
    this.thirdCamera.rotation.order = 'YXZ'
    this.thirdCamera.position.z = 0.5
    this.thirdCamera.position.y = 0.2
    this.camera.attach(this.thirdCamera)

    this.activeCamera = this.camera

    this.light = new AmbientLight(0x404040)
    this.light.position.z = 10
    this.scene.add(this.light)

    const floorTexture = loader.load(`${RES_PATH}/textures/terrain17.jpg`)
    floorTexture.wrapS = RepeatWrapping
    floorTexture.wrapT = RepeatWrapping
    floorTexture.repeat.set(128, 128)

    // DoubleSide: render texture on both sides of mesh
    const floorMaterial = new MeshBasicMaterial( { map: floorTexture, side: DoubleSide } )
    const floorGeometry = new PlaneGeometry(100, 100, 1, 1)
    const floor = new Mesh(floorGeometry, floorMaterial)
    floor.position.y = 0
    floor.rotation.x = Math.PI / 2
    this.scene.add(floor)

    const manager = new LoadingManager()
    this.rwxLoader = new RWXLoader(manager)
    this.rwxLoader.setPath(`${RES_PATH}/rwx`).setResourcePath(`${RES_PATH}/textures`).setJSZip(JSZip, JSZipUtils)

    this.avatar = new Mesh()
    this.avatar.name = 'avatar'
    this.avatar.position.copy(new Vector3(0, 0.12, 0))
    this.avatar.rotation.copy(new Euler(0, Math.PI, 0))
    this.camera.attach(this.avatar)
    this.setAvatar('michel.rwx')

    for (const u of this.userSvc.userList) {
      this.addUser(u)
    }

    this.userSvc.listChanged.subscribe(() => {
      for (const user of this.scene.children.filter(o => o.userData?.player)) {
        if (this.userSvc.userList.map(u => u.id).indexOf(user.name) === -1) {
          this.scene.remove(user)
          document.getElementById('label-' + user.name).remove()
        }
      }
      for (const u of this.userSvc.userList) {
        const user = this.scene.children.find(o => o.name === u.id)
        if (user == null) {
          this.addUser(u)
        }
      }
    })

    this.userSvc.avatarChanged.subscribe((u) => {
      const user = this.scene.children.find(o => o.name === u.id)
      this.setAvatar(this.avatarList[u.avatar], user as Mesh)
    })
  }

  setAvatar(name: string, mesh: Mesh = this.avatar) {
    if (!name.endsWith('.rwx')) {
      name += '.rwx'
    }
    this.rwxLoader.load(name, (rwx: Mesh) => {
      mesh.geometry = rwx.geometry
      mesh.material = rwx.material
    })
  }

  createTextLabel(mesh: Mesh) {
    const div = document.createElement('div')
    div.className = 'text-label'
    div.id = 'label-' + mesh.name
    div.style.position = 'absolute'
    div.style.transform = 'translate(-50%, -100%)'
    const user = this.userSvc.userList.find(u => u.id === mesh.name)
    div.innerHTML = user ? user.name : ''
    this.labelZone.appendChild(div)
  }

  public moveUsers() {
    for (const u of this.userSvc.userList.filter(usr => usr.completion < 1)) {
      const user = this.scene.children.find(o => o.name === u.id)
      if (user != null) {
        u.completion = (u.completion + this.deltaSinceLastFrame / 0.2) > 1 ? 1 : u.completion + this.deltaSinceLastFrame / 0.2
        user.position.x = u.oldX + (u.x - u.oldX) * u.completion
        user.position.y = u.oldY + (u.y - u.oldY) * u.completion
        user.position.z = u.oldZ + (u.z - u.oldZ) * u.completion
        user.rotation.x = u.oldRoll + (u.roll - u.oldRoll) * u.completion
        user.rotation.y = u.oldYaw + (u.yaw - u.oldYaw) * u.completion + Math.PI
        user.rotation.z = u.oldPitch + (u.pitch - u.oldPitch) * u.completion
      }
    }
  }

  public getPosition(): [Vector3, Vector3] {
    const p = this.camera.position.clone()
    p.y -= 0.08
    const o = this.camera.rotation.toVector3()
    return [p, o]
  }

  public setWorld(data: any) {
    for (const item of this.scene.children.filter(i => i.name.length > 0 && !i.userData?.player)) {
      this.scene.remove(item)
    }
    for (const item of data.objects) {
      this.loadItem(item[0], new Vector3(item[1], item[2], item[3]))
    }
    this.avatarList = data.avatars
    // Update avatars
    for (const u of this.userSvc.userList) {
      const user = this.scene.children.find(o => o.name === u.id)
      if (user != null) {
        this.setAvatar(this.avatarList[u.avatar], user as Mesh)
      }
    }
  }

  public loadItem(item: string, pos: Vector3) {
    if (!item.endsWith('.rwx')) {
      item += '.rwx'
    }
    this.rwxLoader.load(item, (rwx: Mesh) => {
      const mesh = new Mesh()
      mesh.geometry = rwx.geometry
      mesh.material = rwx.material
      mesh.name = item
      mesh.position.x = pos.x
      mesh.position.y = pos.y
      mesh.position.z = pos.z
      this.scene.add(mesh)
    })
  }

  public select(item: Mesh) {
    if (this.selectionBox == null) {
      const selectMesh = new Mesh(new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial())
      selectMesh.matrixAutoUpdate = false
      selectMesh.visible = false

      const geometry = item.geometry

      if ( geometry.boundingBox === null ) {
        geometry.computeBoundingBox()
      }

      selectMesh.geometry.vertices[0].y = geometry.boundingBox.max.y
      selectMesh.geometry.vertices[0].z = geometry.boundingBox.max.z
      selectMesh.geometry.vertices[1].x = geometry.boundingBox.max.x
      selectMesh.geometry.vertices[1].y = geometry.boundingBox.max.y
      selectMesh.geometry.vertices[1].z = geometry.boundingBox.min.z
      selectMesh.geometry.vertices[2].x = geometry.boundingBox.max.x
      selectMesh.geometry.vertices[2].y = geometry.boundingBox.min.y
      selectMesh.geometry.vertices[2].z = geometry.boundingBox.max.z
      selectMesh.geometry.vertices[3].x = geometry.boundingBox.max.x
      selectMesh.geometry.vertices[3].y = geometry.boundingBox.min.y
      selectMesh.geometry.vertices[3].z = geometry.boundingBox.min.z
      selectMesh.geometry.vertices[4].x = geometry.boundingBox.min.x
      selectMesh.geometry.vertices[4].y = geometry.boundingBox.max.y
      selectMesh.geometry.vertices[0].x = geometry.boundingBox.max.x
      selectMesh.geometry.vertices[4].z = geometry.boundingBox.min.z
      selectMesh.geometry.vertices[5].x = geometry.boundingBox.min.x
      selectMesh.geometry.vertices[5].y = geometry.boundingBox.max.y
      selectMesh.geometry.vertices[5].z = geometry.boundingBox.max.z
      selectMesh.geometry.vertices[6].x = geometry.boundingBox.min.x
      selectMesh.geometry.vertices[6].y = geometry.boundingBox.min.y
      selectMesh.geometry.vertices[6].z = geometry.boundingBox.min.z
      selectMesh.geometry.vertices[7].x = geometry.boundingBox.min.x
      selectMesh.geometry.vertices[7].y = geometry.boundingBox.min.y
      selectMesh.geometry.vertices[7].z = geometry.boundingBox.max.z
      selectMesh.geometry.computeBoundingSphere()
      selectMesh.geometry.verticesNeedUpdate = true
      selectMesh.matrixWorld.copy(item.matrixWorld)

      const edges = new EdgesGeometry(selectMesh.geometry)

      selectMesh.geometry.dispose()
      selectMesh.material.dispose()

      this.selectionBox = new LineSegments(edges, new LineBasicMaterial( { color: 0xffff00, depthTest: false } ))
      edges.dispose()
      item.add(this.selectionBox)

    } else {
      this.selectionBox.visible = false
      this.selectionBox.geometry.dispose()
      this.scene.remove(this.selectionBox)
      this.selectionBox = null
    }
  }

  public animate(): void {
    // We have to run this outside angular zones,
    // because it could trigger heavy changeDetection cycles.
    this.ngZone.runOutsideAngular(() => {
      this.clock = new Clock(true)
      if (document.readyState !== 'loading') {
        this.render()
      } else {
        window.addEventListener('DOMContentLoaded', () => {
          this.render()
        })
      }
      window.addEventListener('resize', () => {
        this.resize()
      })
      this.canvas.addEventListener('contextmenu', (e) => {
        this.rightClick(e)
      })
      window.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).nodeName === 'BODY') {
          this.handleKeys(e.key, true)
          e.preventDefault()
        }
      })
      window.addEventListener('keyup', (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).nodeName === 'BODY') {
          this.handleKeys(e.key, false)
          e.preventDefault()
        }
      })
    })
  }

  public moveLabels() {
    for (const user of this.scene.children.filter(o => o.userData?.player)) {
      const pos = new Vector3()
      pos.copy(user.position)
      pos.y += 0.12
      const vector = pos.project(this.activeCamera)
      vector.x = (vector.x + 1)/2 * window.innerWidth
      vector.y = -(vector.y - 1)/2 * window.innerHeight
      const div = document.getElementById('label-' + user.name)
      if (div != null && vector.z < 1) {
        div.style.left = vector.x + 'px'
        div.style.top = vector.y + 'px'
      }
      div.style.visibility = vector.z < 1 ? 'visible' : 'hidden'
    }
  }

  public toggleCamera() {
    this.activeCamera = this.activeCamera === this.camera ? this.thirdCamera : this.camera
  }

  public render(): void {
    this.frameId = requestAnimationFrame(() => {
      this.render()
    })
    this.deltaSinceLastFrame = this.clock.getDelta()

    const tractor = this.scene.children.find(o => o.name === 'tracteur1.rwx')
    if (tractor) {
      tractor.rotation.y += 0.01
      const d = new Vector3()
      tractor.getWorldDirection(d)
      tractor.position.addScaledVector(d, -0.005)
    }

    this.moveCamera()
    this.moveUsers()
    this.moveLabels()
    this.raycaster.setFromCamera(this.mouse, this.activeCamera)
    this.renderer.render(this.scene, this.activeCamera)
  }

  public resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(width, height)
  }

  public rightClick(event) {
    event.preventDefault()

    this.mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1
    this.mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1
    const intersects = this.raycaster.intersectObjects(this.scene.children)
    for (const o of intersects) {
      if (o.object.name.length) {
        this.select(o.object as Mesh)
      }
    }
  }

  private handleKeys(k: string, value: boolean) {
    switch (k) {
      case 'ArrowUp': {
        this.controls[PressedKey.up] = value
        break
      }
      case 'ArrowDown': {
        this.controls[PressedKey.down] = value
        break
      }
      case 'ArrowLeft': {
        this.controls[PressedKey.left] = value
        break
      }
      case 'ArrowRight': {
        this.controls[PressedKey.right] = value
        break
      }
      case 'PageUp': {
        this.controls[PressedKey.pgUp] = value
        break
      }
      case 'PageDown': {
        this.controls[PressedKey.pgDown] = value
        break
      }
      case '+': {
        this.controls[PressedKey.plus] = value
        break
      }
      case '-': {
        this.controls[PressedKey.minus] = value
        break
      }
      case 'Control': {
        this.controls[PressedKey.ctrl] = value
        break
      }
      case 'Shift': {
        this.controls[PressedKey.shift] = value
        break
      }
      default: {
         break
      }
    }
  }

  private moveCamera() {
    const cameraDirection = new Vector3()
    this.camera.getWorldDirection(cameraDirection)
    if (this.controls[PressedKey.up]) {
      this.camera.position.addScaledVector(cameraDirection, 0.1)
    }
    if (this.controls[PressedKey.down]) {
      this.camera.position.addScaledVector(cameraDirection, -0.1)
    }
    if (this.controls[PressedKey.left]) {
      this.camera.rotation.y += 0.1
      if (this.camera.rotation.y > Math.PI) {
        this.camera.rotation.y -= 2 * Math.PI
      }
    }
    if (this.controls[PressedKey.right]) {
      this.camera.rotation.y -= 0.1
      if (this.camera.rotation.y < -Math.PI) {
        this.camera.rotation.y += 2 * Math.PI
      }
    }
    if (this.controls[PressedKey.pgUp]) {
      if (this.camera.rotation.x < Math.PI / 2) {
        this.camera.rotation.x += 0.1
      }
    }
    if (this.controls[PressedKey.pgDown]) {
      if (this.camera.rotation.x > -Math.PI / 2) {
        this.camera.rotation.x -= 0.1
      }
    }
    if (this.controls[PressedKey.plus]) {
      this.camera.position.y += 0.1
    }
    if (this.controls[PressedKey.minus]) {
      this.camera.position.y -= 0.1
    }
  }

  private addUser(u: User) {
    if (u.name !== this.userSvc.currentName) {
      let avatar = this.avatarList[u.avatar] || 'michel'
      if (!avatar.endsWith('.rwx')) {
        avatar += '.rwx'
      }
      this.rwxLoader.load(avatar, (rwx: Mesh) => {
        const mesh = new Mesh()
        mesh.geometry = rwx.geometry
        mesh.material = rwx.material
        mesh.name = u.id
        mesh.position.x = u.x
        mesh.position.y = u.y
        mesh.position.z = u.z
        mesh.rotation.x = u.roll
        mesh.rotation.y = u.yaw + Math.PI
        mesh.rotation.z = u.pitch
        mesh.userData.player = true
        this.scene.add(mesh)
        this.createTextLabel(mesh)
      })
    }
  }
}
