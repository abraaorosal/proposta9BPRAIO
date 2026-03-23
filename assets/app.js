const FILES = {
  atual: "Estrutura/Atual.json",
  proposta: "Estrutura/Proposta.json",
  municipios: "Dados/municipios.json",
  efetivo: "Dados/efetivo_21_03_2026.json",
  geojson: "Dados/ceara_municipios.geojson",
};

const SCENARIO_META = {
  atual: {
    key: "atual",
    label: "Atual",
    summaryLabel: "Estrutura atual",
  },
  proposta: {
    key: "proposta",
    label: "Proposta",
    summaryLabel: "Estrutura proposta",
  },
};

const BATTALION_PALETTE = [
  "#12664f",
  "#1b7b62",
  "#2b6c8a",
  "#3d5b8f",
  "#8c6a1a",
  "#9d5a24",
  "#8b4b3c",
  "#5f7c38",
  "#574f8f",
];

const NON_TERRITORIAL_COMPANIES = new Set(["MOTOPOLICIAMENTO ORDINARIO"]);
const ROLE_PRIORITY = ["sede", "companhia", "pelotao"];
const PT_BR_NUMBER = new Intl.NumberFormat("pt-BR");

const state = {
  data: null,
  maps: {},
  mapSyncLock: false,
  toastTimer: null,
  filters: {
    scenario: "ambos",
    battalion: "all",
    company: "all",
    municipality: "all",
    unitType: "all",
    effectiveRange: "all",
  },
};

const elements = {
  coverageSummary: document.querySelector("#coverage-summary"),
  dataIntegrity: document.querySelector("#data-integrity"),
  overviewCards: document.querySelector("#overview-cards"),
  battalionCardGroups: document.querySelector("#battalion-card-groups"),
  filtersNote: document.querySelector("#filters-note"),
  comparisonBars: document.querySelector("#comparison-bars"),
  hierarchyPanel: document.querySelector("#hierarchy-panel"),
  scenarioFilter: document.querySelector("#scenario-filter"),
  battalionFilter: document.querySelector("#battalion-filter"),
  companyFilter: document.querySelector("#company-filter"),
  municipalityFilter: document.querySelector("#municipality-filter"),
  unitTypeFilter: document.querySelector("#unit-type-filter"),
  effectiveRangeFilter: document.querySelector("#effective-range-filter"),
  resetFilters: document.querySelector("#reset-filters"),
  mapSummaryAtual: document.querySelector("#map-summary-atual"),
  mapSummaryProposta: document.querySelector("#map-summary-proposta"),
  legendAtual: document.querySelector("#legend-atual"),
  legendProposta: document.querySelector("#legend-proposta"),
  toast: document.querySelector("#toast"),
  scenarioPanels: document.querySelectorAll("[data-scenario-panel]"),
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    handleFatalError(error);
  });
});

