interface ControlHintsProps {
	modelName: string;
	isCustomModel: boolean;
}

const HintRow = ({ action, keys }: { action: string; keys: string }) => (
	<div className="flex items-center justify-between text-sm text-gray-300">
		<span className="text-gray-400">{keys}</span>
		<span className="font-medium text-gray-100">{action}</span>
	</div>
);

export default function ControlHints({ modelName, isCustomModel }: ControlHintsProps) {
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-panel/80 p-4 text-sm">
			<div>
				<p className="text-xs uppercase tracking-wide text-gray-400">Текущая сцена</p>
				<p className="text-lg font-semibold text-white">{modelName}</p>
				{isCustomModel ? (
					<p className="text-xs text-teal-400">Загружена пользовательская модель</p>
				) : (
					<p className="text-xs text-gray-500">Показан встроенный примитив</p>
				)}
			</div>
			<div className="flex flex-col gap-2">
				<p className="text-xs uppercase tracking-wide text-gray-400">Управление</p>
				<HintRow action="Орбита" keys="ЛКМ / колесо" />
				<HintRow action="Панорамирование" keys="ПКМ / Shift+ЛКМ" />
				<HintRow action="Приближение" keys="Колесо мыши" />
				<HintRow action="Движение" keys="WASD / стрелки" />
				<HintRow action="Вверх" keys="Space / E" />
				<HintRow action="Вниз" keys="Q" />
				<HintRow action="Быстрый режим" keys="Shift" />
			</div>
		</div>
	);
}