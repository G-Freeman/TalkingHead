import { Suspense, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useLoader, useThree, useFrame } from '@react-three/fiber';
import { AdaptiveDpr, Html, MeshReflectorMaterial, OrbitControls, StatsGl } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Box3, CubeTextureLoader, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { memo, useEffect } from 'react';
import { createRobotFaceControllers, type RobotFaceController } from './robotFaceController';

interface ViewerCanvasProps {
	modelUrl: string | null;
}

const CAMERA_POSITION: [number, number, number] = [2.874, 1.813, -0.518];
const CAMERA_TARGET: [number, number, number] = [0.526, 0.232, 0.723];

const Model = memo(function Model({ url }: { url: string }) {
	const gltf = useLoader(GLTFLoader, url);
        const scene = useMemo(() => {
                const cloned = gltf.scene.clone(true);
                const box = new Box3().setFromObject(cloned);
                const size = new Vector3();
                const center = new Vector3();
                box.getSize(size);
                box.getCenter(center);
                cloned.position.sub(center);
                const maxAxis = Math.max(size.x, size.y, size.z);
                if (maxAxis > 0) {
                        const scale = 3 / maxAxis;
                        cloned.scale.setScalar(scale);
                }
                return cloned;
        }, [gltf.scene]);

        const faceControllers = useMemo<RobotFaceController[]>(() => createRobotFaceControllers(scene), [scene]);

        useFrame((_, delta) => {
                for (const controller of faceControllers) {
                        controller.update(delta);
                }
        });

        useEffect(
                () => () => {
                        for (const controller of faceControllers) {
                                controller.dispose();
                        }
                },
                [faceControllers]
        );

        return <primitive object={scene} dispose={null} />;
});

const DefaultPrimitive = memo(function DefaultPrimitive() {
	return (
		<mesh castShadow receiveShadow>
			<boxGeometry args={[1, 1, 1]} />
			<meshStandardMaterial color="#4fd1c5" metalness={0.5} roughness={0.2} />
		</mesh>
	);
});

const CUBE_FACE_FILENAMES = [
	'posx.jpg',
	'negx.jpg',
	'posy.jpg',
	'negy.jpg',
	'posz.jpg',
	'negz.jpg'
] as const;

const CubeEnvironment = memo(function CubeEnvironment() {
	const texture = useMemo(() => {
		const loader = new CubeTextureLoader();
		loader.setPath(`${import.meta.env.BASE_URL}cubemap/`);
		const cubeTexture = loader.load([...CUBE_FACE_FILENAMES]);
		cubeTexture.colorSpace = SRGBColorSpace;
		return cubeTexture;
	}, []);
	const { scene } = useThree();

	useEffect(() => {
		const previousBackground = scene.background;
		const previousEnvironment = scene.environment;
		scene.environment = texture;
		scene.background = texture;
		return () => {
			scene.environment = previousEnvironment;
			scene.background = previousBackground;
			texture.dispose();
		};
	}, [scene, texture]);

	return null;
});

const ReflectiveGround = memo(function ReflectiveGround() {
	return (
		<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]} receiveShadow>
			<planeGeometry args={[200, 200]} />
			<MeshReflectorMaterial
				blur={[250, 100]}
				mixBlur={1}
				mixStrength={25}
				depthScale={1.2}
				minDepthThreshold={0.9}
				maxDepthThreshold={1.2}
				mirror={1}
				metalness={0.8}
				roughness={0.25}
				color="#0a0b12"
			/>
		</mesh>
	);
});

const KeyboardCameraController = memo(function KeyboardCameraController({
																			controlsRef
																		}: {
	controlsRef: MutableRefObject<OrbitControlsImpl | null>;
}) {
	const pressed = useRef<Record<string, boolean>>({});
	const move = useRef(new Vector3());
	const direction = useRef(new Vector3());
	const side = useRef(new Vector3());
	const up = useMemo(() => new Vector3(0, 1, 0), []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			pressed.current[event.code] = true;
		};
		const handleKeyUp = (event: KeyboardEvent) => {
			pressed.current[event.code] = false;
		};
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	}, []);

	useFrame((_, delta) => {
		const controls = controlsRef.current;
		if (!controls) {
			return;
		}
		const camera = controls.object as PerspectiveCamera;
		const speed = pressed.current.ShiftLeft ? 10 : 4;
		direction.current.set(0, 0, 0);
		move.current.set(0, 0, 0);

		if (pressed.current.KeyW || pressed.current.ArrowUp) {
			direction.current.z -= 1;
		}
		if (pressed.current.KeyS || pressed.current.ArrowDown) {
			direction.current.z += 1;
		}
		if (pressed.current.KeyA || pressed.current.ArrowLeft) {
			direction.current.x -= 1;
		}
		if (pressed.current.KeyD || pressed.current.ArrowRight) {
			direction.current.x += 1;
		}
		if (pressed.current.KeyQ) {
			direction.current.y -= 1;
		}
		if (pressed.current.KeyE || pressed.current.Space) {
			direction.current.y += 1;
		}

		if (direction.current.lengthSq() === 0) {
			return;
		}

		direction.current.normalize();

		const forward = new Vector3();
		camera.getWorldDirection(forward);
		forward.y = 0;
		forward.normalize();

		side.current.crossVectors(forward, up).normalize();

		move.current.addScaledVector(forward, direction.current.z);
		move.current.addScaledVector(side.current, direction.current.x);
		move.current.addScaledVector(up, direction.current.y);

		if (move.current.lengthSq() === 0) {
			return;
		}

		move.current.normalize().multiplyScalar(speed * delta);
		controls.target.add(move.current);
		controls.object.position.add(move.current);
		controls.update();
	});

	return null;
});

