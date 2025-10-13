import { LDARK_SPEAKERS, LdarkSpeaker, TTS_ENDPOINT } from './ldarkWebsocket';

export interface LdarkTtsStreamCallbacks {
	onStart?(meta: { readonly contentLength?: number; readonly contentType?: string }): void;
	onChunk?(chunk: Uint8Array, receivedBytes: number, totalBytes?: number): void;
	onComplete?(result: { readonly blob: Blob; readonly receivedBytes: number }): void;
}

export interface LdarkTtsStreamRequest {
	readonly text: string;
	readonly speaker?: LdarkSpeaker;
	readonly audioContext: AudioContext;
	readonly signal?: AbortSignal;
	readonly frameSize?: number;
	readonly hopSize?: number;
	readonly callbacks?: LdarkTtsStreamCallbacks;
}

export interface LdarkTtsStreamResult {
	readonly blob: Blob;
	readonly arrayBuffer: ArrayBuffer;
	readonly audioBuffer: AudioBuffer;
	readonly meta: {
		readonly duration: number;
		readonly sampleRate: number;
		readonly channels: number;
	};
	readonly envelope: LipSyncEnvelope;
}

export interface LipSyncEnvelope {
	readonly frameDuration: number;
	readonly frameSize: number;
	readonly values: Float32Array;
}

export async function streamLdarkTts({
	text,
	speaker = 'random',
	audioContext,
	signal,
	frameSize,
	hopSize,
	callbacks
}: LdarkTtsStreamRequest): Promise<LdarkTtsStreamResult> {
	const trimmed = text.trim();
	if (!trimmed) {
		throw new Error('Текст для TTS не должен быть пустым.');
	}
	if (!LDARK_SPEAKERS.includes(speaker)) {
		throw new Error(`Неизвестный диктор "${speaker}".`);
	}
	const response = await fetch(TTS_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ text: trimmed, speaker }),
		signal,
		cache: 'no-store'
	});
	if (!response.ok) {
		throw new Error(`Ошибка генерации голоса (код ${response.status}).`);
	}
	const totalBytes = safeParseContentLength(response.headers.get('Content-Length'));
	const contentType = response.headers.get('Content-Type') ?? undefined;
	callbacks?.onStart?.({ contentLength: totalBytes, contentType });
	const { chunks, receivedBytes } = await collectChunks(response, callbacks, totalBytes);
	const blob = new Blob(chunks, { type: contentType ?? 'audio/mpeg' });
	callbacks?.onComplete?.({ blob, receivedBytes });
	const arrayBuffer = await blob.arrayBuffer();
	const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
	const envelope = buildRmsEnvelope(audioBuffer, { frameSize, hopSize });
	return {
		blob,
		arrayBuffer,
		audioBuffer,
		meta: {
			duration: audioBuffer.duration,
			sampleRate: audioBuffer.sampleRate,
			channels: audioBuffer.numberOfChannels
		},
		envelope
	};
}

export function buildRmsEnvelope(
	audioBuffer: AudioBuffer,
	options: { readonly frameSize?: number; readonly hopSize?: number } = {}
): LipSyncEnvelope {
	const frameSize = options.frameSize ?? 1024;
	const hopSize = options.hopSize ?? Math.max(1, Math.floor(frameSize / 2));
	const mono = mixToMono(audioBuffer);
	if (mono.length === 0) {
		return { frameDuration: hopSize / audioBuffer.sampleRate, frameSize, values: new Float32Array() };
	}
	const frameDuration = hopSize / audioBuffer.sampleRate;
	const frames = Math.max(1, Math.ceil((mono.length - frameSize) / hopSize) + 1);
	const envelope = new Float32Array(frames);
	for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
		const start = frameIndex * hopSize;
		if (start >= mono.length) {
			envelope[frameIndex] = 0;
			continue;
		}
		const end = Math.min(start + frameSize, mono.length);
		let sumSquares = 0;
		for (let i = start; i < end; i += 1) {
			const sample = mono[i];
			sumSquares += sample * sample;
		}
		const count = end - start;
		envelope[frameIndex] = count > 0 ? Math.sqrt(sumSquares / count) : 0;
	}
	return { frameDuration, frameSize, values: envelope };
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
	const { numberOfChannels, length } = audioBuffer;
	if (numberOfChannels === 1) {
		return audioBuffer.getChannelData(0).slice();
	}
	const mono = new Float32Array(length);
	for (let channel = 0; channel < numberOfChannels; channel += 1) {
		const data = audioBuffer.getChannelData(channel);
		for (let i = 0; i < length; i += 1) {
			mono[i] += data[i];
		}
	}
	const invChannels = 1 / numberOfChannels;
	for (let i = 0; i < length; i += 1) {
		mono[i] *= invChannels;
	}
	return mono;
}

async function collectChunks(
	response: Response,
	callbacks: LdarkTtsStreamCallbacks | undefined,
	totalBytes: number | undefined
): Promise<{ readonly chunks: Uint8Array[]; readonly receivedBytes: number }> {
	const stream = response.body;
	if (!stream) {
		const buffer = await response.arrayBuffer();
		const chunk = new Uint8Array(buffer);
		callbacks?.onChunk?.(chunk, chunk.byteLength, totalBytes);
		return { chunks: [chunk], receivedBytes: chunk.byteLength };
	}
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (!value) {
			continue;
		}
		chunks.push(value);
		receivedBytes += value.byteLength;
		callbacks?.onChunk?.(value, receivedBytes, totalBytes);
	}
	return { chunks, receivedBytes };
}

function safeParseContentLength(header: string | null): number | undefined {
	if (!header) {
		return undefined;
	}
	const parsed = Number.parseInt(header, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
