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
GET /api/stocks/{ticker}/technical
GET /api/stocks/{ticker}/news
GET /api/stocks/{ticker}/evaluation
GET /api/stocks/{ticker}/technical/evaluation
GET /api/stocks/{ticker}/news/evaluation
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
warnings
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

### 7. Memoire de l'agent (structuree + knowledge graph)

`MarketDataAgent` dispose d'une memoire persistante en SQLite (`data/agent_memory.db`,
hors Git, chemin surchargeable via `AGENT_MEMORY_DB`).

Deux composants :

- **Memoire structuree** (`app/memory/structured_memory.py`) : tables relationnelles
  pour les snapshots de collecte, profils entreprise, ratios, etats financiers et
  historique de prix (upsert par ticker/date).
- **Knowledge Graph** (`app/memory/knowledge_graph.py`) : faits sujet-predicat-objet
  relies au ticker (`AAPL in_sector TECHNOLOGY`, `AAPL listed_on NASDAQ`,
  `AAPL data_from twelve_data`, ...).

Comportement :

- apres chaque collecte non `failed`, l'agent memorise le resultat complet ;
- si le MCP ne repond pas, l'agent ressert la derniere collecte memorisee
  (statut `partial` + warning explicite) au lieu d'echouer.

Endpoints d'inspection :

```txt
http://localhost:8000/agents/market-data/AAPL/memory
http://localhost:8000/agents/memory/graph
http://localhost:8000/agents/memory/graph?subject=AAPL
```

Types de memoire prevus pour les prochains agents :

| Agent | Type de memoire | Role |
|---|---|---|
| `MarketDataAgent` | Structuree + Knowledge Graph | Prix, profils, ratios, etats financiers (fait) |
| `TechnicalAgent` | Temporelle + Knowledge Graph | RSI, moyennes mobiles, tendance, volatilite (fait) |
| `NewsAgent` | Documentaire + Knowledge Graph | News, evenements, sentiment (fait) |
| `RAGAgent` | Vectorielle + Knowledge Graph | Passages des rapports financiers |
| `RiskAgent` | Knowledge Graph + analytique | Risques croises donnees/news/documents |
| `SynthesisAgent` | Session + Knowledge Graph | Combinaison des resultats |
| Orchestrateur | Etat / workflow | Ordre et statut des agents appeles |

### 8. TechnicalAgent (fait)

Deuxieme agent implemente et valide. Il n'appelle aucune API externe :
il consomme les `historical_prices` deja collectes par `MarketDataAgent`.

Il calcule :

- RSI 14 (methode de Wilder) ;
- SMA 20 et SMA 50 ;
- volatilite (ecart type des rendements quotidiens sur 20 seances, en %) ;
- tendance (`bullish` / `bearish` / `neutral` via prix vs SMA 20 vs SMA 50) ;
- support et resistance (plus bas / plus haut des 30 dernieres seances) ;
- analyse de volume (dernier volume vs moyenne 20 seances) ;
- `technical_score` 0-100 et `signal` (`positive` / `negative` / `neutral`).

Il dispose du meme SLM Nebius (prompt dedie : coherence des indicateurs,
aucune recommandation d'achat/vente) et de sa memoire :

- **Memoire temporelle** (`app/memory/temporal_memory.py`) : chaque calcul est
  date et stocke, ce qui construit une serie d'indicateurs dans le temps ;
- **Knowledge Graph** (partage avec `MarketDataAgent`) : faits techniques
  `MSFT has_indicator RSI_14`, `MSFT has_trend neutral`,
  `MSFT has_support_level 349.2`, `RSI_14 calculated_from historical_prices`.

Endpoints :

```txt
http://localhost:8000/agents/technical/MSFT
http://localhost:8000/agents/technical/MSFT/memory
http://localhost:3000/api/stocks/MSFT/technical
```

### 9. Evaluation qualite des agents + page UI

Un module d'evaluation (`app/agents/evaluation.py`) mesure la qualite des
deux agents, avec 11 metriques chacun :

- **MarketDataAgent** : disponibilite, validite du statut, couverture des
  sources, absence de fallback, completude prix / historique / profil /
  ratios / etats financiers, erreurs maitrisees, resume SLM.
- **TechnicalAgent** : disponibilite, validite du statut, couverture des
  sources, RSI, moyennes mobiles (SMA 20/50), volatilite, niveaux
  support/resistance, analyse des volumes, validite score+signal, erreurs
  maitrisees, resume SLM.

Chaque metrique renvoie `name`, `score` (0-1), `passed`, `message` ;
l'agregat donne `total_score` (0-100), `grade` (`excellent` / `good` /
`partial` / `poor`) et `passed`.