async function init() {
  const [atualStructure, propostaStructure, municipios, efetivo, geojson] = await Promise.all([
    fetchJson(FILES.atual),
    fetchJson(FILES.proposta),
    fetchJson(FILES.municipios),
    fetchJson(FILES.efetivo),
    fetchJson(FILES.geojson),
  ]);

  state.data = buildAppData({
    atualStructure,
    propostaStructure,
    municipios,
    efetivo,
    geojson,
  });

  populateFilterOptions();
  bindEvents();
  initializeMaps();
  syncFilterControls();
  renderDashboard({ fitInitialView: true });
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}`);
  }
  return response.json();
}

function buildAppData({ atualStructure, propostaStructure, municipios, efetivo, geojson }) {
  const lookups = buildLookups({ municipios, efetivo, geojson });
  const scenarios = {
    atual: buildScenarioData("atual", atualStructure, lookups),
    proposta: buildScenarioData("proposta", propostaStructure, lookups),
  };
  const coverage = buildCoverageSummary(scenarios, lookups);
  const options = buildOptionLists(scenarios, lookups);

  return {
    lookups,
    geojson,
    scenarios,
    coverage,
    options,
  };
}

function buildLookups({ municipios, efetivo, geojson }) {
  const municipalityByKey = new Map();
  const effectiveByKey = new Map();
  const canonicalByKey = new Map();
  const featureByKey = new Map();
  const allMunicipalityKeys = [];

  geojson.features.forEach((feature) => {
    const name = feature?.properties?.name || feature?.properties?.description;
    const key = normalizeValue(name);
    if (!key) {
      return;
    }
    canonicalByKey.set(key, name);
    featureByKey.set(key, feature);
    allMunicipalityKeys.push(key);
  });

  municipios.forEach((entry) => {
    const key = normalizeValue(entry.nome);
    municipalityByKey.set(key, { ...entry, key });
    if (!canonicalByKey.has(key)) {
      canonicalByKey.set(key, entry.nome);
    }
  });

  efetivo.forEach((entry) => {
    const key = normalizeValue(entry.municipio);
    effectiveByKey.set(key, Number(entry.efetivo));
  });

  return {
    municipalityByKey,
    effectiveByKey,
    canonicalByKey,
    featureByKey,
    allMunicipalityKeys,
  };
}

function buildScenarioData(scenarioKey, structure, lookups) {
  const meta = SCENARIO_META[scenarioKey];
  const recordRegistry = new Map();
  const battalions = [];
  const companies = [];
  const platoons = [];
  const specialUnits = [];

  structure.batalhoes.forEach((rawBattalion, battalionIndex) => {
    const battalionId = toSlug(rawBattalion.nome);
    const battalion = {
      id: battalionId,
      name: rawBattalion.nome,
      seatName: rawBattalion.sede,
      seatKey: normalizeValue(rawBattalion.sede),
      basesInformed: Number(rawBattalion.bases_informadas) || 0,
      color: getBattalionColor(rawBattalion.nome),
      companies: [],
      companyIds: [],
      localityKeys: [],
      numericOrder: parseBattalionOrder(rawBattalion.nome) || battalionIndex + 1,
    };

    const battalionSeat = ensureOperationalRecord(recordRegistry, rawBattalion.sede, {
      scenarioKey,
      battalionId,
      battalionName: rawBattalion.nome,
      battalionSeat: rawBattalion.sede,
      role: "sede",
      lookups,
    });
    pushUnique(battalion.localityKeys, battalionSeat.key);

    rawBattalion.companhias.forEach((rawCompany) => {
      const companyKey = normalizeValue(rawCompany.nome);
      const companyId = `${battalionId}-${toSlug(`${rawCompany.cia}-${rawCompany.nome}`)}`;
      const territorial = !NON_TERRITORIAL_COMPANIES.has(companyKey);
      const company = {
        id: companyId,
        name: rawCompany.nome,
        nameKey: companyKey,
        code: rawCompany.cia,
        battalionId,
        battalionName: rawBattalion.nome,
        battalionColor: battalion.color,
        territorial,
        seatKey: territorial ? normalizeValue(rawCompany.nome) : null,
        localityKeys: [],
        platoons: [],
      };

      if (territorial) {
        const companySeat = ensureOperationalRecord(recordRegistry, rawCompany.nome, {
          scenarioKey,
          battalionId,
          battalionName: rawBattalion.nome,
          battalionSeat: rawBattalion.sede,
          companyId,
          companyName: rawCompany.nome,
          companyCode: rawCompany.cia,
          role: "companhia",
          lookups,
        });
        pushUnique(company.localityKeys, companySeat.key);
        pushUnique(battalion.localityKeys, companySeat.key);
      } else {
        specialUnits.push({
          scenarioKey,
          type: "nao_territorial",
          name: rawCompany.nome,
          battalionId,
          battalionName: rawBattalion.nome,
          companyId,
          companyName: rawCompany.nome,
          companyCode: rawCompany.cia,
          note: "Unidade informada sem georreferenciamento territorial nos arquivos disponíveis.",
        });
      }

      rawCompany.pelotoes.forEach((platoonName) => {
        const platoonId = `${companyId}-${toSlug(platoonName)}`;
        const platoonRecord = ensureOperationalRecord(recordRegistry, platoonName, {
          scenarioKey,
          battalionId,
          battalionName: rawBattalion.nome,
          battalionSeat: rawBattalion.sede,
          companyId,
          companyName: rawCompany.nome,
          companyCode: rawCompany.cia,
          platoonId,
          platoonName,
          role: "pelotao",
          lookups,
        });

        const platoon = {
          id: platoonId,
          name: platoonName,
          key: platoonRecord.key,
          battalionId,
          battalionName: rawBattalion.nome,
          companyId,
          companyName: rawCompany.nome,
          companyCode: rawCompany.cia,
        };

        company.platoons.push(platoon);
        platoons.push(platoon);
        pushUnique(company.localityKeys, platoonRecord.key);
        pushUnique(battalion.localityKeys, platoonRecord.key);
      });

      battalion.companies.push(company);
      battalion.companyIds.push(companyId);
      companies.push(company);
    });

    battalions.push(battalion);
  });

  const records = [...recordRegistry.values()]
    .map((record) => finalizeRecord(record, lookups))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  const recordByKey = new Map(records.map((record) => [record.key, record]));

  battalions.forEach((battalion) => {
    battalion.records = battalion.localityKeys
      .map((key) => recordByKey.get(key))
      .filter(Boolean);
    battalion.companyCount = battalion.companies.length;
    battalion.platoonCount = battalion.companies.reduce((sum, company) => sum + company.platoons.length, 0);
    battalion.totalPolice = sumPolice(battalion.records);
    battalion.totalMunicipalities = new Set(
      battalion.records.filter((record) => record.isMappable).map((record) => record.key)
    ).size;
    battalion.missingLocalities = battalion.records
      .filter((record) => !record.isMappable)
      .map((record) => record.name);
  });

  companies.forEach((company) => {
    company.records = company.localityKeys
      .map((key) => recordByKey.get(key))
      .filter(Boolean);
    company.totalPolice = sumPolice(company.records);
    company.totalMunicipalities = new Set(
      company.records.filter((record) => record.isMappable).map((record) => record.key)
    ).size;
    company.platoonCount = company.platoons.length;
    company.missingLocalities = company.records
      .filter((record) => !record.isMappable)
      .map((record) => record.name);
  });

  return {
    ...meta,
    title: structure.titulo,
    subtitle: structure.subtitulo,
    battalions: battalions.sort((left, right) => left.numericOrder - right.numericOrder),
    companies,
    platoons,
    specialUnits,
    records,
    recordByKey,
    totalPolice: sumPolice(records),
    totalMunicipalities: new Set(records.filter((record) => record.isMappable).map((record) => record.key)).size,
  };
}

function ensureOperationalRecord(registry, name, context) {
  const key = normalizeValue(name);
  if (!key) {
    return null;
  }

  const effectiveByKey = context.lookups.effectiveByKey;
  const municipalityByKey = context.lookups.municipalityByKey;
  const featureByKey = context.lookups.featureByKey;

  let record = registry.get(key);
  if (!record) {
    record = {
      key,
      sourceName: name,
      scenarioKey: context.scenarioKey,
      battalionId: context.battalionId,
      battalionName: context.battalionName,
      battalionSeat: context.battalionSeat,
      companyId: context.companyId || null,
      companyName: context.companyName || null,
      companyCode: context.companyCode || null,
      platoonId: context.platoonId || null,
      platoonName: context.platoonName || null,
      roles: new Set(),
      policeCount: effectiveByKey.has(key) ? effectiveByKey.get(key) : null,
      coordinate: municipalityByKey.get(key) || null,
      hasCoordinate: municipalityByKey.has(key),
      hasGeometry: featureByKey.has(key),
      notes: [],
    };
    registry.set(key, record);
  }

  record.sourceName = record.sourceName || name;
  record.battalionId = record.battalionId || context.battalionId;
  record.battalionName = record.battalionName || context.battalionName;
  record.battalionSeat = record.battalionSeat || context.battalionSeat;
  record.companyId = record.companyId || context.companyId || null;
  record.companyName = record.companyName || context.companyName || null;
  record.companyCode = record.companyCode || context.companyCode || null;
  record.platoonId = record.platoonId || context.platoonId || null;
  record.platoonName = record.platoonName || context.platoonName || null;
  record.roles.add(context.role);

  return record;
}

function finalizeRecord(record, lookups) {
  const roles = [...record.roles].sort(
    (left, right) => ROLE_PRIORITY.indexOf(left) - ROLE_PRIORITY.indexOf(right)
  );
  const hasEffective = typeof record.policeCount === "number";
  const name = lookups.canonicalByKey.get(record.key) || record.sourceName;
  const notes = [];

  if (!record.hasGeometry) {
    notes.push("Sem geometria municipal no conjunto fornecido.");
  }
  if (!record.hasCoordinate) {
    notes.push("Sem coordenada própria no conjunto fornecido.");
  }
  if (!hasEffective) {
    notes.push("Efetivo não informado para esta localidade.");
  }

  return {
    ...record,
    name,
    roles,
    displayStatus: statusLabelForRoles(roles),
    roleSummary: roles.map(roleLabel).join(" / "),
    isMappable: record.hasGeometry && record.hasCoordinate,
    latitude: record.coordinate?.latitude ?? null,
    longitude: record.coordinate?.longitude ?? null,
    notes,
  };
}

function buildCoverageSummary(scenarios, lookups) {
  const current = scenarios.atual;
  const proposed = scenarios.proposta;

  const mappedUnion = new Set(
    [...current.records, ...proposed.records]
      .filter((record) => record.isMappable)
      .map((record) => record.key)
  );
  const currentOnly = current.records
    .filter((record) => record.isMappable && !proposed.recordByKey.has(record.key))
    .map((record) => record.name);
  const proposedOnly = proposed.records
    .filter((record) => record.isMappable && !current.recordByKey.has(record.key))
    .map((record) => record.name);
  const missingLocalities = uniqueStrings(
    [...current.records, ...proposed.records]
      .filter((record) => !record.isMappable)
      .map((record) => record.name)
  );

  return {
    totalMunicipalities: lookups.allMunicipalityKeys.length,
    mappedAcrossScenarios: mappedUnion.size,
    unassignedMunicipalities: lookups.allMunicipalityKeys.length - mappedUnion.size,
    currentMapped: current.records.filter((record) => record.isMappable).length,
    proposedMapped: proposed.records.filter((record) => record.isMappable).length,
    missingLocalities,
    currentOnly,
    proposedOnly,
    currentOnlyEffective: currentOnly.reduce((sum, name) => {
      const key = normalizeValue(name);
      return sum + (lookups.effectiveByKey.get(key) || 0);
    }, 0),
  };
}

function buildOptionLists(scenarios, lookups) {
  const battalionMap = new Map();
  const companyMap = new Map();
  const municipalityOptions = lookups.allMunicipalityKeys
    .map((key) => ({
      value: key,
      label: lookups.canonicalByKey.get(key) || key,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

  Object.values(scenarios).forEach((scenario) => {
    scenario.battalions.forEach((battalion) => {
      if (!battalionMap.has(battalion.id)) {
        battalionMap.set(battalion.id, {
          value: battalion.id,
          label: battalion.name,
          order: battalion.numericOrder,
        });
      }
    });

    scenario.companies.forEach((company) => {
      if (!companyMap.has(company.nameKey)) {
        companyMap.set(company.nameKey, {
          value: company.nameKey,
          label: company.territorial ? company.name : `${company.name} · sem georreferenciamento`,
          isTerritorial: company.territorial,
        });
      }
    });
  });

  return {
    battalions: [...battalionMap.values()].sort((left, right) => left.order - right.order),
    companies: [...companyMap.values()].sort((left, right) => left.label.localeCompare(right.label, "pt-BR")),
    municipalities: municipalityOptions,
  };
}

function populateFilterOptions() {
  const { battalions, companies, municipalities } = state.data.options;

  elements.battalionFilter.innerHTML = [
    `<option value="all">Todos os batalhões</option>`,
    ...battalions.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`),
  ].join("");

  elements.companyFilter.innerHTML = [
    `<option value="all">Todas as companhias</option>`,
    ...companies.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`),
  ].join("");

  elements.municipalityFilter.innerHTML = [
    `<option value="all">Todos os municípios</option>`,
    ...municipalities.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`),
  ].join("");
}

