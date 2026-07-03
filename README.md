# Stock AI Assistant

Assistant IA d'analyse boursiere construit progressivement avec une architecture multi-services et une logique multi-agents.

Le projet commence par un agent fiable de collecte de donnees marche, puis evoluera vers un orchestrateur IA capable d'appeler des agents specialises : technique, news, RAG, risque et synthese.

## Objectif du projet

L'objectif est de construire une application capable de produire une analyse complete d'une action boursiere a partir de plusieurs sources de donnees.

Le systeme doit pouvoir :

- recuperer des donnees de marche dynamiques ;
- collecter prix, historique, profil entreprise, ratios et etats financiers ;
- analyser techniquement l'action ;
- analyser les actualites et le sentiment ;
- interroger des documents financiers via RAG ;
- identifier les risques ;
- produire une synthese finale claire avec score et justification.

## Architecture

```txt
stock-ai-assistant/
+-- frontend/          # React + Vite
+-- gateway/           # NestJS, API publique pour le frontend
+-- ai-backend/        # FastAPI, agents IA et orchestration progressive
+-- mcp-server/        # Serveur MCP / outils financiers
+-- docker-compose.yml
+-- README.md
```

Flux actuel :

```txt
Frontend
   v
Gateway NestJS
   v
AI Backend FastAPI
   v
MarketDataAgent
   v
MCP Server
   v
Twelve Data / yfinance / Alpha Vantage / Financial Modeling Prep
```

## Ce qui est deja fait

### 1. Interface frontend

Le frontend React/Vite affiche une interface de type salle des marches.

Etat actuel :

- panier marche ;
- affichage des prix ;
- positions du jour ;
- design adapte au style fourni ;
- anciennes sections non souhaitees retirees ;
- frontend connecte au gateway.

URL locale :

```txt
http://localhost:5173
```

### 2. Gateway NestJS

Le gateway sert de porte d'entree API pour le frontend.

Endpoints principaux :

```txt
GET /api/health
GET /api/stocks/{ticker}/market-data
GET /api/stocks/{ticker}/analyze
GET /api/stocks/market/dashboard
```

Swagger Gateway :

```txt
http://localhost:3000/api/docs
```

Role des endpoints :

- `/api/health` : verifier que le gateway fonctionne ;
- `/api/stocks/{ticker}/market-data` : tester `MarketDataAgent` seul ;
- `/api/stocks/{ticker}/analyze` : analyse simplifiee compatible avec l'UI actuelle ;
- `/api/stocks/market/dashboard` : donnees du dashboard marche.

### 3. Serveur MCP

Le serveur MCP centralise les outils financiers.

Il expose notamment :

```txt
GET /health
GET /market-data/{ticker}
GET /market-dashboard
GET /tools/stock-price/{ticker}
GET /tools/historical-prices/{ticker}
GET /tools/company-profile/{ticker}
GET /tools/financial-statements/{ticker}
```

Role du MCP :

```txt
Agents IA
   v
MCP Server
   v
APIs financieres / outils / futures bases de donnees
```

L'agent ne va pas directement appeler les APIs externes. Il passe par MCP.

### 4. MarketDataAgent

Le premier agent implemente et valide est `MarketDataAgent`.

Son role est de collecter les donnees financieres brutes et structurees.

Il retourne :

```txt
ticker
status
sources_used
used_fallback
price
change_percent
historical_prices
company_profile
financial_ratios
financial_statements_summary
errors
raw_price
slm_summary
```

Sources utilisees :

- `twelve_data` : prix live ;
- `yfinance` : historique, profil et complement de donnees ;
- `alpha_vantage` : profil, ratios et fondamentaux ;
- `financial_modeling_prep` : etats financiers fiables ;
- `fallback` : uniquement secours interne, indique par `used_fallback`.

Endpoint de validation direct :

```txt
http://localhost:8000/agents/market-data/AAPL
```

Swagger FastAPI :

```txt
http://localhost:8000/docs
```

### 5. Donnees financieres dynamiques

Les donnees ne sont plus seulement statiques.

Nous avons integre :

- Twelve Data ;
- yfinance ;
- Alpha Vantage ;
- Financial Modeling Prep.

Financial Modeling Prep a ete ajoute pour mieux remplir :

