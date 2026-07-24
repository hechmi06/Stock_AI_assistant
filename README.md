# Stock AI Assistant

Assistant IA d'analyse boursiere construit progressivement avec une architecture multi-services et une logique multi-agents.

Le projet commence par un agent fiable de collecte de donnees marche, puis evoluera vers un orchestrateur IA capable d'appeler des agents specialises : technique, news, RAG, risque et synthese.

## Etat actuel du projet

Nous sommes actuellement a la phase **multi-agents valides individuellement**.

Agents deja implementes :

| Agent | Statut | Role actuel |
|---|---|---|
| `MarketDataAgent` | Fait | Collecte prix, historique, profil, ratios, etats financiers |
| `TechnicalAgent` | Fait | Calcule RSI, moyennes mobiles, volatilite, tendance, supports/resistances |
| `NewsAgent` | Fait | Recupere les actualites, deduplique les articles, analyse le sentiment via SLM |
| `RiskAgent` | Fait | Combine MarketData + Technical + News pour produire un diagnostic de risque |
| `RAGAgent` | Fait | Indexe les 10-K/10-Q SEC EDGAR et repond aux questions avec passages sources |
| `PortfolioAgent` | Fait | Valorise les positions, agrege TechnicalAgent et calcule performance/risque du portefeuille |
| `PortfolioSynthesisAgent` | Fait | Combine les analyses individuelles, produit un verdict et un reequilibrage simule avec son propre SLM |
| `PortfolioRecommendationAgent` | Fait | Compose un portefeuille selon le profil utilisateur et justifie chaque allocation avec son propre SLM |
| `SocialSentimentAgent` | Planifie | Analysera Reddit/X comme signal social separe des news officielles |
| `SynthesisAgent` | Fait | Produit une synthese finale et une recommandation simulee |
| Orchestrateur LangGraph | Fait | Execute les agents dans leur ordre de dependance avec une trace |

Etat fonctionnel actuel :

- les APIs passent par le `mcp-server` ;
- le backend FastAPI expose les agents un par un ;
- le gateway NestJS expose les agents dans Swagger ;
- le frontend existe mais ne montre pas encore toutes les sorties avancees des agents ;
- les agents peuvent etre testes dans Swagger avant d'etre branches dans l'UI finale.

Endpoints principaux de validation :

```txt
MarketDataAgent  http://localhost:8000/agents/market-data/MSFT?fresh=true
TechnicalAgent   http://localhost:8000/agents/technical/MSFT?fresh=true
NewsAgent        http://localhost:8000/agents/news/MSFT?fresh=true
RiskAgent        http://localhost:8000/agents/risk/MSFT?fresh=true
PortfolioAgent   POST http://localhost:8000/agents/portfolio/analyze
Portfolio complet POST http://localhost:8000/agents/portfolio/full-analysis
Recommandation   POST http://localhost:8000/agents/portfolio/recommend
Gateway Swagger  http://localhost:3000/api/docs
Backend Swagger  http://localhost:8000/docs
```

Le module `PortfolioAgent` actuellement disponible couvre :

- saisie de positions actions long-only (`ticker`, quantite, prix moyen) et liquidites USD ;
- valorisation par le `MarketDataAgent`, sans nouvel appel direct aux fournisseurs ;
- calcul du cout, de la valeur, du P&L latent et du P&L journalier estime ;
- allocations par titre et par secteur, avec normalisation des libelles ;
- scores de concentration, diversification et confiance des donnees ;
- rendement cumule et annualise, volatilite annualisee et drawdown maximal ;
- beta, Sharpe, Treynor et alpha de Jensen par rapport a un benchmark configurable ;
- correlations entre les actions et score technique pondere ;
- RSI, SMA 20/50, tendance, support/resistance et score technique par position ;
- endpoint FastAPI `POST /agents/portfolio/analyze` ;
- endpoint Swagger NestJS `POST /api/portfolio/analyze` ;
- vue desktop Portefeuille, sauvegardee dans le `localStorage` du navigateur.
- endpoint complet `POST /agents/portfolio/full-analysis` et proxy
  `POST /api/portfolio/full-analysis` ;
- execution de MarketData, Technical, News, RAG, Risk et Synthesis pour chaque
  position, puis compactage de leurs resultats ;
- `PortfolioSynthesisAgent` independant avec score global, verdict, forces,
  faiblesses, decisions par ligne et plan de reequilibrage simule ;