function bindEvents() {
  [
    elements.scenarioFilter,
    elements.battalionFilter,
    elements.companyFilter,
    elements.municipalityFilter,
    elements.unitTypeFilter,
    elements.effectiveRangeFilter,
  ].forEach((control) => {
    control.addEventListener("change", () => {
      state.filters = getFiltersFromControls();
      renderDashboard({ applyFocusFromFilters: true });
    });
  });

  elements.resetFilters.addEventListener("click", () => {
    state.filters = {
      scenario: "ambos",
      battalion: "all",
      company: "all",
      municipality: "all",
      unitType: "all",
      effectiveRange: "all",
    };
    syncFilterControls();
    renderDashboard({ fitInitialView: true });
  });

  document.body.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.dataset.action;
    if (action === "select-battalion") {
      setFiltersAndRender({ battalion: actionTarget.dataset.battalion });
      return;
    }

    if (action === "select-company") {
      setFiltersAndRender({ company: actionTarget.dataset.company });
      return;
    }

    if (action === "select-municipality") {
      setFiltersAndRender({ municipality: actionTarget.dataset.municipality });
      return;
    }

    if (action === "show-note") {
      showToast(actionTarget.dataset.note || "Sem georreferenciamento disponível para esta unidade.");
    }
  });
}

function initializeMaps() {
  state.maps.atual = createMapContext("map-atual", "atual");
  state.maps.proposta = createMapContext("map-proposta", "proposta");

  wireMapSync(state.maps.atual.map, state.maps.proposta.map);
  wireMapSync(state.maps.proposta.map, state.maps.atual.map);

  const statewideBounds = state.maps.atual.geoLayer.getBounds().pad(0.02);
  Object.values(state.maps).forEach((context) => {
    context.map.fitBounds(statewideBounds);
    context.map.setMaxBounds(statewideBounds.pad(0.28));
  });
}

function createMapContext(containerId, scenarioKey) {
  const map = L.map(containerId, {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
  });

  L.control.zoom({ position: "topright" }).addTo(map);

  const featureLayers = new Map();
  const geoLayer = L.geoJSON(state.data.geojson, {
    style: (feature) => getMunicipalityStyle(scenarioKey, feature),
    onEachFeature: (feature, layer) => {
      const key = normalizeValue(feature?.properties?.name);
      featureLayers.set(key, layer);

      layer.bindPopup(() => createMunicipalityPopup(scenarioKey, key), {
        className: "municipality-popup",
      });

      layer.on({
        mouseover: () => {
          layer.setStyle(getMunicipalityStyle(scenarioKey, feature, true));
          if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
            layer.bringToFront();
          }
        },
        mouseout: () => {
          layer.setStyle(getMunicipalityStyle(scenarioKey, feature));
        },
        click: () => {
          focusMunicipality(key);
        },
      });
    },
  }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);

  return {
    map,
    geoLayer,
    markerLayer,
    featureLayers,
    scenarioKey,
  };
}

function wireMapSync(sourceMap, targetMap) {
  sourceMap.on("moveend zoomend", () => {
    if (state.mapSyncLock) {
      return;
    }
    state.mapSyncLock = true;
    targetMap.setView(sourceMap.getCenter(), sourceMap.getZoom(), {
      animate: false,
    });
    state.mapSyncLock = false;
  });
}

function renderDashboard({ fitInitialView = false, applyFocusFromFilters = false } = {}) {
  const metricsByScenario = {
    atual: getScenarioMetrics("atual"),
    proposta: getScenarioMetrics("proposta"),
  };

  renderHeader(metricsByScenario);
  renderOverviewCards(metricsByScenario);
  renderBattalionCards(metricsByScenario);
  renderMapPanels(metricsByScenario);
  renderComparisonBars(metricsByScenario);
  renderHierarchy(metricsByScenario);
  renderFilterNotes();
  updateScenarioPanels();

  window.requestAnimationFrame(() => {
    Object.values(state.maps).forEach((context) => context.map.invalidateSize());
  });

  if (fitInitialView) {
    focusStatewide();
    return;
  }

  if (applyFocusFromFilters) {
    focusFromFilters();
  }
}

function renderHeader(metricsByScenario) {
  const coverage = state.data.coverage;
  elements.coverageSummary.textContent = `${coverage.mappedAcrossScenarios} municípios com vínculo operacional informado; ${coverage.unassignedMunicipalities} permanecem neutros por ausência de vínculo.`;

  const integrityPills = [
    {
      label: `${coverage.totalMunicipalities} municípios na malha estadual`,
      warn: false,
    },
    {
      label: `${coverage.currentMapped} municípios mapeados no cenário atual`,
      warn: false,
    },
    {
      label: `${coverage.proposedMapped} municípios mapeados na proposta`,
      warn: coverage.currentMapped !== coverage.proposedMapped,
    },
  ];

  if (coverage.missingLocalities.length) {
    integrityPills.push({
      label: `${coverage.missingLocalities.join(", ")} sem geometria municipal própria`,
      warn: true,
    });
  }

  elements.dataIntegrity.innerHTML = integrityPills
    .map(
      (pill) =>
        `<span class="integrity-pill${pill.warn ? " integrity-pill--warn" : ""}">${escapeHtml(pill.label)}</span>`
    )
    .join("");
}