```txt
total_revenue
net_income
total_assets
total_debt
operating_cashflow
```

Exemple de resultat valide sur `MSFT` :

```txt
sources_used:
  - twelve_data
  - alpha_vantage
  - financial_modeling_prep

financial_statements_summary:
  fiscal_date: 2025-06-30
  total_revenue: 281724000000
  net_income: 101832000000
  total_assets: 619003000000
  total_debt: 112184000000
  operating_cashflow: 136162000000
```

### 6. SLM via Nebius Token Factory

Nous utilisons un SLM optionnel pour `MarketDataAgent`, servi par Nebius Token Factory (API compatible OpenAI).

Modele utilise (economique, adapte au JSON structure) :

```txt
Qwen/Qwen3-30B-A3B-Instruct-2507
```

Role du SLM :

- lire les donnees collectees ;
- produire `slm_summary` ;
- resumer la qualite des donnees ;
- lister les points importants ;
- signaler les limites.

Le SLM ne fait pas :

- collecte de prix ;
- modification de chiffres ;
- recommandation d'achat ou de vente ;
- remplacement des APIs financieres.

Exemple de sortie :

```txt
slm_summary:
  provider: nebius
  model: Qwen/Qwen3-30B-A3B-Instruct-2507
  data_quality: partiel
  summary: ...
  key_points: [...]
  warnings: [...]
```

## Configuration locale

Creer un fichier `.env` a la racine du projet.

Ne jamais mettre les vraies cles API dans Git.

```bash
TWELVE_DATA_API_KEY=your_twelve_data_api_key_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key_here
FMP_API_KEY=your_financial_modeling_prep_api_key_here

NEBIUS_API_KEY=your_nebius_api_key_here
NEBIUS_ENABLED=true
NEBIUS_BASE_URL=https://api.studio.nebius.com/v1
NEBIUS_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
```

Le SLM s'active automatiquement des que `NEBIUS_API_KEY` est renseignee (et `NEBIUS_ENABLED` different de `false`).

Remarque : selon le compte, la base URL peut etre `https://api.studio.nebius.com/v1` ou `https://api.tokenfactory.nebius.com/v1`. Ajuster `NEBIUS_BASE_URL` si besoin.

## Demarrage avec Docker

Depuis la racine :

```bash
docker compose up --build
```

URLs utiles :

```txt
Frontend             http://localhost:5173
Gateway health       http://localhost:3000/api/health
Gateway Swagger      http://localhost:3000/api/docs
AI backend health    http://localhost:8000/health
AI backend Swagger   http://localhost:8000/docs
MCP health           http://localhost:4100/health
```

## Demarrage manuel

### MCP Server

```powershell
cd C:\Users\user\Desktop\Bourse_IA\mcp-server
$env:TWELVE_DATA_API_KEY="your_twelve_data_api_key_here"
$env:ALPHA_VANTAGE_API_KEY="your_alpha_vantage_api_key_here"
$env:FMP_API_KEY="your_financial_modeling_prep_api_key_here"
pnpm dev:http
```

### AI Backend

