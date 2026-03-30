import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { getColor } from './colormap';
import { createShape } from './ShapeFactory';

// D: Emissive factor — adds self-glow proportional to object color for vibrancy.
const EMISSIVE_FACTOR = 0.25;

export default class ThreeDManager {
  constructor(container, onSelectionChange) {
    this.container = container;
    this.onSelectionChange = onSelectionChange;
    this.activeGroupId = null;
    this.diameterScales = new Map();
    this.clock = new THREE.Clock(); // For smooth animation
    this.isAutoRotating = false;
    this.autoRotateSpeedRads = 0;

    // --- NEW: State for world rotation ---
    this.baseWorldRotation = new THREE.Euler(0, 0, 0);
    this.isWorldFlipped = false;
    // --- END NEW ---

    this.scene = new THREE.Scene();
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 1e-9, 1e3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,   // Pan with left-click
      MIDDLE: THREE.MOUSE.DOLLY, // Zoom with middle-click
      RIGHT: THREE.MOUSE.ROTATE  // Orbit with right-click
    };

    this.controls.minPolarAngle = 0; // 0 degrees
    this.controls.maxPolarAngle = Math.PI; // 180 degrees
    this.controls.autoRotate = false; // We will handle rotation manually

    this.boundingBox = new THREE.Box3();
    this.sceneObjects = [];
    this.entityConfigs = new Map();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Lighting: VPython directions, boosted ambient and fill for more brightness.
    // A: Ambient at 0x5d5d5d (37%) — midpoint between original 20% and boosted 53%.
    this.world.add(new THREE.AmbientLight(0x5d5d5d));

    // Main light (direction <0.22, 0.44, 0.88>, 80% gray)
    const light1 = new THREE.DirectionalLight(0xcccccc, 1.0);
    light1.position.set(0.22, 0.44, 0.88).normalize();
    this.world.add(light1);

    // B: Fill light at 0x737373 (45%) — midpoint between original 30% and boosted 60%.
    const light2 = new THREE.DirectionalLight(0x737373, 1.0);
    light2.position.set(-0.88, -0.22, -0.44).normalize();
    this.world.add(light2);