- prompt et modele SLM separes via `NEBIUS_MODEL_PORTFOLIO_SYNTHESIS` ;
- le SLM portefeuille ne modifie jamais les scores, le verdict ou les poids,
  tous calcules par des regles deterministes.

Limites actuelles avant qualification production : les performances sont calculees
sur les prix (hors dividendes et frais) avec des ponderations statiques. Pas encore de vente a
decouvert, options, conversion multi-devises, transactions historiques ni
optimisation mathematique de portefeuille. Le reequilibrage actuel est une
simulation heuristique avec plafond de 30% par ligne et 40% par secteur. EMA,
MACD, stochastique et bandes de Bollinger restent a ajouter au TechnicalAgent.

Les deux syntheses restent independantes :

```txt
Analyse mono-action
  -> SynthesisAgent
  -> prompt/model/memoire mono-action

Analyse portefeuille
  -> analyses individuelles sans reecriture SLM de leur synthese
  -> PortfolioSynthesisAgent
  -> prompt/model portefeuille separe
```

Lancer une analyse portefeuille ne remplace donc jamais la page ni le resultat
d'une analyse mono-action.

Le `PortfolioRecommendationAgent` constitue un troisieme workflow independant :

- entrees utilisateur : budget, profil de risque, objectif, horizon, nombre de
  positions, reserve de liquidites, benchmark et exclusions ;
- screening d'un univers configurable de grandes capitalisations americaines sur les fondamentaux,
  la technique, la stabilite, le momentum et la qualite des donnees ;
- selection sectorielle diversifiee et allocation plafonnee par ligne/secteur ;
- quality gate bloquant sur le prix, l'historique, le profil, les ratios, les
  etats financiers, les sources et l'analyse technique ;
- horizon reellement integre dans les poids du potentiel et du score de selection ;
- validation en boucle des finalistes par le workflow multi-agents complet :
  une position rejetee par les seuils de score, de confiance ou de risque est
  exclue, remplacee, reallouee puis le portefeuille est analyse de nouveau ;
- refus explicite de produire une allocation lorsque trois positions ne peuvent
  pas etre validees ou lorsque la composition ne se stabilise pas ;
- journal d'audit `validation_records` indiquant chaque acceptation/rejet et ses
  motifs, expose dans FastAPI, Swagger et l'interface ;
- argumentaire detaille produit par un SLM dedie, sans pouvoir changer les
  entreprises, les scores ou les poids calcules ;
- endpoint FastAPI `POST /agents/portfolio/recommend` et endpoint gateway
  `POST /api/portfolio/recommend` ;
- vue frontend separee **Recommandation**.

### Recommendation Engine V2

Version de methodologie actuelle : `2.0`.

Le moteur distingue quatre niveaux qui ne doivent pas etre confondus :

1. donnees observees et sourcees ;
2. scores deterministes calcules ;
3. validation multi-agents sous contraintes ;
4. narration SLM, limitee a l'explication.

Le nombre affiche avec le verdict est un **score global d'analyse**, pas une
probabilite de gain :

```txt
qualite individuelle 35% + diversification 20%
+ performance ajustee du risque 20% + technique 10%
+ qualite des donnees 15%
```

La confiance est separee en trois mesures :

- `data_confidence_score` : disponibilite, completude et couverture des sources ;
- `model_confidence_score` : longueur de l'historique, couverture des metriques,
  couverture des positions et disponibilite de l'agregation technique ;
- `decision_confidence_score` : combinaison 55% donnees / 45% modele, penalisee
  lorsque le score est proche d'un seuil, que le portefeuille est concentre ou
  qu'une position presente un risque eleve.

`confidence_score` est conserve pour compatibilite et prend exactement la valeur
de `decision_confidence_score`. Le verdict `robuste` exige simultanement :

- score global d'analyse >= 75/100 ;
- confiance de decision >= 80/100 ;
- confiance des donnees >= 80/100 et confiance du modele >= 70/100 ;
- couverture complete et analyses individuelles toutes en succes ;
- aucune position a risque eleve ;
- aucune concentration elevee.

Les seuils V2 sont des politiques explicites et testees, mais leur calibration
financiere doit encore etre validee par un protocole walk-forward hors
echantillon. Avant de qualifier le moteur pour un usage reel, il reste a ajouter :

