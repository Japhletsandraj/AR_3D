import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// Simple 2D AR: a flat image that always faces the viewer (billboard sprite).
const IMAGE_URL = 'assets/mushroom-house.jpeg';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0, 1.5, 3);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb, 1); // sky-blue background, visible while no camera feed is composited (AR) or in preview mode
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const hint = document.getElementById('hint');
function showMessage(message) {
  hint.style.display = 'block';
  hint.textContent = message;
}

window.addEventListener('error', (e) => showMessage('Error: ' + e.message));

document.body.appendChild(
  ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.getElementById('ui') },
  })
);

const previewButton = document.createElement('button');
previewButton.id = 'preview-btn';
previewButton.textContent = 'Preview Mode (no camera)';
Object.assign(previewButton.style, {
  position: 'fixed',
  bottom: '24px',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 16px',
  borderRadius: '8px',
  border: 'none',
  background: '#ffffffdd',
  pointerEvents: 'auto',
});
document.getElementById('ui').appendChild(previewButton);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x00ff88 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const groundGrid = new THREE.GridHelper(10, 20);
groundGrid.visible = false;
scene.add(groundGrid);

const texture = new THREE.TextureLoader().load(IMAGE_URL, undefined, undefined, (err) =>
  showMessage('Image load failed: ' + err.message)
);
const spriteMaterial = new THREE.SpriteMaterial({ map: texture });

let placedImage = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let previewMode = false;

const joystickInput = { x: 0, y: 0 };
nipplejs
  .create({ zone: document.getElementById('joystick-zone'), mode: 'static', position: { left: '50%', top: '50%' } })
  .on('move', (evt, data) => {
    const rad = data.angle.radian;
    joystickInput.x = Math.cos(rad) * data.force;
    joystickInput.y = Math.sin(rad) * data.force;
  })
  .on('end', () => {
    joystickInput.x = 0;
    joystickInput.y = 0;
  });

function placeImage(position) {
  if (placedImage) scene.remove(placedImage);
  placedImage = new THREE.Sprite(spriteMaterial);
  placedImage.scale.set(0.4, 0.5, 1);
  placedImage.position.copy(position);
  scene.add(placedImage);
  hint.style.display = 'none';
}

// --- AR (camera passthrough) mode ---

renderer.xr.addEventListener('sessionstart', () => {
  const session = renderer.xr.getSession();
  session.addEventListener('select', () => {
    if (!reticle.visible) return;
    placeImage(new THREE.Vector3().setFromMatrixPosition(reticle.matrix));
  });
});

// --- Preview mode (virtual ground plane, no camera) ---

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const previewHitPoint = new THREE.Vector3();

previewButton.addEventListener('click', () => {
  previewMode = true;
  previewButton.style.display = 'none';
  groundGrid.visible = true;
  showMessage('Tap the ground to place the mushroom house');
});

function onPreviewTap(clientX, clientY) {
  if (!previewMode) return;

  pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);

  if (raycaster.ray.intersectPlane(groundPlane, previewHitPoint)) {
    placeImage(previewHitPoint);
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => onPreviewTap(e.clientX, e.clientY));

// --- Joystick drives the placed image around ---

const moveSpeed = 0.5;

function driveImage(deltaSeconds) {
  if (!placedImage) return;
  placedImage.position.x += joystickInput.x * moveSpeed * deltaSeconds;
  placedImage.position.z -= joystickInput.y * moveSpeed * deltaSeconds;
}

const clock = new THREE.Clock();

renderer.setAnimationLoop((timestamp, frame) => {
  const delta = clock.getDelta();

  if (frame && !previewMode) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0 && !placedImage) {
        const pose = hitTestResults[0].getPose(referenceSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  driveImage(delta);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