function renderOverviewCards(metricsByScenario) {
  const activeScenarioKeys = getAnalyticsScenarioKeys();
  const definitions = [
    { key: "policeTotal", label: "Efetivo policial" },
    { key: "battalionCount", label: "Batalhões" },
    { key: "companyCount", label: "Companhias" },
    { key: "platoonCount", label: "Pelotões" },
    { key: "municipalityCount", label: "Municípios cobertos" },
  ];

  elements.overviewCards.innerHTML = definitions
    .map((definition) => {
      if (activeScenarioKeys.length === 1) {
        const scenarioKey = activeScenarioKeys[0];
        const metric = metricsByScenario[scenarioKey][definition.key];
        return `
          <article class="metric-card">
            <span class="metric-card__label">${escapeHtml(definition.label)}</span>
            <strong class="metric-card__value">${formatMetricValue(metric)}</strong>
            <div class="metric-card__row">
              <span class="metric-card__row-label">${escapeHtml(SCENARIO_META[scenarioKey].label)}</span>
              <span>${formatMetricValue(metric)}</span>
            </div>
          </article>
        `;
      }

      const atual = metricsByScenario.atual[definition.key];
      const proposta = metricsByScenario.proposta[definition.key];
      const delta = proposta - atual;
      const deltaClass = delta === 0 ? " is-neutral" : delta < 0 ? " is-negative" : "";

      return `
        <article class="metric-card">
          <span class="metric-card__label">${escapeHtml(definition.label)}</span>
          <strong class="metric-card__value">${formatMetricValue(atual)} / ${formatMetricValue(proposta)}</strong>
          <div class="metric-card__split">
            <div class="metric-card__row">
              <span class="metric-card__row-label">Atual</span>
              <span>${formatMetricValue(atual)}</span>
            </div>
            <div class="metric-card__row">
              <span class="metric-card__row-label">Proposta</span>
              <span>${formatMetricValue(proposta)}</span>
            </div>
          </div>
          <span class="metric-card__delta${deltaClass}">${formatDelta(delta)}</span>
        </article>
      `;
    })
    .join("");
}

function renderBattalionCards(metricsByScenario) {
  const activeScenarioKeys = getAnalyticsScenarioKeys();
  const html = activeScenarioKeys
    .map((scenarioKey) => {
      const scenario = state.data.scenarios[scenarioKey];
      const cards = scenario.battalions
        .map((battalion) => {
          const snapshot = getBattalionSnapshot(battalion, scenarioKey);
          if (!snapshot.hasMatch) {
            return "";
          }

          return `
            <button
              type="button"
              class="battalion-card${state.filters.battalion === battalion.id ? " is-active" : ""}"
              style="--card-accent:${battalion.color};"
              data-action="select-battalion"
              data-battalion="${battalion.id}"
            >
              <span class="battalion-card__scenario">${escapeHtml(scenario.label)}</span>
              <div>
                <h3>${escapeHtml(battalion.name)}</h3>
                <p class="battalion-card__seat">Sede: ${escapeHtml(battalion.seatName)}</p>
              </div>
              <div class="battalion-card__stats">
                <span>Policiais<strong>${formatMetricValue(snapshot.policeTotal)}</strong></span>
                <span>Companhias<strong>${formatMetricValue(snapshot.companyCount)}</strong></span>
                <span>Pelotões<strong>${formatMetricValue(snapshot.platoonCount)}</strong></span>
                <span>Municípios<strong>${formatMetricValue(snapshot.municipalityCount)}</strong></span>
              </div>
            </button>
          `;
        })
        .filter(Boolean)
        .join("");

      return `
        <section class="scenario-group">
          <div class="scenario-group__header">
            <h3>${escapeHtml(scenario.label)}</h3>
            <span class="mini-pill">${formatMetricValue(metricsByScenario[scenarioKey].battalionCount)} batalhões no recorte</span>
          </div>
          <div class="scenario-group__grid">
            ${cards || `<div class="empty-state">Nenhum batalhão corresponde aos filtros deste cenário.</div>`}
          </div>
        </section>
      `;
    })
    .join("");

  elements.battalionCardGroups.innerHTML = html;
}

function renderMapPanels(metricsByScenario) {
  ["atual", "proposta"].forEach((scenarioKey) => {
    const context = state.maps[scenarioKey];

    context.geoLayer.eachLayer((layer) => {
      layer.setStyle(getMunicipalityStyle(scenarioKey, layer.feature));
    });

    renderHeadquarterMarkers(scenarioKey);
    renderLegend(scenarioKey);
    renderMapSummary(scenarioKey, metricsByScenario[scenarioKey]);
  });
}

function renderHeadquarterMarkers(scenarioKey) {
  const scenario = state.data.scenarios[scenarioKey];
  const context = state.maps[scenarioKey];
  context.markerLayer.clearLayers();

  scenario.battalions.forEach((battalion) => {
    const seatRecord = scenario.recordByKey.get(battalion.seatKey);
    if (!seatRecord?.hasCoordinate) {
      return;
    }

    const snapshot = getBattalionSnapshot(battalion, scenarioKey);
    const marker = L.marker([seatRecord.latitude, seatRecord.longitude], {
      icon: createBattalionMarkerIcon(battalion),
      keyboard: true,
      opacity: snapshot.hasMatch ? 1 : 0.45,
    });

    marker.bindPopup(createBattalionPopup(scenarioKey, battalion), {
      className: "municipality-popup",
    });
    marker.on("click", () => {
      setFiltersAndRender({ battalion: battalion.id });
    });

    context.markerLayer.addLayer(marker);
  });
}

function renderLegend(scenarioKey) {
  const scenario = state.data.scenarios[scenarioKey];
  const target = scenarioKey === "atual" ? elements.legendAtual : elements.legendProposta;

  const items = scenario.battalions
    .map((battalion) => {
      const snapshot = getBattalionSnapshot(battalion, scenarioKey);
      const mutedStyle = snapshot.hasMatch ? "" : ` style="opacity:0.54;"`;
      return `
        <button
          type="button"
          class="legend__item${state.filters.battalion === battalion.id ? " is-active" : ""}"
          data-action="select-battalion"
          data-battalion="${battalion.id}"
          ${mutedStyle}
        >
          <span class="legend__swatch" style="background:${battalion.color};"></span>
          <span class="legend__label">${escapeHtml(battalion.name)}</span>
          <span class="legend__meta">${formatMetricValue(snapshot.municipalityCount)} mun.</span>
        </button>
      `;
    })
    .join("");

  target.innerHTML = items;
}

function renderMapSummary(scenarioKey, metrics) {
  const target = scenarioKey === "atual" ? elements.mapSummaryAtual : elements.mapSummaryProposta;
  target.innerHTML = [
    `<span class="mini-pill">${formatMetricValue(metrics.municipalityCount)} municípios</span>`,
    `<span class="mini-pill">${formatMetricValue(metrics.battalionCount)} batalhões</span>`,
    `<span class="mini-pill">${formatMetricValue(metrics.policeTotal)} policiais</span>`,
  ].join("");
}