- rendements totaux avec dividendes, frais, fiscalite et conversion de devises ;
- covariance robuste, contribution au risque, VaR/CVaR et stress tests ;
- optimisation Black-Litterman, minimum variance, risk parity ou CVaR selon le
  profil ;
- comparaison hors echantillon au benchmark, turnover et calendrier de
  reequilibrage ;
- controle du look-ahead bias et du survivorship bias ;
- profil investisseur complet : situation financiere, portefeuille existant,
  perte maximale acceptable, liquidite, experience et contraintes personnelles.

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
GET /api/stocks/{ticker}/risk
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
- `/api/stocks/{ticker}/technical` : tester `TechnicalAgent` seul ;
- `/api/stocks/{ticker}/news` : tester `NewsAgent` seul ;
- `/api/stocks/{ticker}/risk` : tester `RiskAgent` seul ;
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
- `tiingo` : historique EOD fiable (fallback sans quota serre, si `TIINGO_API_KEY`) ;
- `alpha_vantage` : profil, ratios et fondamentaux ;
- `financial_modeling_prep` : etats financiers fiables ;
- `fallback` : uniquement secours interne, indique par `used_fallback`.

Ordre de collecte de l'historique : `yfinance` -> `tiingo` -> `twelve_data`.
yfinance etant frequemment rate-limited, Tiingo (quota genereux) prend le relais
avant Twelve Data et fiabilise `historical_prices` (donc le TechnicalAgent et la
`data_confidence_score` du RiskAgent).

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

Nous utilisons un SLM optionnel pour les agents, servi par Nebius Token Factory (API compatible OpenAI).

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
- pour `RiskAgent`, expliquer le diagnostic sans recalculer les scores.

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
| `SocialSentimentAgent` | Documentaire courte duree + Knowledge Graph | Posts Reddit/X, volume de mentions, sentiment social |
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
quatre agents :

- **MarketDataAgent** (11 metriques) : disponibilite, validite du statut,
  couverture des sources, absence de fallback, completude prix / historique /
  profil / ratios / etats financiers, erreurs maitrisees, resume SLM.
- **TechnicalAgent** (11 metriques) : disponibilite, validite du statut,
  couverture des sources, RSI, moyennes mobiles (SMA 20/50), volatilite,
  niveaux support/resistance, analyse des volumes, validite score+signal,
  erreurs maitrisees, resume SLM.
- **NewsAgent** (11 metriques) : disponibilite, validite du statut, couverture
  des sources, nombre d'articles, fraicheur, resumes, sentiment global,
  sentiment par article, evenements, erreurs maitrisees, resume SLM.
- **RiskAgent** (13 metriques) : disponibilite, validite du statut, couverture
  des agents amont, coherence score/niveau de risque, **purete du risk_score**
  (les problemes de qualite des donnees n'entrent pas dans le risque),
  coherence de la confiance, **dimension news active** (le sentiment est bien
  exploite), **dimension documentaire active** (les risques SEC/RAG sont bien
  pris en compte), preuves des risques, risques explicables, confiance
  justifiee, erreurs maitrisees, resume SLM.
- **RAGAgent** (13 metriques) : disponibilite, validite du statut, corpus indexe,
  metriques RAGAS proxy (`faithfulness`, `answer_relevance`, `context_recall`,
  `context_precision`), passages recuperes, **pertinence de la recherche**
  (score cosinus), presence de la reponse, **ancrage** (citations `[n]`),
  tracabilite des passages vers un depot SEC, erreurs maitrisees.

Chaque metrique renvoie `name`, `score` (0-1), `passed`, `message` ;
l'agregat donne `total_score` (0-100), `grade` (`excellent` / `good` /
`partial` / `poor`) et `passed`.

- Harnais CLI : `python ai-backend/eval_agent.py` (MarketDataAgent par defaut,
  `--agent {market-data,technical,news,risk}` pour les autres) ;
- Endpoints : `GET /agents/market-data/{ticker}/evaluation`,
  `GET /agents/technical/{ticker}/evaluation`,
  `GET /agents/news/{ticker}/evaluation`,
  `GET /agents/risk/{ticker}/evaluation` et
  `GET /agents/rag/{ticker}/evaluation` ;
- UI : onglet **Dashboard** du frontend = page "Metriques des agents",
  avec un selecteur d'agent (MarketDataAgent / TechnicalAgent / NewsAgent /
  RiskAgent / RAGAgent) et un selecteur de ticker.

