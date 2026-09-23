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

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const directional = new THREE.DirectionalLight(0xffffff, 1.5);
directional.position.set(1, 3, 2);
scene.add(directional);

document.body.appendChild(
  ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] })
);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x00ff88 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const loader = new GLTFLoader();
const carModels = [];
let currentCarIndex = 0;
let placedCar = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

Promise.all(
  CAR_URLS.map(
    (url) => new Promise((resolve, reject) => loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject))
  )
).then((models) => carModels.push(...models));

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
}

document.getElementById('next-btn').addEventListener('click', () => {
  if (!placedCar || carModels.length === 0) return;
  placeCar((currentCarIndex + 1) % carModels.length, placedCar.matrix);
});

document.getElementById('prev-btn').addEventListener('click', () => {
  if (!placedCar || carModels.length === 0) return;
  placeCar((currentCarIndex - 1 + carModels.length) % carModels.length, placedCar.matrix);
});

renderer.xr.addEventListener('sessionstart', () => {
  const session = renderer.xr.getSession();
  session.addEventListener('select', () => {
    if (!reticle.visible || placedCar || carModels.length === 0) return;
    placeCar(currentCarIndex, reticle.matrix);
    document.getElementById('hint').style.display = 'none';
  });
});

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

  if (frame) {
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
