import { useEffect, useRef } from "react";

type PriceChartProps = {
  values: number[];
  positive: boolean;
};

export function PriceChart({ values, positive }: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 42;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#dce2dc";
    context.lineWidth = 1;

    for (let index = 0; index < 5; index += 1) {
      const y = padding + ((height - padding * 2) / 4) * index;
      context.beginPath();
      context.moveTo(padding, y);
      context.lineTo(width - padding, y);
      context.stroke();
    }

    const points = values.map((value, index) => {
      const x = padding + ((width - padding * 2) / (values.length - 1)) * index;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return { x, y };
    });

    const gradient = context.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, positive ? "rgba(36,124,104,.34)" : "rgba(185,73,73,.28)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.lineTo(points[points.length - 1]?.x ?? width - padding, height - padding);
    context.lineTo(points[0]?.x ?? padding, height - padding);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.strokeStyle = positive ? "#247c68" : "#b94949";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();

    points.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
      context.strokeStyle = positive ? "#247c68" : "#b94949";
      context.lineWidth = 2;
      context.stroke();
    });
  }, [positive, values]);

  return <canvas ref={canvasRef} width={900} height={360} aria-label="Graphique du prix" />;
}