Dernier resultat mesure (MarketDataAgent) : score moyen 94.1/100, grade
`excellent`, 11/11 PASS.

### 10. RiskAgent (fait)

`RiskAgent` combine les sorties des agents deja valides :

```txt
MarketDataAgent + TechnicalAgent + NewsAgent + RAGAgent
        v
RiskAgent
```

Il produit :

```txt
ticker
status
overall_risk_level
risk_score
risk_score_breakdown
data_confidence_score
data_confidence_level
risks
component_status
warnings
errors
slm_summary
```

Important :

- `risk_score` mesure le risque detecte sur le titre, sur une echelle `0-100` ;
- il est **pondere par categorie** (`app/agents/risk_scoring.py`) : chaque
  categorie a une contribution maximale (fondamental 25, documentaire 25,
  technique 20, news 20, marche 10) et sature au-dela de quelques risques
  serieux, ce qui evite qu'une pluie de petits risques ne domine le diagnostic ;
- `risk_score_breakdown` detaille la contribution de chaque categorie ;
- `data_confidence_score` mesure la fiabilite des donnees utilisees, aussi sur `0-100` ;
- un titre peut avoir un `risk_score` faible mais une `data_confidence_score` faible si les sources sont limitees ;
- le SLM Qwen resume le diagnostic mais ne recalcule pas les scores.

Risques detectes actuellement :

- risque technique : volatilite, tendance, RSI, score technique faible ;
- risque fondamental : valorisation, dette, cash-flow operationnel negatif ;
- risque news : sentiment negatif ou mixte ;
- risque documentaire : reglementation/antitrust, litiges, cybersecurite,
  IA, supply chain, concurrence, extraits des rapports SEC via RAG ;
- risque `data_quality` : source partielle, API rate-limited, news partielles,
  source externe indisponible, couverture RAG limitee.

