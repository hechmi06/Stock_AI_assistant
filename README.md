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
```

Depuis la racine :

```bash
docker compose up --build
```

Puis ouvrir :

- Frontend : http://localhost:5173
- Gateway health : http://localhost:3000/api/health
- AI backend health : http://localhost:8000/health

## Flux actuel

1. Le frontend demande une analyse a `/api/stocks/:ticker/analyze`.
2. Le gateway NestJS transmet au backend IA FastAPI.
3. Le backend IA interroge le serveur MCP.
4. Le serveur MCP interroge Twelve Data quand une cle API est disponible.
5. Le frontend affiche la salle des marches, les cotations, le brief, les positions et le simulateur.

## Tickers de demonstration

- `AAPL`
- `TSLA`
- `NVDA`

## Prochaines etapes

- Ajouter les prompts LangChain et la logique de scoring.
- Ajouter une base de donnees pour portefeuilles, alertes et historique.
- Etendre le serveur MCP avec des outils de prix, news, fondamentaux et analyse technique.
