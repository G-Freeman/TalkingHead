import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import ViewerCanvas from './components/ViewerCanvas';
import ModelSourceSelector from './components/ModelSourceSelector';
import ControlHints from './components/ControlHints';

interface LoadedModel {
	url: string | null;
	name: string;
	isCustom: boolean;
}

const FALLBACK_MODEL: LoadedModel = {
	url: null,
	name: 'Встроенный куб',
	isCustom: false
};

type PreparedModel = {
	url: string;
	name: string;
	objectUrls: string[];
};

const toBasename = (path: string) => {
	const normalized = path.replace(/\\/g, '/');
	const segments = normalized.split('/');
	return segments[segments.length - 1] || normalized;
};

const normalizeZipPath = (path: string) => {
	const normalized = path.replace(/\\/g, '/');
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
	const activeUrlsRef = useRef<string[]>([]);

	const releaseActiveUrls = useCallback(() => {
		if (activeUrlsRef.current.length === 0) {
			return;
		}
		for (const url of activeUrlsRef.current) {
			URL.revokeObjectURL(url);
		}
		activeUrlsRef.current = [];
	}, []);

	useEffect(() => {
		return () => {
			releaseActiveUrls();
		};
	}, [releaseActiveUrls]);

	const handleFile = useCallback(
		async (file: File | null): Promise<void> => {
			releaseActiveUrls();

			if (!file) {
				setModel(FALLBACK_MODEL);
				return;
			}

			try {
				const prepared = await prepareModelSource(file);
				activeUrlsRef.current = prepared.objectUrls;
				setModel({
					url: prepared.url,
					name: prepared.name,
					isCustom: true
				});
			} catch (error) {
				console.error(error);
				activeUrlsRef.current = [];
				const message = error instanceof Error ? error.message : 'Ошибка загрузки';
				setModel({
					url: null,
					name: message,
					isCustom: false
				});
			}
		},
		[releaseActiveUrls]
	);

	const resetToDefault = useCallback(() => {
		void handleFile(null);
	}, [handleFile]);

	const headerTitle = useMemo(
		() => (model.isCustom ? `Модель: ${model.name}` : 'Быстрый просмотрщик GLTF'),
		[model]
	);

	return (
		<div className="flex min-h-screen flex-col bg-surface">
			<header className="border-b border-white/5 bg-surface/80 px-6 py-4 backdrop-blur">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<h1 className="text-xl font-semibold text-white sm:text-2xl">{headerTitle}</h1>
					<button
						type="button"
						onClick={resetToDefault}
						className="inline-flex items-center justify-center rounded-md border border-teal-500/40 px-3 py-1.5 text-sm font-medium text-teal-300 transition hover:border-teal-400 hover:text-teal-200"
					>
						Сбросить
					</button>
				</div>
			</header>
			<main className="mx-auto flex w-full max-w-6xl grow flex-col gap-6 px-6 py-6 lg:flex-row">
				<section className="flex grow basis-2/3 flex-col overflow-hidden rounded-2xl border border-white/5 bg-panel shadow-xl">
					<div className="relative h-full min-h-[400px] grow">
						<ViewerCanvas modelUrl={model.url} />
						<div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/40 px-3 py-1 text-xs uppercase tracking-wide text-gray-200">
							{model.isCustom ? model.name : 'Встроенный примитив'}
						</div>
					</div>
				</section>
				<aside className="flex basis-1/3 flex-col gap-4">
					<ModelSourceSelector onSelect={handleFile} />
					<ControlHints modelName={model.name} isCustomModel={model.isCustom} />
					<div className="rounded-lg border border-white/10 bg-panel/80 p-4 text-xs text-gray-400">
						<p>
							Просмотрщик поддерживает загрузку glTF/glb файлов размером до нескольких сотен мегабайт
							(ограничено памятью браузера). Для максимальной производительности используйте бинарный формат
							glb и включите сжатие текстур.
						</p>
					</div>
				</aside>
			</main>
		</div>
	);
}
