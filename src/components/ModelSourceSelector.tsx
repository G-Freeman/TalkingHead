import { useCallback, useState } from 'react';

interface ModelSourceSelectorProps {
	onSelect: (file: File | null) => void | Promise<void>;
}

export default function ModelSourceSelector({ onSelect }: ModelSourceSelectorProps) {
	const [isDragActive, setDragActive] = useState(false);

	const handleFiles = useCallback(
		(files: FileList | null) => {
			if (!files || files.length === 0) {
				void onSelect(null);
				return;
			}
			const [file] = Array.from(files);
			void onSelect(file);
		},
		[onSelect]
	);

	return (
		<div
			className={`flex flex-col gap-3 rounded-lg border border-white/10 bg-panel/80 p-4 transition-colors ${
				isDragActive ? 'border-teal-400 bg-panel/60' : ''
			}`}
			onDragOver={(event) => {
				event.preventDefault();
				setDragActive(true);
			}}
			onDragLeave={() => setDragActive(false)}
			onDrop={(event) => {
				event.preventDefault();
				setDragActive(false);
				handleFiles(event.dataTransfer?.files ?? null);
			}}
		>
			<div className="flex flex-col gap-1 text-sm text-gray-300">
				<span className="font-semibold text-white">Загрузите модель</span>
				<span className="text-xs text-gray-400">
		  Перетащите сюда .glb/.gltf или архив .zip с ресурсами, либо выберите файл вручную.
		</span>
			</div>
			<label className="flex cursor-pointer items-center justify-center rounded-md bg-teal-500/80 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-400">
				Выбрать файл
				<input
					type="file"
					accept=".gltf,.glb,.zip,model/gltf+json,model/gltf-binary,application/zip"
					className="hidden"
					onChange={(event) => handleFiles(event.target.files)}
				/>
			</label>
		</div>
	);
}
