// src/services/ldarkWebSocket.ts
const DEFAULT_WS_URL = 'wss://ldark-star.ru/ws' as const;
const DEFAULT_TTS_ENDPOINT = 'https://ldark-star.ru/api/tts';
const DEV_TTS_ENDPOINT = '/ldark-api/api/tts';
export const TTS_ENDPOINT = import.meta.env.DEV ? DEV_TTS_ENDPOINT : DEFAULT_TTS_ENDPOINT;

export const LDARK_SPEAKERS = [
	'aidar',
	'baya',
	'kseniya',
	'xenia',
	'eugene',
	'random'
] as const;

export type LdarkSpeaker = (typeof LDARK_SPEAKERS)[number];

export interface LdarkSocketOptions {
	readonly autoReconnect?: boolean;
	readonly reconnectDelayMs?: number;
	readonly maxReconnectAttempts?: number;
	readonly protocols?: string | string[];
}

type Cleanup = () => void;

type MessageHandler = (event: MessageEvent) => void;
type OpenHandler = (event: Event) => void;
type CloseHandler = (event: CloseEvent) => void;
type ErrorHandler = (event: Event) => void;
type WebSocketSendData = string | ArrayBuffer | Blob | ArrayBufferView;

const DEFAULT_RECONNECT_DELAY = 2_000;
const DEFAULT_MAX_ATTEMPTS = Infinity;

const enum ClientState {
	Idle = 0,
	Connecting = 1,
	Open = 2,
	Closing = 3
}

export class LdarkWebSocketClient {
	private socket: WebSocket | null = null;
	private readonly url: string;
	private readonly options: Required<Pick<LdarkSocketOptions, 'autoReconnect'>> &
		Omit<LdarkSocketOptions, 'autoReconnect'>;
	private reconnectAttempts = 0;
	private state: ClientState = ClientState.Idle;
	private manualClose = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly sendQueue: WebSocketSendData[] = [];

	private readonly openHandlers = new Set<OpenHandler>();
	private readonly closeHandlers = new Set<CloseHandler>();
	private readonly errorHandlers = new Set<ErrorHandler>();
	private readonly messageHandlers = new Set<MessageHandler>();

	constructor(url: string = DEFAULT_WS_URL, options: LdarkSocketOptions = {}) {
		this.url = url;
		this.options = {
			autoReconnect: options.autoReconnect ?? true,
			reconnectDelayMs: options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY,
			maxReconnectAttempts: options.maxReconnectAttempts ?? DEFAULT_MAX_ATTEMPTS,
			protocols: options.protocols
		};
	}

	get readyState(): WebSocket['readyState'] | ClientState {
		return this.socket?.readyState ?? this.state;
	}

	connect(): void {
		if (this.state === ClientState.Connecting || this.state === ClientState.Open) {
			return;
		}
		this.manualClose = false;
		this.clearReconnectTimer();
		this.state = ClientState.Connecting;
		this.socket = new WebSocket(this.url, this.options.protocols);
		this.socket.binaryType = 'arraybuffer';
		this.registerListeners();
	}

	send(data: WebSocketSendData): void {
		const target = this.socket;
		if (target && target.readyState === WebSocket.OPEN) {
			target.send(data);
			return;
		}
		this.sendQueue.push(data);
		if (this.state === ClientState.Idle || this.state === ClientState.Closing) {
			this.connect();
		}
	}

	sendJson(payload: unknown): void {
		this.send(JSON.stringify(payload));
	}

	disconnect(code?: number, reason?: string): void {
		this.manualClose = true;
		this.clearReconnectTimer();
		if (!this.socket || this.state === ClientState.Closing || this.state === ClientState.Idle) {
			return;
		}
		this.state = ClientState.Closing;
		this.socket.close(code, reason);
		this.sendQueue.length = 0;
	}

	onOpen(handler: OpenHandler): Cleanup {
		this.openHandlers.add(handler);
		return () => this.openHandlers.delete(handler);
	}

	onClose(handler: CloseHandler): Cleanup {
		this.closeHandlers.add(handler);
		return () => this.closeHandlers.delete(handler);
	}

	onError(handler: ErrorHandler): Cleanup {
		this.errorHandlers.add(handler);
		return () => this.errorHandlers.delete(handler);
	}

	onMessage(handler: MessageHandler): Cleanup {
		this.messageHandlers.add(handler);
		return () => this.messageHandlers.delete(handler);
	}

	private registerListeners(): void {
		if (!this.socket) {
			return;
		}
		this.socket.addEventListener('open', this.handleOpen);
		this.socket.addEventListener('close', this.handleClose);
		this.socket.addEventListener('error', this.handleError);
		this.socket.addEventListener('message', this.handleMessage);
	}

	private unregisterListeners(): void {
		if (!this.socket) {
			return;
		}
		this.socket.removeEventListener('open', this.handleOpen);
		this.socket.removeEventListener('close', this.handleClose);
		this.socket.removeEventListener('error', this.handleError);
		this.socket.removeEventListener('message', this.handleMessage);
	}

	private handleOpen = (event: Event): void => {
		this.state = ClientState.Open;
		this.reconnectAttempts = 0;
		for (const handler of this.openHandlers) {
			handler(event);
		}
		this.flushQueue();
	};

	private handleClose = (event: CloseEvent): void => {
		this.state = ClientState.Idle;
		this.unregisterListeners();
		for (const handler of this.closeHandlers) {
			handler(event);
		}
		if (!this.manualClose) {
			this.scheduleReconnect();
		}
	};

	private handleError = (event: Event): void => {
		for (const handler of this.errorHandlers) {
			handler(event);
		}
	};

	private handleMessage = (event: MessageEvent): void => {
		for (const handler of this.messageHandlers) {
			handler(event);
		}
	};

	private scheduleReconnect(): void {
		if (!this.options.autoReconnect) {
			return;
		}
		if (this.reconnectAttempts >= (this.options.maxReconnectAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
			return;
		}
		this.reconnectAttempts += 1;
		const delay = this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY;
		this.clearReconnectTimer();
		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, delay);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private flushQueue(): void {
		const target = this.socket;
		if (!target || target.readyState !== WebSocket.OPEN) {
			return;
		}
		while (this.sendQueue.length > 0) {
			const chunk = this.sendQueue.shift();
			if (chunk !== undefined) {
				target.send(chunk);
			}
		}
	}
}

export interface TtsRequest {
	readonly text: string;
	readonly speaker?: LdarkSpeaker;
	readonly signal?: AbortSignal;
}

export interface TtsResponse {
	readonly blob: Blob;
	readonly speaker: LdarkSpeaker;
}

export async function requestLdarkTts({
										  text,
										  speaker = 'random',
										  signal
									  }: TtsRequest): Promise<TtsResponse> {
	if (!text || !text.trim()) {
		throw new Error('Текст для синтеза речи не должен быть пустым.');
	}
	if (!LDARK_SPEAKERS.includes(speaker)) {
		throw new Error(`Недопустимый диктор \"${speaker}\".`);
	}
	const response = await fetch(TTS_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ text: text.trim(), speaker }),
		signal
	});
	if (!response.ok) {
		throw new Error(`Ошибка синтеза речи (статус ${response.status}).`);
	}
	const blob = await response.blob();
	return { blob, speaker };
}

export function parseJsonMessage<T>(event: MessageEvent): T | null {
	if (typeof event.data !== 'string') {
		return null;
	}
	try {
		return JSON.parse(event.data) as T;
	} catch (error) {
		console.warn('Не удалось распарсить JSON сообщения от ldark-star', error);
		return null;
	}
}