function renderComparisonBars(metricsByScenario) {
  const activeScenarioKeys = getAnalyticsScenarioKeys();
  const battalionIds = uniqueStrings(
    activeScenarioKeys.flatMap((scenarioKey) =>
      metricsByScenario[scenarioKey].matchingBattalions.map((battalion) => battalion.id)
    )
  ).sort((left, right) => compareBattalionIds(left, right));

  if (!battalionIds.length) {
    elements.comparisonBars.innerHTML = `<div class="empty-state">Nenhum batalhão corresponde ao recorte atual.</div>`;
    return;
  }

  const maxPolice = Math.max(
    1,
    ...battalionIds.flatMap((battalionId) =>
      activeScenarioKeys.map((scenarioKey) => {
        const battalion = state.data.scenarios[scenarioKey].battalions.find((item) => item.id === battalionId);
        return battalion ? getBattalionSnapshot(battalion, scenarioKey).policeTotal : 0;
      })
    )
  );

  elements.comparisonBars.innerHTML = `
    <section class="comparison-group">
      ${battalionIds
        .map((battalionId) => {
          const battalionReference = findBattalionById(battalionId);
          const title = battalionReference?.name || battalionId;

          const bars = activeScenarioKeys
            .map((scenarioKey) => {
              const battalion = state.data.scenarios[scenarioKey].battalions.find((item) => item.id === battalionId);
              const snapshot = battalion ? getBattalionSnapshot(battalion, scenarioKey) : null;
              const value = snapshot?.policeTotal || 0;
              const width = `${Math.max(0, (value / maxPolice) * 100)}%`;
              const color = battalion?.color || "#b8c4ba";
              return `
                <div class="comparison-row__bar">
                  <span class="comparison-row__bar-label">${escapeHtml(SCENARIO_META[scenarioKey].label)}</span>
                  <div class="comparison-row__lane">
                    <div class="comparison-row__fill" style="--bar-color:${color}; width:${width};"></div>
                  </div>
                  <span class="comparison-row__value">${formatMetricValue(value)}</span>
                </div>
              `;
            })
            .join("");

          return `
            <div class="comparison-row">
              <div class="comparison-row__header">
                <button type="button" class="comparison-row__title" data-action="select-battalion" data-battalion="${battalionId}">
                  ${escapeHtml(title)}
                </button>
              </div>
              <div class="comparison-row__track">
                ${bars}
              </div>
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderHierarchy(metricsByScenario) {
  const activeScenarioKeys = getAnalyticsScenarioKeys();
  const sections = activeScenarioKeys
    .map((scenarioKey) => {
      const scenario = state.data.scenarios[scenarioKey];
      const battalionBlocks = scenario.battalions
        .map((battalion) => {
          const snapshot = getBattalionSnapshot(battalion, scenarioKey);
          if (!snapshot.hasMatch) {
            return "";
          }

          const companies = battalion.companies
            .map((company) => {
              if (!companyMatches(company, scenarioKey)) {
                return "";
              }

              const seatRecord = company.seatKey ? scenario.recordByKey.get(company.seatKey) : null;
              const visiblePlatoons = company.platoons.filter((platoon) => platoonMatches(platoon, scenarioKey));
              const companyNote = !company.territorial
                ? `data-action="show-note" data-note="A companhia ${escapeAttribute(
                    company.name
                  )} não possui georreferenciamento territorial nos arquivos disponíveis."`
                : `data-action="select-company" data-company="${company.nameKey}"`;

              const seatButton = company.territorial && seatRecord
                ? `
                  <button
                    type="button"
                    class="unit-button"
                    data-action="select-municipality"
                    data-municipality="${seatRecord.key}"
                  >
                    <span>
                      <strong>Sede da companhia</strong>
                      <span class="unit-button__meta">${escapeHtml(seatRecord.name)}</span>
                    </span>
                    <span class="unit-button__meta">${formatMetricValue(seatRecord.policeCount)}</span>
                  </button>
                `
                : `
                  <button
                    type="button"
                    class="unit-button is-disabled"
                    data-action="show-note"
                    data-note="A companhia ${escapeAttribute(company.name)} não possui referência territorial própria nos arquivos."
                  >
                    <span>
                      <strong>Unidade não territorial</strong>
                      <span class="unit-button__meta">${escapeHtml(company.name)}</span>
                    </span>
                    <span class="unit-button__meta">Sem mapa</span>
                  </button>
                `;

              const platoonButtons = visiblePlatoons
                .map((platoon) => {
                  const record = scenario.recordByKey.get(platoon.key);
                  if (!record?.isMappable) {
                    return `
                      <button
                        type="button"
                        class="unit-button is-disabled"
                        data-action="show-note"
                        data-note="A unidade ${escapeAttribute(platoon.name)} consta na estrutura, mas não possui geometria municipal própria."
                      >
                        <span>
                          <strong>Pelotão</strong>
                          <span class="unit-button__meta">${escapeHtml(platoon.name)}</span>
                        </span>
                        <span class="unit-button__meta">Sem mapa</span>
                      </button>
                    `;
                  }

                  return `
                    <button
                      type="button"
                      class="unit-button"
                      data-action="select-municipality"
                      data-municipality="${record.key}"
                    >
                      <span>
                        <strong>Pelotão</strong>
                        <span class="unit-button__meta">${escapeHtml(record.name)}</span>
                      </span>
                      <span class="unit-button__meta">${formatMetricValue(record.policeCount)}</span>
                    </button>
                  `;
                })
                .join("");

              return `
                <div class="company-card">
                  <button type="button" class="company-card__head" ${companyNote}>
                    <span>
                      <strong>${escapeHtml(company.code)} · ${escapeHtml(company.name)}</strong>
                      <span class="unit-button__meta">${company.territorial ? "Companhia territorial" : "Companhia não territorial"}</span>
                    </span>
                    <span class="unit-button__meta">${formatMetricValue(company.totalPolice)} policiais</span>
                  </button>
                  <div class="company-card__body">
                    ${seatButton}
                    ${platoonButtons || ""}
                  </div>
                </div>
              `;
            })
            .filter(Boolean)
            .join("");

          return `
            <details class="hierarchy-node" ${state.filters.battalion === battalion.id || activeScenarioKeys.length === 1 ? "open" : ""}>
              <summary>
                <div class="hierarchy-node__summary">
                  <div class="hierarchy-node__title">
                    <strong>${escapeHtml(battalion.name)}</strong>
                    <span class="mini-pill">${formatMetricValue(snapshot.policeTotal)} policiais</span>
                  </div>
                  <div class="hierarchy-node__meta">
                    <span class="mini-pill">${formatMetricValue(snapshot.companyCount)} companhias</span>
                    <span class="mini-pill">${formatMetricValue(snapshot.platoonCount)} pelotões</span>
                    <span class="mini-pill">${formatMetricValue(snapshot.municipalityCount)} municípios</span>
                  </div>
                </div>
              </summary>
              <div class="hierarchy-node__body">
                ${companies || `<div class="empty-state">Sem companhias visíveis com os filtros atuais.</div>`}
              </div>
            </details>
          `;
        })
        .filter(Boolean)
        .join("");

      return `
        <section class="hierarchy-scenario">
          <h4>${escapeHtml(scenario.label)}</h4>
          ${battalionBlocks || `<div class="empty-state">Nenhuma unidade visível neste cenário.</div>`}
        </section>
      `;
    })
    .join("");

  elements.hierarchyPanel.innerHTML = sections;
}

function renderFilterNotes() {
  const coverage = state.data.coverage;
  const notes = [
    {
      label: `${coverage.unassignedMunicipalities} municípios do Ceará aparecem em cinza por não terem vínculo operacional informado nos arquivos enviados.`,
      className: "",
    },
  ];

  if (coverage.missingLocalities.length) {
    notes.push({
      label: `${coverage.missingLocalities.join(", ")} consta na estrutura, mas não possui geometria municipal nem efetivo próprios no conjunto de dados.`,
      className: " note-pill--warn",
    });
  }

  if (coverage.currentOnly.length) {
    notes.push({
      label: `${coverage.currentOnly.join(", ")} aparece apenas na estrutura atual. Na proposta, esse território fica sem vínculo informado, produzindo diferença bruta de ${formatMetricValue(
        coverage.currentOnlyEffective
      )} policiais.`,
      className: " note-pill--danger",
    });
  }

  const municipalityKey = state.filters.municipality;
  if (municipalityKey !== "all") {
    const municipalityName = state.data.lookups.canonicalByKey.get(municipalityKey) || municipalityKey;
    const unavailableIn = getAnalyticsScenarioKeys().filter(
      (scenarioKey) => !state.data.scenarios[scenarioKey].recordByKey.has(municipalityKey)
    );
    if (unavailableIn.length) {
      notes.push({
        label: `${municipalityName} não possui vínculo operacional informado em ${unavailableIn
          .map((scenarioKey) => SCENARIO_META[scenarioKey].label.toLowerCase())
          .join(" e ")}.`,
        className: " note-pill--warn",
      });
    }
  }

  const companyKey = state.filters.company;
  if (companyKey !== "all") {
    const company = state.data.options.companies.find((item) => item.value === companyKey);
    if (company && !company.isTerritorial) {
      notes.push({
        label: `${company.label} é uma unidade sem referência territorial própria para exibição cartográfica.`,
        className: " note-pill--warn",
      });
    }
  }

  elements.filtersNote.innerHTML = notes
    .map((note) => `<span class="note-pill${note.className}">${escapeHtml(note.label)}</span>`)
    .join("");
}

function updateScenarioPanels() {
  const activeScenarioKeys = getAnalyticsScenarioKeys();
  elements.scenarioPanels.forEach((panel) => {
    const scenario = panel.dataset.scenarioPanel;
    panel.classList.toggle("is-inactive", !activeScenarioKeys.includes(scenario));
  });
}

function getScenarioMetrics(scenarioKey) {
  const scenario = state.data.scenarios[scenarioKey];
  const filters = state.filters;
  const matchingRecords = scenario.records.filter((record) => recordMatches(record, scenarioKey));
  const matchingCompanies = scenario.companies.filter((company) => companyMatches(company, scenarioKey));
  const matchingPlatoons = scenario.platoons.filter((platoon) => platoonMatches(platoon, scenarioKey));
  const matchingBattalions = scenario.battalions.filter((battalion) => getBattalionSnapshot(battalion, scenarioKey).hasMatch);

  const matchingUnassignedKeys =
    filters.unitType === "sem_vinculo"
      ? state.data.options.municipalities
          .map((option) => option.value)
          .filter((key) => unassignedMunicipalityMatches(scenarioKey, key))
      : [];

  return {
    policeTotal:
      filters.unitType === "sem_vinculo"
        ? matchingUnassignedKeys.reduce(
            (sum, key) => sum + (state.data.lookups.effectiveByKey.get(key) || 0),
            0
          )
        : sumPolice(matchingRecords),
    battalionCount: filters.unitType === "sem_vinculo" ? 0 : matchingBattalions.length,
    companyCount: filters.unitType === "sem_vinculo" ? 0 : matchingCompanies.length,
    platoonCount: filters.unitType === "sem_vinculo" ? 0 : matchingPlatoons.length,
    municipalityCount:
      filters.unitType === "sem_vinculo"
        ? matchingUnassignedKeys.length
        : new Set(matchingRecords.filter((record) => record.isMappable).map((record) => record.key)).size,
    matchingBattalions,
  };
}

function getBattalionSnapshot(battalion, scenarioKey) {
  const matchingRecords = battalion.records.filter((record) => recordMatches(record, scenarioKey));
  const matchingCompanies = battalion.companies.filter((company) => companyMatches(company, scenarioKey));
  const matchingPlatoons = battalion.companies.flatMap((company) =>
    company.platoons.filter((platoon) => platoonMatches(platoon, scenarioKey))
  );

  return {
    hasMatch: matchingRecords.length > 0 || matchingCompanies.length > 0,
    policeTotal: sumPolice(matchingRecords),
    companyCount: matchingCompanies.length,
    platoonCount: matchingPlatoons.length,
    municipalityCount: new Set(
      matchingRecords.filter((record) => record.isMappable).map((record) => record.key)
    ).size,
  };
}

function companyMatches(company, scenarioKey) {
  const filters = state.filters;
  const scenario = state.data.scenarios[scenarioKey];

  if (filters.battalion !== "all" && company.battalionId !== filters.battalion) {
    return false;
  }
  if (filters.company !== "all" && company.nameKey !== filters.company) {
    return false;
  }

  if (!company.territorial) {
    if (filters.municipality !== "all") {
      return false;
    }
    if (filters.effectiveRange !== "all") {
      return false;
    }
    return filters.unitType === "all" || filters.unitType === "nao_territorial";
  }

  const seatRecord = company.seatKey ? scenario.recordByKey.get(company.seatKey) : null;

  if (filters.unitType === "nao_territorial") {
    return false;
  }
  if (filters.unitType === "sem_vinculo") {
    return false;
  }
  if (filters.unitType === "companhia") {
    return Boolean(seatRecord?.roles.includes("companhia") && recordMatchesIgnoringUnitType(seatRecord));
  }
  if (filters.unitType === "sede") {
    return Boolean(seatRecord?.roles.includes("sede") && recordMatchesIgnoringUnitType(seatRecord));
  }
  if (filters.unitType === "pelotao") {
    return company.platoons.some((platoon) => platoonMatches(platoon, scenarioKey));
  }

  return company.records.some((record) => recordMatchesIgnoringUnitType(record));
}

function platoonMatches(platoon, scenarioKey) {
  const scenario = state.data.scenarios[scenarioKey];
  const record = scenario.recordByKey.get(platoon.key);
  if (!record) {
    return false;
  }

  const filters = state.filters;
  if (filters.battalion !== "all" && platoon.battalionId !== filters.battalion) {
    return false;
  }
  if (filters.company !== "all" && normalizeValue(platoon.companyName) !== filters.company) {
    return false;
  }
  if (filters.municipality !== "all" && record.key !== filters.municipality) {
    return false;
  }
  if (!matchesEffectiveRange(record.policeCount, filters.effectiveRange)) {
    return false;
  }
  if (filters.unitType === "nao_territorial" || filters.unitType === "sem_vinculo") {
    return false;
  }
  return filters.unitType === "all" || filters.unitType === "pelotao";
}

function recordMatches(record, scenarioKey) {
  if (!record) {
    return false;
  }

  const filters = state.filters;
  if (filters.battalion !== "all" && record.battalionId !== filters.battalion) {
    return false;
  }
  if (filters.company !== "all" && normalizeValue(record.companyName || "") !== filters.company) {
    return false;
  }
  if (filters.municipality !== "all" && record.key !== filters.municipality) {
    return false;
  }
  if (!matchesEffectiveRange(record.policeCount, filters.effectiveRange)) {
    return false;
  }
  if (filters.unitType === "all") {
    return true;
  }
  if (filters.unitType === "nao_territorial" || filters.unitType === "sem_vinculo") {
    return false;
  }
  return record.roles.includes(filters.unitType);
}

function recordMatchesIgnoringUnitType(record) {
  if (!record) {
    return false;
  }

  const filters = state.filters;
  if (filters.battalion !== "all" && record.battalionId !== filters.battalion) {
    return false;
  }
  if (filters.company !== "all" && normalizeValue(record.companyName || "") !== filters.company) {
    return false;
  }
  if (filters.municipality !== "all" && record.key !== filters.municipality) {
    return false;
  }
  return matchesEffectiveRange(record.policeCount, filters.effectiveRange);
}

function unassignedMunicipalityMatches(scenarioKey, key) {
  const filters = state.filters;
  const scenario = state.data.scenarios[scenarioKey];

  if (scenario.recordByKey.has(key)) {
    return false;
  }
  if (filters.battalion !== "all" || filters.company !== "all") {
    return false;
  }
  if (filters.municipality !== "all" && filters.municipality !== key) {
    return false;
  }
  return matchesEffectiveRange(state.data.lookups.effectiveByKey.get(key), filters.effectiveRange);
}

function renderMunicipalityPopupContent({ title, status, battalion, company, police, scenarioLabel, note }) {
  return `
    <div class="popup-card">
      <span class="popup-card__badge">${escapeHtml(scenarioLabel)}</span>
      <h4>${escapeHtml(title)}</h4>
      <div class="popup-card__grid">
        <div class="popup-card__row"><span>Status</span><strong>${escapeHtml(status)}</strong></div>
        <div class="popup-card__row"><span>Batalhão</span><strong>${escapeHtml(battalion)}</strong></div>
        <div class="popup-card__row"><span>Companhia</span><strong>${escapeHtml(company)}</strong></div>
        <div class="popup-card__row"><span>Policiais</span><strong>${escapeHtml(police)}</strong></div>
      </div>
      ${note ? `<div class="unit-button__meta">${escapeHtml(note)}</div>` : ""}
    </div>
  `;
}

function createMunicipalityPopup(scenarioKey, key) {
  const scenario = state.data.scenarios[scenarioKey];
  const record = scenario.recordByKey.get(key);
  const title = state.data.lookups.canonicalByKey.get(key) || key;
  const police = record
    ? formatMetricValue(record.policeCount)
    : formatMetricValue(state.data.lookups.effectiveByKey.get(key) ?? null);

  if (!record) {
    return renderMunicipalityPopupContent({
      title,
      status: "Sem vínculo informado",
      battalion: "Sem vínculo informado",
      company: "Sem vínculo informado",
      police,
      scenarioLabel: scenario.label,
      note: "O município está na base cartográfica, mas não possui subordinação operacional informada neste cenário.",
    });
  }

  return renderMunicipalityPopupContent({
    title,
    status: record.displayStatus,
    battalion: record.battalionName,
    company: record.companyName ? `${record.companyCode} · ${record.companyName}` : "Não aplicável",
    police,
    scenarioLabel: scenario.label,
    note: record.notes.join(" "),
  });
}

function createBattalionPopup(scenarioKey, battalion) {
  const snapshot = getBattalionSnapshot(battalion, scenarioKey);
  return `
    <div class="popup-card">
      <span class="popup-card__badge">${escapeHtml(SCENARIO_META[scenarioKey].label)}</span>
      <h4>${escapeHtml(battalion.name)}</h4>
      <div class="popup-card__grid">
        <div class="popup-card__row"><span>Sede</span><strong>${escapeHtml(battalion.seatName)}</strong></div>
        <div class="popup-card__row"><span>Policiais</span><strong>${formatMetricValue(snapshot.policeTotal)}</strong></div>
        <div class="popup-card__row"><span>Companhias</span><strong>${formatMetricValue(snapshot.companyCount)}</strong></div>
        <div class="popup-card__row"><span>Pelotões</span><strong>${formatMetricValue(snapshot.platoonCount)}</strong></div>
        <div class="popup-card__row"><span>Municípios</span><strong>${formatMetricValue(snapshot.municipalityCount)}</strong></div>
      </div>
    </div>
  `;
}

function createBattalionMarkerIcon(battalion) {
  return L.divIcon({
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -16],
    html: `
      <div class="raio-marker" style="--marker-color:${battalion.color};">
        <span class="raio-marker__ring"></span>
        <img src="Logo/cpraio_logo.png" alt="">
      </div>
    `,
  });
}

