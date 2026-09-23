import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Add more .glb paths here to enable Prev/Next model swapping.
const CAR_URLS = [
  'assets/Barn.glb',
  'assets/Big Barn.glb',
  'assets/ChickenCoop.glb',
  'assets/Fence.glb',
  'assets/Fence-e02PFKKhbr.glb',
  'assets/Open Barn.glb',
  'assets/Silo House.glb',
  'assets/Silo.glb',
  'assets/Small Barn.glb',
  'assets/Tower Windmill.glb',
];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0, 2, 4);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb, 1); // sky-blue background, visible while no camera feed is composited (AR) or in preview mode
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const directional = new THREE.DirectionalLight(0xffffff, 1.5);
directional.position.set(1, 3, 2);
scene.add(directional);

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

const loader = new GLTFLoader();
const carModels = [];
let currentCarIndex = 0;
let placedCar = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let previewMode = false;

Promise.all(
  CAR_URLS.map(
    (url) =>
      new Promise((resolve, reject) =>
        loader.load(encodeURI(url), (gltf) => resolve(gltf.scene), undefined, reject)
      )
  )
)
  .then((models) => carModels.push(...models))
  .catch((err) => showMessage('Model load failed: ' + err.message));

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

function placeCar(index, matrix) {
  if (placedCar) scene.remove(placedCar);
  currentCarIndex = index;
  placedCar = carModels[index].clone();
  placedCar.matrixAutoUpdate = false;
  placedCar.matrix.copy(matrix);
  scene.add(placedCar);
  hint.style.display = 'none';
}

document.getElementById('next-btn').addEventListener('click', () => {
  if (!placedCar || carModels.length === 0) return;
  placeCar((currentCarIndex + 1) % carModels.length, placedCar.matrix);
});

document.getElementById('prev-btn').addEventListener('click', () => {
  if (!placedCar || carModels.length === 0) return;
  placeCar((currentCarIndex - 1 + carModels.length) % carModels.length, placedCar.matrix);
});

// --- AR (camera passthrough) mode ---

renderer.xr.addEventListener('sessionstart', () => {
  const session = renderer.xr.getSession();
  session.addEventListener('select', () => {
    if (!reticle.visible || placedCar || carModels.length === 0) return;
    placeCar(currentCarIndex, reticle.matrix);
  });
});

// --- Preview mode (virtual ground plane, no camera) ---

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const previewHitPoint = new THREE.Vector3();

previewButton.addEventListener('click', () => {
  if (carModels.length === 0) {
    showMessage('Still loading models, try again in a second...');
    return;
  }
  previewMode = true;
  previewButton.style.display = 'none';
  groundGrid.visible = true;
  showMessage('Tap the ground to place the building');
});

function onPreviewTap(clientX, clientY) {
  if (!previewMode || placedCar || carModels.length === 0) return;

  pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);

  if (raycaster.ray.intersectPlane(groundPlane, previewHitPoint)) {
    const matrix = new THREE.Matrix4().setPosition(previewHitPoint);
    placeCar(currentCarIndex, matrix);
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => onPreviewTap(e.clientX, e.clientY));

// --- Shared driving logic ---

const moveSpeed = 0.5;
const turnSpeed = 1.2;
const carPosition = new THREE.Vector3();
const carQuaternion = new THREE.Quaternion();
const carScale = new THREE.Vector3();

function driveCar(deltaSeconds) {
  if (!placedCar) return;

  placedCar.matrix.decompose(carPosition, carQuaternion, carScale);
  carQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -joystickInput.x * turnSpeed * deltaSeconds));

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(carQuaternion);
  carPosition.addScaledVector(forward, joystickInput.y * moveSpeed * deltaSeconds);

  placedCar.matrix.compose(carPosition, carQuaternion, carScale);
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
      if (hitTestResults.length > 0 && !placedCar) {
        const pose = hitTestResults[0].getPose(referenceSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  driveCar(delta);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
