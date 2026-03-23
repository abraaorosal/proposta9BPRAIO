# Dashboard CPRAIO

Painel web estático para comparação entre a estrutura atual e a proposta de redistribuição orgânica do CPRAIO.

## Como executar

No diretório do projeto, inicie um servidor HTTP local:

```bash
python3 -m http.server 8000
```

Depois acesse:

```text
http://127.0.0.1:8000
```

## Estrutura principal

- `index.html`: página única do dashboard.
- `assets/styles.css`: identidade visual, responsividade e componentes.
- `assets/app.js`: carga dos dados, transformação, filtros, KPIs, mapas e detalhamento.
- `vendor/leaflet/dist/`: Leaflet local para o mapa funcionar sem CDN.

## Fontes de dados vinculadas

- `Estrutura/Atual.json`: estrutura atual.
- `Estrutura/Proposta.json`: estrutura proposta.
- `Dados/ceara_municipios.geojson`: malha municipal do Ceará.
- `Dados/municipios.json`: coordenadas das localidades operacionais.
- `Dados/efetivo_21_03_2026.json`: efetivo por município.

## Logos

- `Logo/ceara_logo.png`
- `Logo/pmce_logo.png`
- `Logo/cpraio_logo.png`

## Customização rápida

- Cores dos batalhões: alterar `BATTALION_PALETTE` em `assets/app.js`.
- Cores e visual institucional: ajustar variáveis `:root` em `assets/styles.css`.
- Logos do cabeçalho: trocar os arquivos em `Logo/` ou atualizar os caminhos em `index.html`.
- Regras e notas de dados: ajustar as funções de transformação e integridade em `assets/app.js`.

## Observações sobre os dados atuais

- `Messejana` aparece na estrutura, mas não possui geometria municipal nem efetivo próprio nos arquivos disponíveis.

# proposta9BPRAIO