Deux invariants de conception (corriges et verrouilles par l'evaluation) :

- **le `risk_score` ne mesure que le risque intrinseque du titre** (marche,
  technique, fondamental, news, documentaire). Les risques `data_quality` restent listes pour
  la transparence mais ne gonflent plus le score : ils reduisent uniquement le
  `data_confidence_score`. Sinon un titre sain servi pendant un rate-limit de
  source secondaire serait faussement classe plus risque ;
- **le sentiment news est reellement calcule** dans le diagnostic (le NewsAgent
  est appele avec le SLM actif). Sans lui, `sentiment_label` restait vide, la
  dimension "risque news" ne se declenchait jamais et le NewsAgent etait fige en
  `partial`, penalisant a tort la confiance.

Endpoints :

```txt
http://localhost:8000/agents/risk/MSFT?fresh=true
http://localhost:8000/agents/risk/MSFT/evaluation
http://localhost:8000/agents/risk/MSFT/memory
http://localhost:3000/api/stocks/MSFT/risk
http://localhost:3000/api/stocks/MSFT/risk/evaluation
```

Exemple d'interpretation :

```txt
risk_score: 30/100
overall_risk_level: low
data_confidence_score: 38/100
data_confidence_level: low
```

Cela signifie : le risque detecte est faible, mais la confiance dans les donnees est faible a cause des sources partielles ou limitees.

## Obstacles actuels

Les principaux obstacles ne viennent pas du code des agents, mais surtout de la qualite et de la disponibilite des sources externes.

### 1. yfinance est instable

`yfinance` est utile en developpement, mais il est souvent limite par Yahoo :

```txt
Too Many Requests
Rate limited
```

Impact :

- historique parfois indisponible ;
- profil entreprise parfois indisponible ;
- warnings frequents dans `MarketDataAgent`, `TechnicalAgent` et `RiskAgent`.

Decision :

- garder `yfinance` comme source secondaire ;
- ne pas en faire la source principale de fiabilite.

### 2. Quotas Alpha Vantage

Alpha Vantage est utile pour les fondamentaux, mais le plan gratuit est limite.

Impact :

- certains endpoints deviennent temporairement indisponibles ;
- `financial_statements_summary` peut etre partiel ;
- `data_confidence_score` baisse quand les quotas sont atteints.

### 3. Financial Modeling Prep bloque certaines routes selon le plan

FMP est tres utile pour les fondamentaux, mais certaines routes, notamment les news, peuvent etre bloquees selon l'abonnement.

Impact :

- `FMP news unavailable` ;
- `NewsAgent` peut rester `partial` ;
- `RiskAgent` ajoute un risque `data_quality`.

### 4. Les donnees news ne sont pas toutes institutionnelles

Nous utilisons plusieurs sources de news :

- Yahoo RSS ;
- Finnhub ;
- Google News RSS ;
- NewsData.io ;
- FMP si disponible.

Impact :

- bonne couverture pour MVP ;
- fiabilite variable selon les articles ;
- besoin de RAG/SEC EDGAR plus tard pour les sources officielles.

### 5. Le frontend ne montre pas encore tout

Le frontend existe et affiche une interface salle des marches, mais les sorties avancees des agents ne sont pas encore toutes integrees visuellement.

Actuellement, la validation la plus claire se fait via :

```txt
http://localhost:8000/docs
http://localhost:3000/api/docs
```

### 6. Le projet n'a pas encore d'orchestrateur final

Les agents sont testables separement, mais il manque encore :

- `RAGAgent` ;
- `SynthesisAgent` ;
- orchestration LangGraph ;
- workflow complet qui decide automatiquement quels agents appeler.

### 7. Fiabilite a ameliorer

Pour augmenter `data_confidence_score`, les prochaines ameliorations recommandees sont :

1. ajouter un cache SQLite plus strategique par type de donnee ;
2. source historique stable **Tiingo** (FAIT) : integree comme fallback entre
   yfinance et Twelve Data (`TIINGO_API_KEY`, quota genereux). Note : Stooq,
   d'abord envisage, protege desormais son export CSV par un challenge anti-bot
   et n'est plus exploitable en direct ;
3. utiliser SEC EDGAR pour les fondamentaux officiels US ;
4. garder Twelve Data/Finnhub comme sources principales de prix/news ;
5. ajouter une logique de consensus entre sources.

## Configuration locale

Creer un fichier `.env` a la racine du projet.

Ne jamais mettre les vraies cles API dans Git.

```bash
TWELVE_DATA_API_KEY=your_twelve_data_api_key_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key_here
FMP_API_KEY=your_financial_modeling_prep_api_key_here
TIINGO_API_KEY=your_tiingo_api_key_here

NEBIUS_API_KEY=your_nebius_api_key_here
NEBIUS_ENABLED=true
NEBIUS_BASE_URL=https://api.studio.nebius.com/v1
NEBIUS_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
NEBIUS_MODEL_PORTFOLIO_SYNTHESIS=Qwen/Qwen3-30B-A3B-Instruct-2507
NEBIUS_MODEL_PORTFOLIO_RECOMMENDATION=Qwen/Qwen3-30B-A3B-Instruct-2507
```

Le SLM s'active automatiquement des que `NEBIUS_API_KEY` est renseignee (et `NEBIUS_ENABLED` different de `false`). Les agents `MarketDataAgent`, `TechnicalAgent`, `NewsAgent` et `RiskAgent` utilisent `NEBIUS_MODEL`. Le `PortfolioSynthesisAgent` utilise `NEBIUS_MODEL_PORTFOLIO_SYNTHESIS` et le `PortfolioRecommendationAgent` utilise `NEBIUS_MODEL_PORTFOLIO_RECOMMENDATION`, avec repli sur `NEBIUS_MODEL` si leur variable dediee est absente.

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
- **filtrer la pertinence** : un article est ecarte s'il ne mentionne ni le ticker ni un token du nom de societe (dans le titre ou le resume). Actif quand le nom est fourni (le RiskAgent le passe depuis le profil ; sur l'endpoint direct via `?name=Tesla`). Un garde-fou conserve la liste brute si le filtre vide tout ;
- **extraction du texte d'article** (opt-in `NEWS_EXTRACT_CONTENT=true`) : pour les 6 articles les plus recents, le mcp-server telecharge la page et extrait le texte principal (`content`) via `trafilatura` ; le SLM juge alors le sentiment sur ce texte plutot que sur le seul titre+resume. Degrade en silence (paywall, anti-bot, trafilatura absent) en retombant sur le resume ;
- analyser le sentiment global (label + score entre -1 et 1) et le sentiment de chaque article via le SLM Nebius (meme modele que les autres agents, `NEBIUS_MODEL`) ;
- detecter les evenements importants (resultats, M&A, proces, lancements) ;
- memoriser : memoire documentaire SQLite (runs + articles dedupliques + historique de sentiment) et faits news dans le Knowledge Graph (`has_news_sentiment`, `affected_by_event`, `news_from`) ;
- cache TTL agent : 30 min (`NEWS_CACHE_TTL_SECONDS`), contournable avec `?fresh=true`.

