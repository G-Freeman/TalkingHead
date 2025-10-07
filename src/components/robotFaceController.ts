import {
        CanvasTexture,
        DoubleSide,
        MathUtils,
        Mesh,
        MeshBasicMaterial,
        Object3D,
        SRGBColorSpace,
        Vector2
} from 'three';

export interface RobotFaceController {
        update(delta: number): void;
        dispose(): void;
}

interface EmotionPreset {
        scale: number;
        tilt: number;
        brightness: number;
        verticalBias: number;
}

const EMOTIONS: readonly EmotionPreset[] = [
        { scale: 1, tilt: 0, brightness: 1, verticalBias: 0 },
        { scale: 0.85, tilt: 0.18, brightness: 1.15, verticalBias: 0.06 },
        { scale: 1.12, tilt: -0.12, brightness: 1.05, verticalBias: -0.04 },
        { scale: 0.9, tilt: 0.05, brightness: 0.92, verticalBias: 0.02 }
];

const easeInOut = (t: number) => t * t * (3 - 2 * t);

const randomRange = (min: number, max: number) => MathUtils.lerp(min, max, Math.random());

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;

const FACE_MATCHER = /face/i;

interface RobotFaceState {
        readonly canvas: HTMLCanvasElement;
        readonly texture: CanvasTexture;
        readonly material: MeshBasicMaterial;
        readonly lookCurrent: Vector2;
        readonly lookTarget: Vector2;
        blinkTimer: number;
        blinkState: 'idle' | 'closing' | 'opening';
        blinkProgress: number;
        blinkAmount: number;
        lookSwitchTimer: number;
        emotionTimer: number;
        scaleCurrent: number;
        scaleTarget: number;
        tiltCurrent: number;
        tiltTarget: number;
        brightnessCurrent: number;
        brightnessTarget: number;
        verticalBiasCurrent: number;
        verticalBiasTarget: number;
        needsRedraw: boolean;
}

