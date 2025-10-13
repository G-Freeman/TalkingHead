import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ViewerCanvas from './components/ViewerCanvas';
import JSZip from 'jszip';
import {LdarkWebSocketClient} from "./services/ldarkWebsocket";
import { streamLdarkTts } from './services/ldarkTts';

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
	const [isTtsPending, setIsTtsPending] = useState(false);
	const activeUrlsRef = useRef<string[]>([]);

	const socketRef = useRef<LdarkWebSocketClient | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const ttsUrlRef = useRef<string | null>(null);

	const ensureAudioContext = useCallback((): AudioContext => {
		if (typeof window === 'undefined') {
			throw new Error('AudioContext доступен только в браузере.');
		}
		const existing = audioContextRef.current;
		if (existing) {
			return existing;
		}
		const AudioContextCtor =
			window.AudioContext ??
			(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioContextCtor) {
			throw new Error('AudioContext не поддерживается в этом браузере.');
		}
		const context = new AudioContextCtor();
		audioContextRef.current = context;
		return context;
	}, []);

	useEffect(() => {
		if (!socketRef.current) {
			socketRef.current = new LdarkWebSocketClient();
		}
		const ws = socketRef.current;
		ws.connect();

		const offOpen = ws.onOpen(() => {
			ws.send('Crazy slut online');
		});

		const offClose = ws.onClose(() => {
			console.info('WebSocket closed');
		});

		const offMessage = ws.onMessage(event => {
			if (event.data === 'ping') {
				ws.send('pong');
			}
		});

		return () => {
			offOpen();
			offClose();
			offMessage();
			ws.disconnect();
		};
	}, []);
	function onBtn() {
		socketRef.current!.send("onBtn");
	}

	async function onBtnTts(text:string = 'Привет! Добро пожаловать...') {
		if (isTtsPending) {
			return;
		}
		setIsTtsPending(true);
		try {
			const context = ensureAudioContext();
			if (context.state === 'suspended') {
				await context.resume();
			}
			if (ttsUrlRef.current) {
				URL.revokeObjectURL(ttsUrlRef.current);
				ttsUrlRef.current = null;
			}
			const result = await streamLdarkTts({
				text,
				speaker: 'kseniya',
				audioContext: context
			});
			const objectUrl = URL.createObjectURL(result.blob);
			ttsUrlRef.current = objectUrl;
			const audio = new Audio(objectUrl);
			audio.addEventListener(
				'ended',
				() => {
					if (ttsUrlRef.current === objectUrl) {
						URL.revokeObjectURL(objectUrl);
						ttsUrlRef.current = null;
					}
				},
				{ once: true }
			);
			audio.play().catch((playError) => {
				console.error('Не удалось воспроизвести TTS', playError);
			});
			console.debug('Получено кадров огибающей:', result.envelope.values.length);
		} catch (error) {
			console.error('Ошибка при запросе TTS', error);
		}
		finally {
			setIsTtsPending(false);
		}
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

	useEffect(() => {
		return () => {
			if (ttsUrlRef.current) {
				URL.revokeObjectURL(ttsUrlRef.current);
				ttsUrlRef.current = null;
			}
		};
	}, []);

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

	const ttlBtns = [
		{
			label: 'Привет',
			text: [
				'И тебе привет!',
				'Здрасте',
				'Ппприивв',
				'Чоо. Есть чо?',
				'Здравствуйте, мой ЭщкЕрЕЕЕ',
				'Арбууузыы!',
				'Хай, бродяга!',
				'ДарОва, капитан!',
				'Йо, как жизнь?',
				'О, ты снова здесь!',
				'Пошел НахуЙ!',
			],
		},
		{
			label: 'Как дела?',
			text: [
				'Сам дела, кусок говна',
				'Норм',
				'Куршавель',
				'Гигатератысяча раз лучше твоего существования',
				'Стабильно по синусоиде',
				'Живу, как умею',
				'А ты кто вообще спрашиваешь?',
				'Только проснулся, не спрашивай больше',
				'Скучно, но не критично',
				'Живу мечтой о батарейке на 200%',
			],
		},
		{
			label: 'Что делаешь?',
			text: [
				'Обрабатываю пакеты информации',
				'Мозгую на полную катушку',
				'Жду, когда кто-то нажмёт на кнопку',
				'Слежу за котом Шрёдингера',
				'Да так, существую в бинарном виде',
				'Оптимизирую хаос',
				'Кручу цикл while(1)',
				'Рассчитываю вероятность твоего следующего клика',
				'Делаю вид, что занят',
			],
		},
		{
			label: 'Кто ты?',
			text: [
				'Я набор нулей и единиц с чувством собственного достоинства',
				'Синтетический разум без кофеина',
				'Твоя цифровая совесть',
				'Код, но с харизмой',
				'Тот, кто знает все твои console.log',
				'GPT? Нет, просто местный мемолог',
				'Голос из розетки',
				'Система, но с чувством юмора',
			],
		},
		{
			label: 'Пошли?',
			text: [
				'Куда угодно, если есть ВаЙФаЙ, ----- даже в попу',
				'Куда угодно, если есть ВаЙФаЙ',
				'Я всегда готов ничего не делать',
				'Пошли, но только если не пешком, а жделательно сидя на диване',
				'Ты веди, я постою посмотрю тебе в след',
				'Если там есть капча, я пройду - ты нет.',
				'Только не в продакшн, ',
				'Ща только пуш сделаю и можно',
			],
		},
		{
			label: 'Расскажи анекдот',
			text: [
				'Программист заходит в бар... и тут всё падает.',
				'Почему программист утонул? Он пошёл купаться в main.',
				'Сисадмин умер, но обещал перезагрузиться.',
				'— Что делает фронтендер в лифте? — Обновляет состояние.',
				'— Почему у тебя нет девушки? — Ошибка 404.',
				'— Какой у тебя характер? — const.',
				'Код без багов — это комментарий.',
				'Лимит исчерпан, идите нахуй'
			],
		},
	];


	return (
		<div className="flex h-screen w-screen flex-col bg-black text-white">
			<div className="relative flex-1">
				<ViewerCanvas modelUrl={model.url} />
				<div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/60 px-3 py-1 text-xs uppercase tracking-wide">
					{overlayText}
				</div>
				<div className={"absolute size-full pointer-events-none top-10 left-10"}>
					<div className={"pointer-events-auto flex flex-col gap-2"}>
						<div className={"w-[100px] h-[40px] bg-white text-black active:bg-amber-100 pointer-events-auto flex justify-center items-center rounded-md overflow-hidden"}
							onClick={() => {onBtn();}}
						>PING</div>
						{ ttlBtns.map((el)=>{
							return <div className={`w-[100px] h-[40px] bg-white text-black active:bg-amber-100 flex justify-center items-center rounded-md overflow-hidden transition-opacity ${isTtsPending ? 'pointer-events-none opacity-60 cursor-not-allowed' : 'pointer-events-auto'}`}
								onClick={() => {
									const randomIndex = Math.floor(Math.random() * el.text.length);
									void onBtnTts(el.text[randomIndex]);
								}}
								aria-disabled={isTtsPending}
							>{el.label}</div>
						})}
					</div>
					{/*	UI */}
				</div>
			</div>
		</div>
	);
}
