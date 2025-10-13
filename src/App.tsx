import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ViewerCanvas from './components/ViewerCanvas';
import JSZip from 'jszip';
import {LdarkWebSocketClient} from "./services/ldarkWebsocket";

interface LoadedModel {
	url: string | null;
	name: string;
	isCustom: boolean;
}

const FALLBACK_MODEL: LoadedModel = {
	url: null,
	name: 'Модель не загружена',
	isCustom: false
};

const DEFAULT_MODEL_CANDIDATES = ['default.zip', 'models/default.zip'] as const;

type PreparedModel = {
	url: string;
	name: string;
	objectUrls: string[];
};

const toBasename = (path: string) => {
	const normalized = path.replace(/\\\\/g, '/');
	const segments = normalized.split('/');
	return segments[segments.length - 1] || normalized;
};

const normalizeZipPath = (path: string) => {
	const normalized = path.replace(/\\\\/g, '/');
	const parts = normalized.split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return stack.join('/');
};

const prepareZipModel = async (file: File): Promise<PreparedModel> => {
	const objectUrls: string[] = [];
	try {
		const zip = await JSZip.loadAsync(file);
		const entries = Object.values(zip.files).filter((entry) => !entry.dir);
		if (entries.length === 0) {
			throw new Error('Архив пустой.');
		}
		const findEntry = (extension: string) =>
			entries.find((entry) => entry.name.toLowerCase().endsWith(extension));
		const glbEntry = findEntry('.glb');
		if (glbEntry) {
			const blob = await glbEntry.async('blob');
			const url = URL.createObjectURL(blob);
			objectUrls.push(url);
			return { url, name: toBasename(glbEntry.name), objectUrls };
		}
		const gltfEntry = findEntry('.gltf');
		if (!gltfEntry) {
			throw new Error('В архиве нет файлов .gltf или .glb.');
		}
		const baseDirIndex = gltfEntry.name.lastIndexOf('/');
		const baseDir = baseDirIndex !== -1 ? gltfEntry.name.slice(0, baseDirIndex + 1) : '';
		const resolveResource = async (resourcePath: string) => {
			if (resourcePath.startsWith('data:')) {
				return resourcePath;
			}
			const normalizedPath = normalizeZipPath(baseDir + resourcePath);
			const fallbackPath = normalizeZipPath(resourcePath);
			const resourceEntry = zip.file(normalizedPath) ?? zip.file(fallbackPath);
			if (!resourceEntry) {
				throw new Error(`Не найден ресурс ${resourcePath} в архиве.`);
			}
			const blob = await resourceEntry.async('blob');
			const resourceUrl = URL.createObjectURL(blob);
			objectUrls.push(resourceUrl);
			return resourceUrl;
		};
		const gltfContent = await gltfEntry.async('string');
		const gltfJson = JSON.parse(gltfContent);
		if (Array.isArray(gltfJson.buffers)) {
			for (const buffer of gltfJson.buffers) {
				if (buffer && typeof buffer.uri === 'string' && !buffer.uri.startsWith('data:')) {
					buffer.uri = await resolveResource(buffer.uri);
				}
			}
		}
		if (Array.isArray(gltfJson.images)) {
			for (const image of gltfJson.images) {
				if (image && typeof image.uri === 'string' && !image.uri.startsWith('data:')) {
					image.uri = await resolveResource(image.uri);
				}
			}
		}
		const gltfBlob = new Blob([JSON.stringify(gltfJson)], { type: 'model/gltf+json' });
		const gltfUrl = URL.createObjectURL(gltfBlob);
		objectUrls.push(gltfUrl);
		return { url: gltfUrl, name: toBasename(gltfEntry.name), objectUrls };
	} catch (error) {
		for (const url of objectUrls) {
			URL.revokeObjectURL(url);
		}
		throw error;
	}
};

const prepareModelSource = async (file: File): Promise<PreparedModel> => {
	const lowerName = file.name.toLowerCase();
	if (lowerName.endsWith('.zip')) {
		return prepareZipModel(file);
	}
	if (lowerName.endsWith('.glb') || lowerName.endsWith('.gltf')) {
		const url = URL.createObjectURL(file);
		return { url, name: file.name, objectUrls: [url] };
	}
	throw new Error('Поддерживаются только файлы .glb, .gltf и .zip.');
};

