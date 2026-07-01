const stocks = {
  AAPL: {
    name: "Apple Inc.",
    sector: "Technologie",
    price: 213.4,
    change: 1.84,
    score: 78,
    signal: "Acheter avec prudence",
    text: "Momentum positif, valorisation correcte et tendance technique favorable. Surveiller le niveau de risque.",
    values: [188, 191, 189, 196, 201, 199, 205, 211, 208, 213],
    metrics: [
      ["PER", "31.2"],
      ["Croissance CA", "+6.1%"],
      ["Marge nette", "24.3%"],
      ["Dette / capitaux", "1.52"],
    ],
    checks: [
      ["Tendance 30 jours", "Prix au-dessus de la moyenne mobile", true],
      ["Volume", "Interet acheteur superieur a la moyenne", true],
      ["Valorisation", "Prix encore defendable face aux resultats", true],
      ["Risque", "Volatilite moderee", true],
      ["Timing", "Attendre un repli pour renforcer", false],
    ],
  },
  TSLA: {
    name: "Tesla, Inc.",
    sector: "Automobile",
    price: 327.8,
    change: -2.12,
    score: 58,
    signal: "Surveiller",
    text: "Potentiel eleve, mais volatilite forte. Le dossier demande une confirmation technique avant achat.",
    values: [348, 342, 351, 336, 330, 325, 332, 321, 333, 328],
    metrics: [
      ["PER", "79.4"],
      ["Croissance CA", "+3.8%"],
      ["Marge nette", "8.2%"],
      ["Dette / capitaux", "0.18"],
    ],
    checks: [
      ["Tendance 30 jours", "Tendance encore instable", false],
      ["Volume", "Forts mouvements de court terme", true],
      ["Valorisation", "Prime elevee face au secteur", false],
      ["Risque", "Volatilite importante", false],
      ["Timing", "Signal d'entree non confirme", false],
    ],
  },
  NVDA: {
    name: "NVIDIA Corp.",
    sector: "Semi-conducteurs",
    price: 154.63,
    change: 3.05,
    score: 86,
    signal: "Acheter",
    text: "Croissance solide, tendance robuste et leadership sectoriel. Le principal risque reste la valorisation.",
    values: [126, 130, 134, 138, 141, 146, 143, 149, 152, 155],
    metrics: [
      ["PER", "46.7"],
      ["Croissance CA", "+52.4%"],
      ["Marge nette", "48.9%"],
      ["Dette / capitaux", "0.22"],
    ],
    checks: [
      ["Tendance 30 jours", "Canal haussier intact", true],
      ["Volume", "Accumulation visible", true],
      ["Valorisation", "Exigeante mais soutenue par la croissance", true],
      ["Risque", "Sensibilite aux attentes tres forte", false],
      ["Timing", "Signal technique favorable", true],
    ],
  },
};

const form = document.querySelector("#tickerForm");
const input = document.querySelector("#tickerInput");
const chart = document.querySelector("#priceChart");
const ctx = chart.getContext("2d");

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function drawChart(values, isPositive) {
  const width = chart.width;
  const height = chart.height;
  const padding = 42;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#dce2dc";
  ctx.lineWidth = 1;

  for (let i = 0; i < 5; i += 1) {
    const y = padding + ((height - padding * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  const points = values.map((value, index) => {
    const x = padding + ((width - padding * 2) / (values.length - 1)) * index;
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
  gradient.addColorStop(0, isPositive ? "rgba(36,124,104,.34)" : "rgba(185,73,73,.28)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points.at(-1).x, height - padding);
  ctx.lineTo(points[0].x, height - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = isPositive ? "#247c68" : "#b94949";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = isPositive ? "#247c68" : "#b94949";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function renderMetrics(metrics) {
  document.querySelector("#metricList").innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderChecklist(checks) {
  const doneCount = checks.filter((item) => item[2]).length;
  document.querySelector("#checkCount").textContent = `${doneCount}/${checks.length}`;
  document.querySelector("#checklist").innerHTML = checks
    .map(
      ([title, detail, done]) => `
        <div class="check-item ${done ? "done" : ""}">
          <span class="check-dot">${done ? "OK" : "!"}</span>
          <div class="check-text">
            <strong>${title}</strong>
            <span>${detail}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderStock(ticker) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const stock = stocks[normalizedTicker] || stocks.AAPL;
  const isPositive = stock.change >= 0;

  input.value = stocks[normalizedTicker] ? normalizedTicker : "AAPL";
  document.querySelector("#companySector").textContent = stock.sector;
  document.querySelector("#companyName").textContent = stock.name;
  document.querySelector("#tickerLabel").textContent = input.value;
  document.querySelector("#currentPrice").textContent = formatCurrency(stock.price);

  const change = document.querySelector("#priceChange");
  change.textContent = `${isPositive ? "+" : ""}${stock.change.toFixed(2)}%`;
  change.className = isPositive ? "trend-positive" : "trend-negative";

  document.querySelector("#scoreValue").textContent = stock.score;
  document.querySelector("#scoreRing").style.background =
    `conic-gradient(${isPositive ? "#247c68" : "#b94949"} ${stock.score}%, #e5e8e4 0)`;
  document.querySelector("#signalTitle").textContent = stock.signal;
  document.querySelector("#signalText").textContent = stock.text;

  renderMetrics(stock.metrics);
  renderChecklist(stock.checks);
  drawChart(stock.values, isPositive);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  renderStock(input.value);
});

renderStock("AAPL");