    this.onWindowResize = this.onWindowResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleClick = this.handleClick.bind(this);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.handleKeyDown);
    this.renderer.domElement.addEventListener('click', this.handleClick);

    this.animate();
  }
  
  getBoundingBoxSize() {
    const size = new THREE.Vector3();
    this.boundingBox.getSize(size);
    return { x: size.x, y: size.y, z: size.z };
  }

  setActiveGroupId(groupId) {
    this.activeGroupId = groupId;
  }

  setAutoRotate(speedState) {
    switch (speedState) {
        case 1:
            this.isAutoRotating = true;
            this.autoRotateSpeedRads = 4 * Math.PI / 180; // 4 deg/sec
            break;
        case 2:
            this.isAutoRotating = true;
            this.autoRotateSpeedRads = 12 * (Math.PI / 180); // 12 deg/sec
            break;
        case 0:
        default:
            this.isAutoRotating = false;
            this.autoRotateSpeedRads = 0;
            break;
    }
  }

  setReflectivity(isEnabled) {
    // --- UPDATED REFLECTIVITY ---
    // Instead of metalness (which makes things dark without an environment map),
    // we use low roughness to create a "shiny plastic" look, similar to VPython's default shininess.
    const metalness = 0.0; 
    const roughness = isEnabled ? 0.2 : 0.8; // 0.2 = shiny/glossy, 0.8 = matte
    
    this.sceneObjects.forEach(obj => {
        if (obj.material) {
            obj.material.metalness = metalness;
            obj.material.roughness = roughness;
            obj.material.needsUpdate = true;
        }
    });
  }
  
  /**
   * --- MODIFIED: Sets the *base* world rotation ---
   * @param {string} axis - 'x', 'y', or 'z'
   */
  setVerticalAxis(axis) {
    switch (axis) {
        case 'x':
            this.baseWorldRotation.set(0, 0, Math.PI / 2); // Rotate world so X is up
            break;
        case 'z':
            this.baseWorldRotation.set(-Math.PI / 2, 0, 0); // Rotate world so Z is up
            break;
        case 'y':
        default:
            this.baseWorldRotation.set(0, 0, 0); // Default Y-up
            break;
    }
    this.applyWorldRotation();
    this.focusCamera();
  }

  // --- NEW: Toggle for flipping the world ---
  setWorldFlip(isFlipped) {
    this.isWorldFlipped = isFlipped;
    this.applyWorldRotation();
    // No focusCamera here, as it's jarring.
  }

  // --- NEW: Helper to combine base and flip rotations ---
  applyWorldRotation() {
    this.world.rotation.copy(this.baseWorldRotation);
    if (this.isWorldFlipped) {
      // Apply a 180-degree flip around the world's X-axis
      this.world.rotation.x += Math.PI; 
    }
    this.world.updateMatrixWorld(true);
  }

  buildScene(config) {
    if (!config || !config.drawables) {
        return;
    }

    // --- NEW: Reset rotation states on build ---
    this.baseWorldRotation.set(0, 0, 0);
    this.isWorldFlipped = false;
    this.applyWorldRotation();
    // --- END NEW ---

    this.sceneObjects = [];
    this.entityConfigs.clear();
    this.diameterScales.clear();

    // Remove existing children but keep the first 3 (Ambient + 2 Directional Lights)
    while(this.world.children.length > 3){ 
        const child = this.world.children[3];
        this.world.remove(child);
        if(child.geometry) child.geometry.dispose();
        if(child.material) child.material.dispose();
    }

    this.renderer.setClearColor(new THREE.Color(config.bg === 'default' ? '#FFFFFF' : config.bg || '#FFFFFF'));
    this.boundingBox.makeEmpty();

    config.drawables.forEach(entity => {
      this.entityConfigs.set(entity.groupId, {
          title: entity.title, vmin: entity.vmin, vmax: entity.vmax,
          colormap: config.colormap, transparency: entity.transparency || 1.0
      });
      const initialScale = entity.diaScale ?? 1.0;
      this.diameterScales.set(entity.groupId, initialScale);
      
      entity.shape.forEach((primitive, i) => {
        const normalizedValue = (primitive.value - entity.vmin) / (entity.vmax - entity.vmin);
        const materialColor = getColor(normalizedValue, config.colormap, true);
        
        // Default to Matte (roughness 0.8) initially
        const emissiveColor = new THREE.Color(materialColor).multiplyScalar(EMISSIVE_FACTOR);
        const material = new THREE.MeshStandardMaterial({
            color: materialColor,
            emissive: emissiveColor,
            transparent: true,
            opacity: entity.transparency || 1.0,
            metalness: 0.0,
            roughness: 0.8,
        });

        const shapeObject = createShape(primitive, material);

        if (shapeObject) {
            shapeObject.userData = { 
                entityName: entity.groupId, 
				shapeIndex: i, 
				originalValue: primitive.value,
                originalPosition: shapeObject.position.clone(),
                simPath: primitive.simPath,
            };

            if (shapeObject.type === 'Mesh') {
                if (shapeObject.geometry.type === 'SphereGeometry') {
                    shapeObject.scale.set(initialScale, initialScale, initialScale);
                } else if (shapeObject.geometry.type === 'CylinderGeometry' || shapeObject.geometry.type === 'ConeGeometry') {
                    shapeObject.scale.set(initialScale, 1, initialScale);
                }
            }
            
            this.world.add(shapeObject);
            this.sceneObjects.push(shapeObject);
            this.boundingBox.expandByObject(shapeObject);
        }
      });
    });
    this.focusCamera();
    setTimeout(() => this.onWindowResize(), 0);
  }

  applyExplodeView(isExploded, offset, drawableOrder) {
    if (this.sceneObjects.length === 0) return;
    const offsetVector = new THREE.Vector3(
        parseFloat(offset.x) || 0, parseFloat(offset.y) || 0, parseFloat(offset.z) || 0
    );
    this.sceneObjects.forEach(obj => {
        if (!obj.userData.originalPosition) return;
        if (!isExploded) {
            obj.position.copy(obj.userData.originalPosition);
        } else {
            const drawableIndex = drawableOrder.indexOf(obj.userData.entityName);
            if (drawableIndex !== -1) {
                const cumulativeOffset = offsetVector.clone().multiplyScalar(drawableIndex);
                obj.position.copy(obj.userData.originalPosition).add(cumulativeOffset);
            }
        }
    });
  }

  setDrawableVisibility(visibilityMap) {
      this.sceneObjects.forEach(obj => {
          const groupId = obj.userData.entityName;
          if (visibilityMap.hasOwnProperty(groupId)) {
              obj.visible = visibilityMap[groupId];
          }
      });
  }

  updateColorRange(groupId, newRange) {
    const config = this.entityConfigs.get(groupId);
    if (config) {
        config.vmin = newRange.vmin;
        config.vmax = newRange.vmax;
        this.entityConfigs.set(groupId, config);
        this.redrawColors();
    }
  }

  redrawColors() {
    this.sceneObjects.forEach(obj => {
        const config = this.entityConfigs.get(obj.userData.entityName);
        if (config) {
            const normalizedValue = (obj.userData.originalValue - config.vmin) / (config.vmax - config.vmin);
            const newColor = getColor(normalizedValue, config.colormap, true);
            if (obj.material) {
                obj.material.color.set(newColor);
                obj.material.emissive.set(newColor).multiplyScalar(EMISSIVE_FACTOR);
            }
        }
    });
  }

  updateSceneData(frameData) {
    const { groupId, data } = frameData;
    const entityConfig = this.entityConfigs.get(groupId);
    if (!entityConfig) { return; }
    const { vmin, vmax, colormap } = entityConfig;
    const relevantObjects = this.sceneObjects.filter(obj => obj.userData.entityName === groupId);
    data.forEach((value, index) => {
        if (index < relevantObjects.length) {
            const obj = relevantObjects[index];
            const normalizedValue = (value - vmin) / (vmax - vmin);
            const newColor = getColor(normalizedValue, colormap, true);
            if (obj.material) {
                obj.material.color.set(newColor);
                obj.material.emissive.set(newColor).multiplyScalar(EMISSIVE_FACTOR);
            }
        }
    });
  }

  // --- MODIFIED handleClick (FIX for Request 3) ---
  handleClick(event) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.world.children, true);

      if (intersects.length > 0) {
          // let clickedObject = intersects[0].object;
		  let firstVisibleIntersect = null;
          for (const intersect of intersects) {
              // We must check the material property exists and opacity is greater than 0.
              if (intersect.object.material && intersect.object.material.opacity > 0.0) {
                  firstVisibleIntersect = intersect;
                  break; // We found the closest visible object
              }
          }

          // If we only clicked on transparent objects, do nothing.
          if (!firstVisibleIntersect) {
              return;
          }

          let clickedObject = firstVisibleIntersect.object;

          // --- NEW LOGIC ---
          // Traverse up the hierarchy until we find a direct child of the world.
          // This is the "shapeObject" that we added in buildScene.
          while (clickedObject.parent && clickedObject.parent !== this.world) {
              clickedObject = clickedObject.parent;
          }
          // At this point, clickedObject is the top-level object for that shape.
          // *Now* we check its userData.
          // --- END NEW LOGIC ---

          const userData = clickedObject.userData;

          if (this.onSelectionChange && userData && userData.simPath) {
              this.onSelectionChange(userData, event.ctrlKey);
          }
      }
  }
  // --- END MODIFIED handleClick ---

  updateSelectionVisuals(clickSelected) {
    const isSelected = (obj) => {
        return clickSelected.some(sel =>
            sel.entityName === obj.userData.entityName && sel.shapeIndex === obj.userData.shapeIndex
        );
    };
    this.sceneObjects.forEach(obj => {
        const config = this.entityConfigs.get(obj.userData.entityName);
        if (config) {
            const normalizedValue = isSelected(obj) ? 1.0 : (obj.userData.originalValue - config.vmin) / (config.vmax - config.vmin);
            const newColor = getColor(normalizedValue, config.colormap, true);
            if (obj.material) {
                obj.material.color.set(newColor);
                obj.material.emissive.set(newColor).multiplyScalar(EMISSIVE_FACTOR);
                obj.material.needsUpdate = true;
            }
        }
    });
  }

  handleKeyDown(event) {
    if (event.target.tagName.toLowerCase() === 'input' || event.target.tagName.toLowerCase() === 'textarea') return;
    const rotateSpeed = 0.05;
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const forward = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 2);
    switch(event.key) {
        case 'r': this.camera.up.applyAxisAngle(forward, rotateSpeed); break;
        case 'R': this.camera.up.applyAxisAngle(forward, -rotateSpeed); break;
        case 'p': offset.applyAxisAngle(right, rotateSpeed); break;
        case 'P': offset.applyAxisAngle(right, -rotateSpeed); break;
        case 'y': offset.applyAxisAngle(up, rotateSpeed); break;
        case 'Y': offset.applyAxisAngle(up, -rotateSpeed); break;
        case ',': case '<': offset.multiplyScalar(1.05); break;
        case '.': case '>': offset.multiplyScalar(0.95); break;
        case 'ArrowUp': {
            event.preventDefault();
            const panOffset = up.clone().multiplyScalar(this.camera.position.distanceTo(this.controls.target) * 0.05);
            this.camera.position.sub(panOffset); this.controls.target.sub(panOffset); break;
        }
        case 'ArrowDown': {
            event.preventDefault();
            const panOffset = up.clone().multiplyScalar(this.camera.position.distanceTo(this.controls.target) * 0.05);
            this.camera.position.add(panOffset); this.controls.target.add(panOffset); break;
        }
        case 'ArrowLeft': {
            event.preventDefault();
            const panOffset = right.clone().multiplyScalar(this.camera.position.distanceTo(this.controls.target) * 0.05);
            this.camera.position.add(panOffset); this.controls.target.add(panOffset); break;
        }
        case 'ArrowRight': {
            event.preventDefault();
            const panOffset = right.clone().multiplyScalar(this.camera.position.distanceTo(this.controls.target) * 0.05);
            this.camera.position.sub(panOffset); this.controls.target.sub(panOffset); break;
        }
        case 'a': this.focusCamera(); return;
        case 'd': this.updateDiameterScale(this.activeGroupId, 0.9); break;
        case 'D': this.updateDiameterScale(this.activeGroupId, 1.1); break;
        default: return;
    }
    this.camera.position.copy(this.controls.target).add(offset);
  }

  updateDiameterScale(targetGroupId, factor) {
      if (!targetGroupId) return;
      const currentScale = this.diameterScales.get(targetGroupId) || 1.0;
      const newScale = currentScale * factor;
      this.diameterScales.set(targetGroupId, newScale);
      
      this.sceneObjects.forEach(obj => {
          if (obj.userData.entityName === targetGroupId && obj.type === 'Mesh') {
              if (obj.geometry.type === 'SphereGeometry') {
                  obj.scale.set(newScale, newScale, newScale);
              } else if (obj.geometry.type === 'CylinderGeometry') {
                  obj.scale.set(newScale, 1, newScale);
              }
          }
      });
  }

  focusCamera() {
    if (this.boundingBox.isEmpty()) return;

    // --- MODIFIED: Use world-space bounding box ---
    // We need the bounding box *after* the world rotation has been applied.
    const worldBox = new THREE.Box3();
    this.world.updateWorldMatrix(true, true); // Ensure matrix is fresh
    worldBox.copy(this.boundingBox).applyMatrix4(this.world.matrixWorld);
    // --- END MODIFIED ---

    const center = worldBox.getCenter(new THREE.Vector3());
    const size = worldBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const cameraDistance = Math.abs(maxDim / 1.5 / Math.tan(fov / 2));
    
    // --- MODIFIED: Simplified camera positioning ---
    // We *always* use the Y-up camera logic now.
    this.camera.position.copy(center);
    this.camera.position.z += cameraDistance; // Always look from "front"
    this.camera.up.set(0, 1, 0); // Always Y-up
    // --- END MODIFIED ---

    this.controls.target.copy(center);
    this.camera.near = cameraDistance / 100;
    this.camera.far = cameraDistance * 100;
    this.camera.updateProjectionMatrix();
    
    this.controls.update(); // Sync controls with new camera settings
  }

  onWindowResize() {
    if (!this.container || this.container.clientWidth === 0) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    
    const delta = this.clock.getDelta();

    // --- MANUAL AUTO-ROTATE ---
    if (this.isAutoRotating && this.autoRotateSpeedRads > 0) {
        // We *always* rotate around the world Y-axis, which is always "up"
        // for the camera. This will correctly rotate the scene group.
        const axis = new THREE.Vector3(0, 1, 0); 
        
        const angle = this.autoRotateSpeedRads * delta;
        // Rotate the camera's position vector around the target
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        offset.applyAxisAngle(axis, angle);
        this.camera.position.copy(this.controls.target).add(offset);
    }
    // --- END MANUAL AUTO-ROTATE ---

    const canvas = this.renderer.domElement;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
        this.onWindowResize();
    }
    
    this.controls.update(delta); // Pass delta to controls
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    if(this.container && this.renderer.domElement) {
        this.container.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
