# Stock AI Assistant

Application d'analyse boursiere composee de quatre briques :

- `frontend/` : interface React + Vite.
- `gateway/` : API NestJS exposee au frontend.
- `ai-backend/` : backend FastAPI prepare pour LangChain.
- `mcp-server/` : serveur MCP pour futurs outils boursiers.

## Demarrage local

Creer un fichier `.env` a la racine avec la cle Twelve Data :

```bash
TWELVE_DATA_API_KEY=your_twelve_data_api_key_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key_here
FMP_API_KEY=your_financial_modeling_prep_api_key_here
OLLAMA_ENABLED=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
```

Depuis la racine :

```bash
docker compose up --build
```

Puis ouvrir :

- Frontend : http://localhost:5173
- Gateway health : http://localhost:3000/api/health
- Gateway Swagger : http://localhost:3000/api/docs
- AI backend health : http://localhost:8000/health
- AI backend Swagger : http://localhost:8000/docs

## Flux actuel

1. Le frontend demande une analyse a `/api/stocks/:ticker/analyze`.
2. Le gateway NestJS transmet au backend IA FastAPI.
3. Le backend IA interroge le serveur MCP.
4. Le serveur MCP interroge Twelve Data quand une cle API est disponible.
5. Le frontend affiche la salle des marches, les cotations, le brief, les positions et le simulateur.

## MarketDataAgent

Le premier agent validable est `MarketDataAgent`.

- Endpoint direct backend IA : http://localhost:8000/agents/market-data/AAPL
- Endpoint via gateway : http://localhost:3000/api/stocks/AAPL/market-data
- Endpoint MCP HTTP : http://localhost:4100/market-data/AAPL
- Test visuel via Swagger Gateway : http://localhost:3000/api/docs

Twelve Data fournit le prix live quand la cle API est disponible. `yfinance` complete l'agent avec historique, profil entreprise, ratios et resume des etats financiers. Alpha Vantage renforce les fondamentaux, le profil, les ratios et les etats financiers quand `yfinance` est limite. Financial Modeling Prep peut completer en priorite les etats financiers (`revenue`, `net_income`, `assets`, `debt`, `cashflow`) quand `FMP_API_KEY` est disponible.

`sources_used` liste uniquement les vraies sources externes (`twelve_data`, `yfinance`, `alpha_vantage`, `financial_modeling_prep`). Le champ `used_fallback` indique si une donnee de secours interne a ete utilisee.

### SLM local avec Ollama/Qwen

`MarketDataAgent` peut utiliser Ollama comme SLM optionnel pour produire `slm_summary`, un resume court et un controle qualite des donnees collectees. Le SLM ne remplace pas les APIs de marche et ne modifie aucun chiffre.

Exemple local :

```bash
ollama pull qwen2.5:3b
ollama serve
```

Puis lancer le backend IA avec :

```bash
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
```

Pour l'execution locale du serveur MCP hors Docker, installer aussi les dependances Python :

```bash
cd mcp-server
python -m pip install -r requirements.txt
```

## Tickers de demonstration

- `AAPL`
- `TSLA`
- `NVDA`

## Prochaines etapes

- Ajouter les prompts LangChain et la logique de scoring.
- Ajouter une base de donnees pour portefeuilles, alertes et historique.
- Etendre le serveur MCP avec des outils de prix, news, fondamentaux et analyse technique.