export default function App() {
	const [model, setModel] = useState<LoadedModel>(FALLBACK_MODEL);
	const [status, setStatus] = useState<string | null>(null);
	const activeUrlsRef = useRef<string[]>([]);
	const socket = new LdarkWebSocketClient();

	useEffect(() => {
		socket.connect();
		socket.onOpen(()=>{
			socket.send("Crazy slut online");
		})
		return () => {
			socket.disconnect()
		}
	}, []);
	const onBtn = () => {
		socket.send("onBtn");
	}

	const releaseActiveUrls = useCallback(() => {
		if (activeUrlsRef.current.length === 0) {
			return;
		}
		for (const url of activeUrlsRef.current) {
			URL.revokeObjectURL(url);
		}
		activeUrlsRef.current = [];
	}, []);

	useEffect(() => () => releaseActiveUrls(), [releaseActiveUrls]);

	const handleFile = useCallback(
		async (file: File | null): Promise<void> => {
			releaseActiveUrls();
			if (!file) {
				setModel(FALLBACK_MODEL);
				setStatus('Модель не загружена');
				return;
			}
			try {
				setStatus('Обработка файла...');
				const prepared = await prepareModelSource(file);
				activeUrlsRef.current = prepared.objectUrls;
				setModel({
					url: prepared.url,
					name: prepared.name,
					isCustom: true
				});
				setStatus(null);
			} catch (error) {
				console.error(error);
				activeUrlsRef.current = [];
				const message = error instanceof Error ? error.message : 'Ошибка загрузки модели';
				setModel({ url: null, name: message, isCustom: false });
				setStatus(message);
			}
		},
		[releaseActiveUrls]
	);

	useEffect(() => {
		let cancelled = false;
		const loadDefault = async () => {
			setStatus('Загрузка default.zip...');
			let lastError: unknown = null;
			for (const relativePath of DEFAULT_MODEL_CANDIDATES) {
				try {
					const response = await fetch(`${import.meta.env.BASE_URL}${relativePath}`);
					if (!response.ok) {
						throw new Error(
							`Не удалось загрузить ${relativePath} (статус ${response.status})`
						);
					}
					const blob = await response.blob();
					if (cancelled) {
						return;
					}
					const fileName = relativePath.split('/').pop() ?? 'default.zip';
					const defaultFile = new File([blob], fileName, { type: 'application/zip' });
					await handleFile(defaultFile);
					return;
				} catch (error) {
					console.error(error);
					lastError = error;
				}
			}
			if (cancelled) {
				return;
			}
			const message =
				lastError instanceof Error
					? lastError.message
					: 'Не удалось загрузить модель по умолчанию';
			setModel({ url: null, name: message, isCustom: false });
			setStatus(message);
		};
		void loadDefault();
		return () => {
			cancelled = true;
		};
	}, [handleFile]);

	useEffect(() => {
		const prevent = (event: DragEvent) => {
			event.preventDefault();
		};
		const handleDropEvent = (event: DragEvent) => {
			event.preventDefault();
			const file = event.dataTransfer?.files?.[0] ?? null;
			void handleFile(file);
		};
		window.addEventListener('dragover', prevent);
		window.addEventListener('drop', handleDropEvent);
		return () => {
			window.removeEventListener('dragover', prevent);
			window.removeEventListener('drop', handleDropEvent);
		};
	}, [handleFile]);

	const overlayText = useMemo(() => {
		if (status) {
			return status;
		}
		if (!model.url) {
			return 'Модель не загружена';
		}
		return model.name;
	}, [status, model]);

	return (
		<div className="flex h-screen w-screen flex-col bg-black text-white">
			<div className="relative flex-1">
				<ViewerCanvas modelUrl={model.url} />
				<div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/60 px-3 py-1 text-xs uppercase tracking-wide">
					{overlayText}
				</div>
				<div className={"absolute size-full pointer-events-none top-10 left-10"}>
					<div className={"w-[100px] h-[40px] bg-white text-black active:bg-amber-100 pointer-events-auto "}
						onClick={()=>{onBtn()}}
					>
						PING
					</div>
				</div>
			</div>
		</div>
	);
}
