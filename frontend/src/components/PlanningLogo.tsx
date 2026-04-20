export default function PlanningLogo({ size = 24 }: { size?: number }) {
  const barHeight = size * 0.12;
  const spacing = size * 0.18;
  const barWidth = size * 0.55;
  const offset = size * 0.15;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
      {/* Eje Y (timeline) */}
      <line
        x1={offset}
        y1={size * 0.15}
        x2={offset}
        y2={size * 0.85}
        stroke="currentColor"
        strokeWidth={1.2}
      />

      {/* Barra 1 (arriba) */}
      <rect
        x={offset + 2}
        y={size * 0.15}
        width={barWidth * 0.8}
        height={barHeight}
        fill="currentColor"
        rx={barHeight * 0.4}
      />

      {/* Barra 2 (medio) - más larga */}
      <rect
        x={offset + 2}
        y={size * 0.15 + spacing}
        width={barWidth}
        height={barHeight}
        fill="currentColor"
        rx={barHeight * 0.4}
        opacity={0.7}
      />

      {/* Barra 3 (abajo) - más corta */}
      <rect
        x={offset + 2}
        y={size * 0.15 + spacing * 2}
        width={barWidth * 0.6}
        height={barHeight}
        fill="currentColor"
        rx={barHeight * 0.4}
        opacity={0.5}
      />

      {/* Punto final (milestone) */}
      <circle
        cx={offset}
        cy={size * 0.82}
        r={size * 0.08}
        fill="currentColor"
      />
    </svg>
  );
}