Endpoints :

- backend : `GET /agents/news/{ticker}`, `GET /agents/news/{ticker}/evaluation`, `GET /agents/news/{ticker}/memory` ;
- gateway : `GET /api/stocks/{ticker}/news`, `GET /api/stocks/{ticker}/news/evaluation` ;
- UI : troisieme onglet NewsAgent dans la page Metriques du dashboard.

Note : si la cle FMP n'a pas acces aux news (plan gratuit), l'agent fonctionne sur Yahoo RSS + Finnhub + Google News RSS + NewsData.io (warnings non bloquants). Cles dans le `.env` racine : `FINNHUB_API_KEY`, `NEWSDATA_API_KEY` (alternative Google News, format `pub_...`).

### Etape 4 - SocialSentimentAgent (planifie)

Statut : planifie, pas encore implemente.

Role :

- recuperer des signaux sociaux depuis Reddit et eventuellement X/Twitter ;
- mesurer le volume de mentions autour d'un ticker ;
- analyser le sentiment social separement du sentiment news ;
- detecter les themes recurrents : boycott, plainte client, rumeur, incident produit, euphorie speculative ;
- produire un score de confiance propre aux donnees sociales.

Important : cet agent ne doit pas etre melange directement avec `NewsAgent`.
Les reseaux sociaux sont plus bruites, plus manipulables et moins fiables que
les sources financieres classiques. Ils doivent etre traites comme un **signal
de perception du marche**, pas comme une source de verite.

Sortie attendue :

```txt
social_sentiment_label
social_sentiment_score
mentions_count
trending_topics
social_confidence_score
sources_used
warnings
```

Impact prevu sur `RiskAgent` :

- faible a moyen poids dans le score final ;
- activation seulement si le volume est suffisant ;
- penalite de confiance si les posts sont peu nombreux, tres repetitifs ou non sources ;
- risque social ajoute seulement si le signal est fort et coherent.

Sources envisagees :

- Reddit API / Pushshift-like alternatives si disponibles ;
- X/Twitter API si une cle officielle est disponible ;
- GDELT ou autres signaux publics comme alternative moins dependante des reseaux sociaux.

### Etape 5 - RiskAgent

Statut : fait.

Role :

- combiner `MarketDataAgent`, `TechnicalAgent` et `NewsAgent` ;
- identifier risques marche, techniques, fondamentaux, news et qualite des donnees ;
- produire `risk_score` sur 100 ;
- produire `data_confidence_score` sur 100 ;
- produire un resume SLM sans recalculer les chiffres.

Sortie actuelle :

```txt
risk_score
overall_risk_level
data_confidence_score
data_confidence_level
risks
component_status
slm_summary
```

### Etape 6 - RAGAgent (fait)

Statut : fait (ingestion SEC EDGAR + embeddings Nebius + Qdrant + reponse sourcee).

Role :

- indexer les documents financiers officiels US (10-K / 10-Q via SEC EDGAR) ;
- repondre a une question en recherchant les passages pertinents ;
- retourner une reponse sourcee (citations `[1]`, `[2]`) sans inventer.

Pipeline reel :

```txt
ticker
   v
[MCP] SEC EDGAR : ticker -> CIK -> 10-K/10-Q -> texte (HTML nettoye)
   v
Chunking (filtre anti-bruit XBRL, cap 120 chunks/doc)
   v
Embeddings Nebius (Qwen/Qwen3-Embedding-8B, dim 4096)
   v
Qdrant (mode local embarque, upsert idempotent par ticker)
   v
Recherche filtree par ticker
   v
Synthese SLM sourcee (Qwen3-235B-Instruct, NEBIUS_MODEL_RAG)
```

Technologies retenues :

- base vectorielle : **Qdrant** (mode local, chemin `data/qdrant`, sans serveur ;
  serveur possible via `QDRANT_URL`) ;