const CameraInfoOverlay = memo(function CameraInfoOverlay({
														controlsRef
													}: {
	controlsRef: MutableRefObject<OrbitControlsImpl | null>;
}) {
	const { camera } = useThree();
	const textRef = useRef<HTMLDivElement | null>(null);
	const forwardRef = useRef(new Vector3());

	useFrame(() => {
		const container = textRef.current;
		if (!container) {
			return;
		}
		const controls = controlsRef.current;
		const formatVec = (vec: Vector3) =>
			`[${vec.x.toFixed(3)}, ${vec.y.toFixed(3)}, ${vec.z.toFixed(3)}]`;
		const forward = forwardRef.current;
		camera.getWorldDirection(forward);
		forward.normalize();
		const lines = [
			`camera: ${formatVec(camera.position)}`,
			controls ? `target: ${formatVec(controls.target)}` : 'target: —',
			`direction: ${formatVec(forward)}`,
			`up: ${formatVec(camera.up)}`,
			controls
				? `distance: ${camera.position.distanceTo(controls.target).toFixed(3)}`
				: 'distance: —'
		];
		container.textContent = lines.join('\n');
	});

	return (
		<Html transform={false} prepend>
			{/*<div*/}
			{/*	ref={textRef}*/}
			{/*	style={{*/}
			{/*		position: 'absolute',*/}
			{/*		top: '16px',*/}
			{/*		right: '16px',*/}
			{/*		minWidth: '240px',*/}
			{/*		padding: '12px',*/}
			{/*		borderRadius: '8px',*/}
			{/*		background: 'rgba(0, 0, 0, 0.65)',*/}
			{/*		color: '#e2e8f0',*/}
			{/*		fontFamily: 'monospace',*/}
			{/*		fontSize: '12px',*/}
			{/*		lineHeight: 1.5,*/}
			{/*		pointerEvents: 'none',*/}
			{/*		whiteSpace: 'pre'*/}
			{/*	}}*/}
			{/*/>*/}
		</Html>
	);
});

const LoaderFallback = () => (
	<group>
		<DefaultPrimitive />
	</group>
);

const SceneContent = ({ modelUrl }: { modelUrl: string | null }) => {
	return modelUrl ? <Model key={modelUrl} url={modelUrl} /> : <DefaultPrimitive />;
};

export default function ViewerCanvas({ modelUrl }: ViewerCanvasProps) {
	const controlsRef = useRef<OrbitControlsImpl | null>(null);

	return (
		<Canvas
			shadows
			camera={{ position: CAMERA_POSITION, fov: 45, near: 0.1, far: 200 }}
			style={{ width: '100%', height: '100%' }}
		>
			<AdaptiveDpr pixelated />
			<Suspense fallback={<LoaderFallback />}>
				<ambientLight intensity={0.5} />
				<directionalLight
					castShadow
					position={[6, 8, 2]}
					intensity={1.5}
					shadow-mapSize-width={2048}
					shadow-mapSize-height={2048}
				/>
				<CubeEnvironment />
				<ReflectiveGround />
				<SceneContent modelUrl={modelUrl} />
			</Suspense>
			<OrbitControls
				ref={controlsRef}
				enableDamping
				dampingFactor={0.05}
				minDistance={1}
				maxDistance={50}
				target={CAMERA_TARGET}
			/>
			<KeyboardCameraController controlsRef={controlsRef} />
			<CameraInfoOverlay controlsRef={controlsRef} />
			{/*<StatsGl className="!top-auto !bottom-2 !left-2" />*/}
		</Canvas>
	);
}
