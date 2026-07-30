export function RiskScale({ score }: { score: number }) {
  const bounded = Math.max(0, Math.min(100, score));
  const bands = [
    { range: "0-14", label: "Minimal" },
    { range: "15-29", label: "Faible" },
    { range: "30-44", label: "Modéré" },
    { range: "45-60", label: "Soutenu" },
    { range: "61-100", label: "Élevé" },
  ];

  return (
    <div className="asset-risk-scale" aria-label={`Score de risque ${bounded} sur 100`}>
      <div
        className="asset-risk-marker"
        style={{ left: `${Math.max(3, Math.min(97, bounded))}%` }}
      >
        <strong>{bounded}/100</strong>
        <i />
      </div>
      <div className="asset-risk-track" aria-hidden="true">
        {bands.map((band) => <span key={band.range} />)}
      </div>
      <div className="asset-risk-band-labels">
        {bands.map((band) => (
          <div key={band.range}>
            <span>{band.range}</span>
            <strong>{band.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