- embeddings : **Nebius** `Qwen/Qwen3-Embedding-8B` (`NEBIUS_EMBEDDING_MODEL`) ;
- synthese : modele instruct `Qwen/Qwen3-235B-A22B-Instruct-2507` (`NEBIUS_MODEL_RAG`,
  non-thinking ; alternative premium `deepseek-ai/DeepSeek-V4-Pro`).

Endpoints :

```txt
POST http://localhost:8000/agents/rag/MSFT/ingest?limit=2
GET  http://localhost:8000/agents/rag/MSFT/query?q=Quels sont les risques ?
GET  http://localhost:8000/agents/rag/MSFT/evaluation
POST http://localhost:3000/api/stocks/MSFT/rag/ingest
GET  http://localhost:3000/api/stocks/MSFT/rag/query?q=...
```

Config `.env` : `SEC_USER_AGENT` (contact requis par SEC), `NEBIUS_EMBEDDING_MODEL`,
`NEBIUS_MODEL_RAG`, `QDRANT_PATH` (defaut `data/qdrant`). Dependance : `qdrant-client`.

### Etape 7 - SynthesisAgent

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

### Etape 8 - Orchestrateur IA

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
  SocialSentimentAgent (quand implemente)

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
| **Tiingo** | Oui (genereux) | Historique EOD long (30+ ans), news | Integre : fallback historique entre yfinance et Twelve Data (`TIINGO_API_KEY`) |
| **Stooq** | Oui (sans cle) | Historique EOD en CSV | Abandonne : l'export CSV est desormais protege par un challenge anti-bot |
| **FRED (Fed St. Louis)** | Oui | Donnees macro (taux, inflation, chomage) | Moyenne : utile pour enrichir le RiskAgent avance |
| **GDELT** | Oui | Evenements mondiaux, tonalite media | Basse : NewsAgent avance |
| **Polygon.io** | Non (payant) | Donnees intraday/tick de qualite institutionnelle | Basse : seulement si besoin intraday serieux |

Remplacement a considerer : **yfinance est le maillon faible** (rate-limit
permanent, scraping non officiel). Tiingo (historique) + Finnhub (profil, quotes,
news) couvrent ensemble ce que yfinance apporte, avec de vraies APIs et des
quotas connus.

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

Le tableau de marche charge **tout l'univers US** via Finnhub (fallback FMP) avec pagination :

```txt
GET /api/stocks/market/dashboard?page=1&limit=50&search=AAPL
GET /api/stocks/us?search=JPM&limit=20
```

Raccourcis populaires pour les metriques : AAPL, MSFT, NVDA, TSLA, GOOGL, AMZN, META, JPM — mais **n'importe quel symbole US** est supporte par les agents.

## Decision actuelle

`MarketDataAgent`, `TechnicalAgent`, `NewsAgent`, `RiskAgent`, `RAGAgent` et
`SynthesisAgent` sont implementes. Le workflow complet est orchestre avec
LangGraph selon ce graphe :

```txt
MarketDataAgent ----> TechnicalAgent --\
NewsAgent ------------------------------> RiskAgent --> SynthesisAgent
RAGAgent -------------------------------/
```

Au demarrage, MarketDataAgent, NewsAgent et RAGAgent sont executes en parallele.
RiskAgent reutilise leurs resultats et celui de TechnicalAgent sans relancer les
APIs. SynthesisAgent applique une ponderation deterministe : technique 30%,
fondamental 25%, news 15% et maitrise du risque 30%. Le SLM peut reformuler le
resume, mais ne peut modifier ni les scores ni la recommandation.

Endpoints de validation :

```txt
GET /agents/synthesis/MSFT              # SynthesisAgent sans LangGraph
GET /analysis/MSFT                      # workflow LangGraph complet
GET /api/stocks/MSFT/synthesis          # via Gateway
GET /api/stocks/MSFT/full-analysis      # via Gateway + UI
```

La vue `Analyse IA` du frontend presente le score global, la confiance des
donnees, les scores par dimension, les risques documentes et la trace des six
agents. Les tests deterministes sont dans
`ai-backend/tests/test_synthesis_agent.py`.

La prochaine etape logique est de calibrer les ponderations sur un jeu de
validation historique, puis d'ajouter l'evaluation continue du SynthesisAgent.

`SocialSentimentAgent` est ajoute au planning comme evolution ulterieure :
il analysera Reddit/X comme signal social separe, avec un score de confiance
dedie, sans remplacer les news officielles.