const drawEye = (
        ctx: CanvasRenderingContext2D,
        side: number,
        look: Vector2,
        blink: number,
        tilt: number,
        scale: number,
        brightness: number,
        verticalBias: number
) => {
        const width = CANVAS_WIDTH;
        const height = CANVAS_HEIGHT;
        const baseCenterX = width * (0.5 + side * 0.19);
        const baseCenterY = height * (0.52 + verticalBias * 0.6);
        const offsetX = look.x * width * 0.075;
        const offsetY = look.y * height * 0.12;
        const centerX = baseCenterX + offsetX;
        const centerY = baseCenterY + offsetY;
        const blinkScale = 1 - blink * 0.92;
        const widthScale = 1 + Math.abs(look.x * 0.22 * side);
        const eyeWidth = width * 0.21 * scale * widthScale;
        const eyeHeight = Math.max(height * 0.48 * scale * blinkScale, height * 0.05);
        const rotation = tilt * -side;
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(rotation);
        ctx.shadowColor = `rgba(120, 240, 255, ${0.45 * brightness})`;
        ctx.shadowBlur = width * 0.04;
        const gradient = ctx.createLinearGradient(0, -eyeHeight, 0, eyeHeight);
        gradient.addColorStop(0, `rgba(140, 250, 255, ${0.25 + brightness * 0.05})`);
        gradient.addColorStop(0.5, `rgba(70, 210, 255, ${0.8 + brightness * 0.15})`);
        gradient.addColorStop(1, `rgba(30, 160, 255, ${0.75 + brightness * 0.15})`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, eyeWidth, eyeHeight, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = width * 0.02;
        ctx.shadowColor = `rgba(200, 255, 255, ${0.35 * brightness})`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + brightness * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(
                -eyeWidth * 0.25 + look.x * width * 0.012,
                -eyeHeight * 0.22,
                eyeWidth * 0.32,
                eyeHeight * 0.35,
                0,
                0,
                Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
};

const drawFace = (state: RobotFaceState) => {
        const ctx = state.canvas.getContext('2d');
        if (!ctx) {
                return;
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#020409';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.strokeStyle = 'rgba(30, 40, 70, 0.6)';
        ctx.lineWidth = CANVAS_HEIGHT * 0.08;
        ctx.strokeRect(
                ctx.lineWidth * 0.5,
                ctx.lineWidth * 0.5,
                CANVAS_WIDTH - ctx.lineWidth,
                CANVAS_HEIGHT - ctx.lineWidth
        );
        drawEye(
                ctx,
                -1,
                state.lookCurrent,
                state.blinkAmount,
                state.tiltCurrent,
                state.scaleCurrent,
                state.brightnessCurrent,
                state.verticalBiasCurrent
        );
        drawEye(
                ctx,
                1,
                state.lookCurrent,
                state.blinkAmount,
                state.tiltCurrent,
                state.scaleCurrent,
                state.brightnessCurrent,
                state.verticalBiasCurrent
        );
        ctx.restore();
        state.texture.needsUpdate = true;
        state.needsRedraw = false;
};

const createRobotFaceState = (mesh: Mesh): RobotFaceState | null => {
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;
        const context = canvas.getContext('2d');
        if (!context) {
                return null;
        }
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = false;
        const material = new MeshBasicMaterial({
                map: texture,
                transparent: false,
                toneMapped: false
        });
        material.side = DoubleSide;
        material.name = 'DynamicFace';
        const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of previous) {
                if (mat) {
                        mat.dispose();
                }
        }
        mesh.material = material;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 2;
        const state: RobotFaceState = {
                canvas,
                texture,
                material,
                lookCurrent: new Vector2(0, 0),
                lookTarget: new Vector2(0, 0),
                blinkTimer: randomRange(1.8, 4.5),
                blinkState: 'idle',
                blinkProgress: 0,
                blinkAmount: 0,
                lookSwitchTimer: randomRange(1.2, 2.6),
                emotionTimer: randomRange(3.5, 6.5),
                scaleCurrent: 1,
                scaleTarget: 1,
                tiltCurrent: 0,
                tiltTarget: 0,
                brightnessCurrent: 1,
                brightnessTarget: 1,
                verticalBiasCurrent: 0,
                verticalBiasTarget: 0,
                needsRedraw: true
        };
        drawFace(state);
        return state;
};

const updateRobotFaceState = (state: RobotFaceState, delta: number) => {
        let changed = false;
        state.blinkTimer -= delta;
        if (state.blinkTimer <= 0 && state.blinkState === 'idle') {
                state.blinkState = 'closing';
                state.blinkProgress = 0;
        }
        if (state.blinkState === 'closing') {
                const previous = state.blinkProgress;
                state.blinkProgress = Math.min(1, state.blinkProgress + delta / 0.07);
                if (state.blinkProgress >= 1) {
                        state.blinkState = 'opening';
                }
                if (Math.abs(previous - state.blinkProgress) > 1e-4) {
                        changed = true;
                }
        } else if (state.blinkState === 'opening') {
                const previous = state.blinkProgress;
                state.blinkProgress = Math.max(0, state.blinkProgress - delta / 0.12);
                if (state.blinkProgress <= 0.001) {
                        state.blinkState = 'idle';
                        state.blinkProgress = 0;
                        state.blinkTimer = randomRange(2.2, 4.8);
                }
                if (Math.abs(previous - state.blinkProgress) > 1e-4) {
                        changed = true;
                }
        }

        state.lookSwitchTimer -= delta;
        if (state.lookSwitchTimer <= 0) {
                state.lookTarget.set(randomRange(-0.75, 0.75), randomRange(-0.28, 0.32));
                state.lookSwitchTimer = randomRange(1.4, 2.8);
        }
        const lookLerp = 1 - Math.exp(-delta * 6);
        if (lookLerp > 0) {
                const prevX = state.lookCurrent.x;
                const prevY = state.lookCurrent.y;
                state.lookCurrent.lerp(state.lookTarget, lookLerp);
                const diffX = state.lookCurrent.x - prevX;
                const diffY = state.lookCurrent.y - prevY;
                if (diffX * diffX + diffY * diffY > 1e-6) {
                        changed = true;
                }
        }

        state.emotionTimer -= delta;
        if (state.emotionTimer <= 0) {
                const next = EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)];
                state.scaleTarget = next.scale;
                state.tiltTarget = next.tilt;
                state.brightnessTarget = next.brightness;
                state.verticalBiasTarget = next.verticalBias;
                state.emotionTimer = randomRange(3.5, 6.5);
        }
        const lerpFactor = 1 - Math.exp(-delta * 4);
        const scaleBefore = state.scaleCurrent;
        state.scaleCurrent = MathUtils.lerp(state.scaleCurrent, state.scaleTarget, lerpFactor);
        if (Math.abs(scaleBefore - state.scaleCurrent) > 1e-4) {
                changed = true;
        }
        const tiltBefore = state.tiltCurrent;
        state.tiltCurrent = MathUtils.lerp(state.tiltCurrent, state.tiltTarget, lerpFactor);
        if (Math.abs(tiltBefore - state.tiltCurrent) > 1e-4) {
                changed = true;
        }
        const brightnessBefore = state.brightnessCurrent;
        state.brightnessCurrent = MathUtils.lerp(
                state.brightnessCurrent,
                state.brightnessTarget,
                lerpFactor
        );
        if (Math.abs(brightnessBefore - state.brightnessCurrent) > 1e-4) {
                changed = true;
        }
        const verticalBiasBefore = state.verticalBiasCurrent;
        state.verticalBiasCurrent = MathUtils.lerp(
                state.verticalBiasCurrent,
                state.verticalBiasTarget,
                lerpFactor
        );
        if (Math.abs(verticalBiasBefore - state.verticalBiasCurrent) > 1e-4) {
                changed = true;
        }

        const blinkAmountBefore = state.blinkAmount;
        state.blinkAmount = easeInOut(Math.min(1, state.blinkProgress));
        if (Math.abs(blinkAmountBefore - state.blinkAmount) > 1e-4) {
                changed = true;
        }

        if (changed || state.needsRedraw) {
                drawFace(state);
        }
};

const disposeRobotFaceState = (state: RobotFaceState) => {
        state.texture.dispose();
        state.material.dispose();
};

const attachFaceToMesh = (mesh: Mesh): RobotFaceController | null => {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const materialName = material?.name ?? mesh.name;
        if (!FACE_MATCHER.test(materialName)) {
                return null;
        }
        const faceState = createRobotFaceState(mesh);
        if (!faceState) {
                return null;
        }
        return {
                update(delta: number) {
                        updateRobotFaceState(faceState, delta);
                },
                dispose() {
                        disposeRobotFaceState(faceState);
                }
        };
};

export const createRobotFaceControllers = (root: Object3D): RobotFaceController[] => {
        const controllers: RobotFaceController[] = [];
        root.traverse((object) => {
                if (object instanceof Mesh) {
                        const controller = attachFaceToMesh(object);
                        if (controller) {
                                controllers.push(controller);
                        }
                }
        });
        return controllers;
};