function getMunicipalityStyle(scenarioKey, feature, hovered = false) {
  const key = normalizeValue(feature?.properties?.name);
  const scenario = state.data.scenarios[scenarioKey];
  const record = scenario.recordByKey.get(key);
  const selectedMunicipality = state.filters.municipality === key;
  const isUnassigned = unassignedMunicipalityMatches(scenarioKey, key);

  if (record) {
    const matches = recordMatches(record, scenarioKey);
    const color = getBattalionColor(record.battalionName);
    if (matches) {
      return {
        color: hovered ? "#102216" : "#f5f4ef",
        weight: hovered ? 2.2 : 1.1,
        opacity: 0.95,
        fillColor: color,
        fillOpacity: hovered ? 0.9 : 0.78,
      };
    }

    return {
      color: selectedMunicipality ? "#9a6e12" : "rgba(16,34,22,0.2)",
      weight: selectedMunicipality ? 1.8 : 0.8,
      opacity: selectedMunicipality ? 0.88 : 0.45,
      fillColor: color,
      fillOpacity: 0.18,
    };
  }

  if (isUnassigned || selectedMunicipality) {
    return {
      color: "#9a6e12",
      weight: hovered ? 2.1 : 1.7,
      opacity: 0.95,
      fillColor: "#d9c78d",
      fillOpacity: hovered ? 0.68 : 0.56,
      dashArray: "6 4",
    };
  }

  return {
    color: hovered ? "rgba(16,34,22,0.42)" : "rgba(16,34,22,0.18)",
    weight: hovered ? 1.2 : 0.8,
    opacity: 0.72,
    fillColor: "#dbe4d7",
    fillOpacity: state.filters.unitType === "sem_vinculo" ? 0.24 : 0.44,
  };
}