```powershell
cd C:\Users\user\Desktop\Bourse_IA\ai-backend
$env:MCP_SERVER_URL="http://localhost:4100"
$env:NEBIUS_API_KEY="your_nebius_api_key_here"
$env:NEBIUS_ENABLED="true"
$env:NEBIUS_BASE_URL="https://api.studio.nebius.com/v1"
$env:NEBIUS_MODEL="Qwen/Qwen3-30B-A3B-Instruct-2507"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Gateway

```powershell
cd C:\Users\user\Desktop\Bourse_IA\gateway
pnpm start:dev
```

### Frontend

```powershell
cd C:\Users\user\Desktop\Bourse_IA\frontend
pnpm dev
```

## Validation actuelle

Validation principale :

```txt
GET http://localhost:8000/agents/market-data/MSFT
```

Le resultat est considere bon si :

- `status` vaut `success` ou `partial` ;
- `used_fallback` vaut `false` ;
- `sources_used` contient `twelve_data` ;
- `sources_used` contient `financial_modeling_prep` quand la cle FMP est active ;
- `price` est rempli ;
- `historical_prices` contient plusieurs points ;
- `company_profile.name` est rempli ;
- `financial_statements_summary` est rempli ;
- `slm_summary.model` vaut `Qwen/Qwen3-30B-A3B-Instruct-2507` quand Nebius est active.

Exemple attendu :

```txt
ticker: MSFT
status: partial
sources_used: twelve_data, alpha_vantage, financial_modeling_prep
used_fallback: false
price: present
historical_prices: present
company_profile: present
financial_statements_summary: present
slm_summary: present si NEBIUS_API_KEY est configuree
```

Le statut peut rester `partial` si une source secondaire est limitee, par exemple `yfinance Too Many Requests`. Ce n'est pas bloquant si les donnees essentielles sont presentes.

## Roadmap du projet

### Etape 1 - MarketDataAgent

Statut : fait.

Objectif :

- recuperer les donnees marche ;
- consolider les sources ;
- exposer une sortie structuree ;
- valider l'agent isole ;
- ajouter un SLM local pour resumer la qualite des donnees.

### Etape 2 - TechnicalAgent

Statut : prochaine etape recommandee.

Role :

- utiliser `historical_prices` de `MarketDataAgent` ;
- calculer RSI ;
- calculer moyennes mobiles ;
- mesurer volatilite ;
- detecter tendance ;
- analyser volume ;
- produire supports/resistances simples.

Sortie attendue :

```txt
technical_score
trend
rsi
moving_averages
volatility
support
resistance
technical_summary
```

### Etape 3 - NewsAgent

Role :

- recuperer les actualites recentes ;
- resumer les titres ;
- analyser le sentiment ;
- detecter evenements importants.

Sources possibles :

- APIs news financieres ;
- RSS ;
- GDELT ;
- Financial Modeling Prep news ;
- NewsAPI si disponible.

### Etape 4 - RAGAgent

Role :

- interroger les documents financiers ;
- lire rapports annuels, trimestriels, communiques, presentations investisseurs ;
- retourner des passages pertinents avec sources.

Pipeline prevu :

```txt
PDF / HTML
   v
Extraction texte
   v
Chunks
   v
Embeddings
   v
Base vectorielle
   v
Recherche
   v
Reponse sourcee
```

Technologies possibles :

- LangChain ou LlamaIndex ;
- ChromaDB, FAISS ou Qdrant ;
- embeddings locaux ou OpenAI embeddings.

### Etape 5 - RiskAgent

Role :

- identifier risques financiers ;
- identifier risques sectoriels ;
- analyser volatilite ;
- utiliser news et RAG ;
- produire niveau de risque.

Sortie attendue :

```txt
risk_score
risk_level
main_risks
risk_explanation
```

### Etape 6 - SynthesisAgent

Role :

- combiner tous les agents ;
- produire une synthese finale ;
- calculer un score global ;
- expliquer la recommandation simulee.

Sortie attendue :

```txt
global_score
technical_score
fundamental_score
news_score
risk_score
recommendation_simulated
confidence_level
final_summary
```

### Etape 7 - Orchestrateur IA

Role :

- comprendre la question utilisateur ;
- choisir quels agents appeler ;
- executer les agents dans le bon ordre ;
- gerer les dependances.

Ordre prevu :

```txt
Etape 1 - parallele :
  MarketDataAgent
  NewsAgent
  RAGAgent

Etape 2 - sequentiel :
  TechnicalAgent
  RiskAgent

Etape 3 - synthese :
  SynthesisAgent
```

Technologie recommandee :

```txt
LangGraph
```

## Bases de donnees prevues

### Base SQL

Pour les donnees structurees :

- prix historiques ;
- volumes ;
- indicateurs techniques ;
- scores ;
- resultats d'analyse ;
- backtesting.

MVP :

```txt
SQLite
```

Version avancee :

```txt
PostgreSQL
```

### Base vectorielle RAG

Pour les documents :

- rapports annuels ;
- rapports trimestriels ;
- communiques ;
- presentations investisseurs ;
- articles financiers.

Options :

```txt
ChromaDB
FAISS
Qdrant
```

## Tickers de demonstration

```txt
AAPL
MSFT
NVDA
TSLA
GOOGL
AMZN
META
JPM
```

## Decision actuelle

`MarketDataAgent` est valide.

La prochaine etape logique est :

```txt
Implementer TechnicalAgent
```

Il utilisera directement `historical_prices` deja fournis par `MarketDataAgent`.
