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

// Moves the marker-anchored image within the marker's own plane using joystick input.
AFRAME.registerComponent('house-joystick-drive', {
  tick(time, delta) {
    const seconds = delta / 1000;
    const moveSpeed = 0.6;
    const position = this.el.object3D.position;
    position.x += joystickInput.x * moveSpeed * seconds;
    position.z -= joystickInput.y * moveSpeed * seconds;
  },
});