function focusFromFilters() {
  if (state.filters.municipality !== "all") {
    focusMunicipality(state.filters.municipality);
    return;
  }
  if (state.filters.battalion !== "all") {
    focusBattalion(state.filters.battalion);
    return;
  }
  if (state.filters.company !== "all") {
    focusCompany(state.filters.company);
  }
}

function focusStatewide() {
  const bounds = state.maps.atual.geoLayer.getBounds().pad(0.02);
  fitAllMaps(bounds);
}

function focusMunicipality(key) {
  const layer = state.maps.atual.featureLayers.get(key) || state.maps.proposta.featureLayers.get(key);
  if (!layer) {
    showToast("A localidade selecionada não possui geometria municipal disponível.");
    return;
  }
  fitAllMaps(layer.getBounds().pad(0.42));
}

function focusBattalion(battalionId) {
  let keys = collectBattalionKeys(battalionId, getAnalyticsScenarioKeys());
  if (!keys.length) {
    keys = collectBattalionKeys(battalionId, ["atual", "proposta"]);
  }
  const bounds = buildBoundsFromKeys(keys);
  if (!bounds) {
    showToast("O batalhão selecionado não possui base cartográfica suficiente para enquadramento.");
    return;
  }
  fitAllMaps(bounds.pad(0.22));
}