- Harnais CLI : `python ai-backend/eval_agent.py` (rapport console + JSON) ;
- Endpoints : `GET /agents/market-data/{ticker}/evaluation`,
  `GET /agents/technical/{ticker}/evaluation` et
  `GET /agents/news/{ticker}/evaluation` ;
- UI : onglet **Dashboard** du frontend = page "Metriques des agents",
  avec un selecteur d'agent (MarketDataAgent / TechnicalAgent / NewsAgent)
  et un selecteur de ticker.

Dernier resultat mesure (MarketDataAgent) : score moyen 94.1/100, grade
`excellent`, 11/11 PASS.

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
NEBIUS_MODEL_NEWS=zai-org/GLM-5.2
```

Le SLM s'active automatiquement des que `NEBIUS_API_KEY` est renseignee (et `NEBIUS_ENABLED` different de `false`). `NEBIUS_MODEL` sert MarketDataAgent et TechnicalAgent ; `NEBIUS_MODEL_NEWS` (defaut `zai-org/GLM-5.2`) sert NewsAgent pour le sentiment et les resumes en francais.

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

Statut : fait (SLM + memoire temporelle + knowledge graph inclus).

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

### Etape 3 - NewsAgent (fait)

Role :

- recuperer les actualites recentes (outil MCP `news/{ticker}` : FMP + Yahoo RSS + Finnhub + Google News RSS (gratuit) + NewsData.io en parallele, deduplication par titre, plafond de 6 articles par source, cache 10 min) ;
- analyser le sentiment global (label + score entre -1 et 1) et le sentiment de chaque article via le SLM Nebius (`zai-org/GLM-5.2` par defaut, configurable via `NEBIUS_MODEL_NEWS`) ;
- detecter les evenements importants (resultats, M&A, proces, lancements) ;
- memoriser : memoire documentaire SQLite (runs + articles dedupliques + historique de sentiment) et faits news dans le Knowledge Graph (`has_news_sentiment`, `affected_by_event`, `news_from`) ;
- cache TTL agent : 30 min (`NEWS_CACHE_TTL_SECONDS`), contournable avec `?fresh=true`.

Endpoints :

- backend : `GET /agents/news/{ticker}`, `GET /agents/news/{ticker}/evaluation`, `GET /agents/news/{ticker}/memory` ;
- gateway : `GET /api/stocks/{ticker}/news`, `GET /api/stocks/{ticker}/news/evaluation` ;
- UI : troisieme onglet NewsAgent dans la page Metriques du dashboard.

Note : si la cle FMP n'a pas acces aux news (plan gratuit), l'agent fonctionne sur Yahoo RSS + Finnhub + Google News RSS + NewsData.io (warnings non bloquants). Cles dans le `.env` racine : `FINNHUB_API_KEY`, `NEWSDATA_API_KEY` (alternative Google News, format `pub_...`).

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

## Bilan et recommandations

Etat des lieux honnete du projet a ce stade, avec les ameliorations proposees,
classees par priorite.

### Ce qui est solide

- **Architecture claire et progressive** : frontend -> gateway -> ai-backend ->
  mcp-server -> APIs. Chaque agent est isole, testable seul, et les agents ne
  touchent jamais directement les APIs externes.
- **Resilience reelle** : 4 sources de donnees croisees, fallback interne,
  rappel memoire quand le MCP est indisponible, separation warnings/errors.
- **Qualite mesurable** : le module d'evaluation donne un chiffre objectif
  (94.1/100 actuellement) au lieu d'une impression.
- **Memoire bien pensee** : SQLite sans dependance, knowledge graph commun aux
  agents, series temporelles d'indicateurs qui s'enrichissent a chaque appel.
- **SLM discipline** : role limite au controle qualite, pas d'invention de
  chiffres, pas de recommandation. C'est le bon usage d'un LLM en finance.

### Ameliorations prioritaires (performance)

1. **Cache TTL sur la collecte (FAIT)** : le `MarketDataAgent` reutilise la
   derniere collecte memorisee si elle date de moins de 15 minutes
   (configurable via `MARKET_DATA_CACHE_TTL_SECONDS`, `0` pour desactiver).
   Garde de qualite : un snapshot sans prix ou sans historique (collecte
   faite pendant un rate-limit) n'est jamais resservi. Un avertissement
   `Cache memoire : ...` est ajoute au resultat pour la transparence.
   Pour forcer une collecte complete : `GET /agents/market-data/{ticker}?fresh=true`
   (idem sur `/agents/technical/{ticker}` et `/evaluation`).
2. **SLM optionnel par appel (FAIT)** : `MarketDataAgent.run(..., with_slm=False)`.
   Quand `TechnicalAgent` appelle `MarketDataAgent` en interne, le resume SLM
   market-data est saute : un appel LLM sur deux economise (~5-8 s par analyse
   technique). Si un cache hit n'a pas de resume SLM et qu'on en demande un,
   il est complete sans relancer la collecte.
3. **Sources parallelisees dans le MCP (FAIT)** : Twelve Data, yfinance,
   Alpha Vantage et FMP sont interroges via `Promise.allSettled` dans
   `getMarketData`. La latence de collecte devient celle de la source la plus
   lente au lieu de la somme des quatre.
4. **Fix Docker yfinance** : `PYTHON_PATH=python3` manque dans l'image
   mcp-server (bug identifie lors de la revue initiale, non corrige car les
   tests se font hors Docker).
5. **Retry avec backoff sur les 429** : yfinance est presque toujours en
   rate-limit. Un retry differencie (ou une desactivation temporaire de la
   source apres 2 echecs) reduirait le bruit dans les warnings.

### Sources de donnees supplementaires recommandees

| Source | Gratuit | Apport | Priorite |
|---|---|---|---|
| **Finnhub** | Oui (60 req/min) | Quotes temps reel, fondamentaux, news par ticker, sentiment | Integre : source news du NewsAgent (company-news, 7 derniers jours) |
| **SEC EDGAR** | Oui (illimite) | Etats financiers officiels US (10-K, 10-Q), source de verite | Haute : fiabilise les fondamentaux + alimente le RAGAgent |
| **Tiingo** | Oui (genereux) | Historique EOD long (30+ ans), news | Moyenne : renforce l'historique |
| **Stooq** | Oui (sans cle) | Historique EOD en CSV, aucun quota | Moyenne : fallback historique gratuit ideal |
| **FRED (Fed St. Louis)** | Oui | Donnees macro (taux, inflation, chomage) | Moyenne : indispensable pour le futur RiskAgent |
| **GDELT** | Oui | Evenements mondiaux, tonalite media | Basse : NewsAgent avance |
| **Polygon.io** | Non (payant) | Donnees intraday/tick de qualite institutionnelle | Basse : seulement si besoin intraday serieux |

Remplacement a considerer : **yfinance est le maillon faible** (rate-limit
permanent, scraping non officiel). Finnhub + Stooq couvrent ensemble ce que
yfinance apporte (profil + historique), avec de vraies APIs et des quotas connus.

### Idees d'evolution des fonctionnalites

- **Collecte planifiee** : un scheduler (APScheduler) qui collecte les 8
  tickers de demo toutes les heures remplirait automatiquement la memoire
  temporelle et rendrait les series d'indicateurs vraiment exploitables
  (aujourd'hui la serie ne grandit que lors des appels manuels).
- **UI : page technique** : afficher RSI, tendance, support/resistance et le
  resume SLM dans le frontend (la page "Metriques des agents" existe deja,
  une page "Analyse technique" serait la suite naturelle).
- **Evaluation du TechnicalAgent** : etendre le module d'evaluation avec des
  metriques dediees (indicateurs calculables, coherence tendance/score,
  presence du resume SLM).
- **Exploiter le knowledge graph en requetes croisees** : "toutes les societes
  du secteur TECHNOLOGY en tendance bullish" est deja possible avec les faits
  stockes ; il manque juste l'endpoint de requete combinee.
- **Tests automatises** : les calculs du TechnicalAgent (RSI, SMA, volatilite)
  sont deterministes et parfaits pour pytest ; c'est le meilleur endroit pour
  commencer une suite de tests + CI GitHub Actions.
- **Securite avant tout deploiement** : le mcp-server ecoute sur 0.0.0.0 sans
  authentification ; a restreindre (localhost ou token) des que le projet sort
  de la machine locale. Penser aussi a faire tourner les cles API exposees
  pendant le developpement.
- **Observabilite** : remplacer les `except Exception` silencieux par du
  logging structure (module `logging`), pour diagnostiquer les sources qui
  echouent sans deviner.

### Remplacements envisages (plus tard, pas urgents)

- `requests` (sync) -> `httpx` async dans l'ai-backend quand l'orchestrateur
  parallele arrivera ;
- SQLite -> PostgreSQL quand plusieurs services ecriront en meme temps ;
- le harnais d'evaluation manuel -> evaluation continue planifiee avec
  historique des scores (detecter une degradation de source automatiquement).

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

`MarketDataAgent`, `TechnicalAgent` et `NewsAgent` sont valides (SLM + memoire + evaluation).

La prochaine etape logique est :

```txt
Implementer RAGAgent (documents financiers)
```

Il beneficiera du knowledge graph commun deja alimente par les trois premiers agents.