function focusCompany(companyKey) {
  let keys = collectCompanyKeys(companyKey, getAnalyticsScenarioKeys());
  if (!keys.length) {
    keys = collectCompanyKeys(companyKey, ["atual", "proposta"]);
  }
  const bounds = buildBoundsFromKeys(keys);
  if (!bounds) {
    showToast("A companhia selecionada não possui geometria municipal própria nos dados.");
    return;
  }
  fitAllMaps(bounds.pad(0.3));
}

function collectBattalionKeys(battalionId, scenarioKeys) {
  return uniqueStrings(
    scenarioKeys.flatMap((scenarioKey) => {
      const battalion = state.data.scenarios[scenarioKey].battalions.find((item) => item.id === battalionId);
      return battalion
        ? battalion.records.filter((record) => record.isMappable).map((record) => record.key)
        : [];
    })
  );
}

function collectCompanyKeys(companyKey, scenarioKeys) {
  return uniqueStrings(
    scenarioKeys.flatMap((scenarioKey) =>
      state.data.scenarios[scenarioKey].companies
        .filter((company) => company.nameKey === companyKey)
        .flatMap((company) => company.records.filter((record) => record.isMappable).map((record) => record.key))
    )
  );
}

function buildBoundsFromKeys(keys) {
  let bounds = null;
  keys.forEach((key) => {
    const layer = state.maps.atual.featureLayers.get(key) || state.maps.proposta.featureLayers.get(key);
    if (!layer) {
      return;
    }
    bounds = bounds ? bounds.extend(layer.getBounds()) : layer.getBounds();
  });
  return bounds;
}

function fitAllMaps(bounds) {
  if (!bounds) {
    return;
  }
  state.mapSyncLock = true;
  Object.values(state.maps).forEach((context) => {
    context.map.fitBounds(bounds, { animate: false });
  });
  state.mapSyncLock = false;
}

function setFiltersAndRender(partialFilters) {
  state.filters = {
    ...state.filters,
    ...partialFilters,
  };
  syncFilterControls();
  renderDashboard({ applyFocusFromFilters: true });
}

function syncFilterControls() {
  elements.scenarioFilter.value = state.filters.scenario;
  elements.battalionFilter.value = state.filters.battalion;
  elements.companyFilter.value = state.filters.company;
  elements.municipalityFilter.value = state.filters.municipality;
  elements.unitTypeFilter.value = state.filters.unitType;
  elements.effectiveRangeFilter.value = state.filters.effectiveRange;
}

function getFiltersFromControls() {
  return {
    scenario: elements.scenarioFilter.value,
    battalion: elements.battalionFilter.value,
    company: elements.companyFilter.value,
    municipality: elements.municipalityFilter.value,
    unitType: elements.unitTypeFilter.value,
    effectiveRange: elements.effectiveRangeFilter.value,
  };
}

function getAnalyticsScenarioKeys() {
  if (state.filters.scenario === "atual") {
    return ["atual"];
  }
  if (state.filters.scenario === "proposta") {
    return ["proposta"];
  }
  return ["atual", "proposta"];
}

function matchesEffectiveRange(value, rangeKey) {
  if (rangeKey === "all") {
    return true;
  }
  if (typeof value !== "number") {
    return false;
  }
  if (rangeKey === "0-24") {
    return value >= 0 && value <= 24;
  }
  if (rangeKey === "25-49") {
    return value >= 25 && value <= 49;
  }
  if (rangeKey === "50-99") {
    return value >= 50 && value <= 99;
  }
  if (rangeKey === "100+") {
    return value >= 100;
  }
  return true;
}

function getBattalionColor(name) {
  const order = parseBattalionOrder(name);
  return BATTALION_PALETTE[Math.max(0, order - 1)] || BATTALION_PALETTE[0];
}

function parseBattalionOrder(name) {
  const match = String(name).match(/^(\d+)/);
  return match ? Number(match[1]) : 1;
}

function compareBattalionIds(left, right) {
  return parseBattalionOrder(left) - parseBattalionOrder(right);
}

function findBattalionById(battalionId) {
  return (
    state.data.scenarios.atual.battalions.find((item) => item.id === battalionId) ||
    state.data.scenarios.proposta.battalions.find((item) => item.id === battalionId) ||
    null
  );
}

function formatMetricValue(value) {
  return typeof value === "number" ? PT_BR_NUMBER.format(value) : "Não informado";
}

function formatDelta(delta) {
  if (delta === 0) {
    return "Sem variação";
  }
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${PT_BR_NUMBER.format(delta)}`;
}

function sumPolice(records) {
  return records.reduce((sum, record) => {
    if (typeof record.policeCount === "number") {
      return sum + record.policeCount;
    }
    return sum;
  }, 0);
}

function normalizeValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toSlug(value) {
  return normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roleLabel(role) {
  if (role === "sede") {
    return "Sede";
  }
  if (role === "companhia") {
    return "Companhia";
  }
  if (role === "pelotao") {
    return "Pelotão";
  }
  return role;
}

function statusLabelForRoles(roles) {
  if (roles.includes("sede")) {
    return "Sede";
  }
  if (roles.includes("companhia")) {
    return "Companhia";
  }
  if (roles.includes("pelotao")) {
    return "Pelotão";
  }
  return "Sem vínculo informado";
}

function pushUnique(collection, value) {
  if (!collection.includes(value)) {
    collection.push(value);
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3600);
}

function handleFatalError(error) {
  const message = error instanceof Error ? error.message : "Falha ao inicializar o dashboard.";
  elements.overviewCards.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.battalionCardGroups.innerHTML = `<div class="empty-state">Não foi possível montar o painel.</div>`;
  elements.comparisonBars.innerHTML = `<div class="empty-state">Erro ao carregar os dados.</div>`;
  elements.hierarchyPanel.innerHTML = `<div class="empty-state">Erro ao carregar os dados.</div>`;
}
