// CarbonIQ single-page emissions workspace
let appData = null;
let emissionsChart = null;
let historyChart = null;
let monthlyChart = null;
let toastTimer = null;
let currentView = 'overview';
let currentInputs = null;
let latestResult = null;
let cementLookup = new Map();
let electricityLookup = new Map();

const DEFAULTS = {
    clinker: 0.750,
    coal: 12.5,
    altfuel: 15.0,
    output: 1000,
    mwh: 115.0,
    renew: 16.5,
    grid: 0.715
};

const VIEW_LABELS = {
    overview: 'Total overview',
    cement: 'Cement emissions',
    electricity: 'Electricity emissions'
};

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initNavigation();
    initCalculator();
    initHistoryControls();
    loadInitialData();
    loadDbHistory();
});

// ==========================================
// Authentication
// ==========================================
function initAuth() {
    const authModal = document.getElementById('auth-modal');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const tabLoginBtn = document.getElementById('tab-login-btn');
    const tabSignupBtn = document.getElementById('tab-signup-btn');
    const authTitle = document.getElementById('auth-title');
    const authError = document.getElementById('auth-error-msg');
    const logoutBtn = document.getElementById('logout-btn');

    if (!authModal || !loginForm || !signupForm) return;

    const setAuthMode = (mode) => {
        const isLogin = mode === 'login';
        tabLoginBtn.classList.toggle('active', isLogin);
        tabSignupBtn.classList.toggle('active', !isLogin);
        tabLoginBtn.setAttribute('aria-selected', String(isLogin));
        tabSignupBtn.setAttribute('aria-selected', String(!isLogin));
        loginForm.classList.toggle('active', isLogin);
        signupForm.classList.toggle('active', !isLogin);
        authTitle.textContent = isLogin ? 'Welcome back' : 'Create your account';
        authError.hidden = true;
    };

    const setAuthError = (message) => {
        authError.textContent = message;
        authError.hidden = !message;
    };

    const setAuthBusy = (button, busy, label) => {
        if (!button) return;
        if (busy) {
            button.dataset.originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${label}`;
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalHtml || button.innerHTML;
        }
    };

    tabLoginBtn.addEventListener('click', () => setAuthMode('login'));
    tabSignupBtn.addEventListener('click', () => setAuthMode('signup'));

    fetch('/api/auth/status')
        .then(response => {
            if (!response.ok) throw new Error('Auth status unavailable');
            return response.json();
        })
        .then(data => {
            if (data.logged_in) {
                updateUser(data.username, data.role);
                authModal.classList.add('hidden');
            }
        })
        .catch(() => {
            const saved = sessionStorage.getItem('carboniq_user');
            if (!saved) return;
            try {
                const user = JSON.parse(saved);
                updateUser(user.name, user.role);
                authModal.classList.add('hidden');
            } catch (error) {
                sessionStorage.removeItem('carboniq_user');
            }
        });

    loginForm.addEventListener('submit', async event => {
        event.preventDefault();
        const submitButton = document.getElementById('login-submit-btn');
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();

        if (!username || !password) {
            setAuthError('Enter both your username and password.');
            return;
        }

        setAuthBusy(submitButton, true, 'Signing in…');
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || 'Invalid username or password.');

            updateUser(data.username, data.role);
            sessionStorage.setItem('carboniq_user', JSON.stringify({ name: data.username, role: data.role }));
            authModal.classList.add('hidden');
            setAuthError('');
            loadDbHistory();
        } catch (error) {
            setAuthError(error.message || 'Could not connect to the server.');
        } finally {
            setAuthBusy(submitButton, false);
        }
    });

    signupForm.addEventListener('submit', async event => {
        event.preventDefault();
        const submitButton = document.getElementById('reg-submit-btn');
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value.trim();
        const role = document.getElementById('reg-role').value;

        if (!username || !password) {
            setAuthError('Choose a username and create a password.');
            return;
        }

        setAuthBusy(submitButton, true, 'Creating account…');
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, role })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || 'Account creation failed.');

            updateUser(data.username, data.role);
            sessionStorage.setItem('carboniq_user', JSON.stringify({ name: data.username, role: data.role }));
            authModal.classList.add('hidden');
            setAuthError('');
            loadDbHistory();
        } catch (error) {
            setAuthError(error.message || 'Could not connect to the server.');
        } finally {
            setAuthBusy(submitButton, false);
        }
    });

    logoutBtn?.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
            // The local session is still cleared when the server is unavailable.
        }
        sessionStorage.removeItem('carboniq_user');
        authModal.classList.remove('hidden');
    });
}

function updateUser(username = 'operator', role = 'Plant team') {
    const safeName = username || 'operator';
    const safeRole = role || 'Plant team';
    const initials = safeName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase();

    const pairs = [
        ['user-display-name', safeName],
        ['user-display-name-mobile', safeName],
        ['user-display-role', safeRole],
        ['user-display-avatar', initials],
        ['user-display-avatar-mobile', initials]
    ];

    pairs.forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
}

// ==========================================
// Single-page navigation
// ==========================================
function initNavigation() {
    const navButtons = document.querySelectorAll('.sidebar-nav-btn');
    navButtons.forEach(button => {
        button.addEventListener('click', () => switchView(button.dataset.view, true));
    });

    document.querySelectorAll('[data-jump-view]').forEach(button => {
        button.addEventListener('click', () => switchView(button.dataset.jumpView, true));
    });

    switchView('overview', false);
}

function switchView(view, shouldScroll) {
    if (!VIEW_LABELS[view]) return;
    currentView = view;

    document.querySelectorAll('[data-view-panel]').forEach(panel => {
        const isActive = panel.dataset.viewPanel === view;
        panel.hidden = !isActive;
        panel.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.sidebar-nav-btn').forEach(button => {
        const isActive = button.dataset.view === view;
        button.classList.toggle('active', isActive);
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });

    const crumb = document.getElementById('page-crumb');
    if (crumb) crumb.textContent = VIEW_LABELS[view];

    requestAnimationFrame(() => {
        emissionsChart?.resize();
        historyChart?.resize();
        monthlyChart?.resize();
    });

    if (shouldScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// Unified calculator
// ==========================================
function initCalculator() {
    const sliders = [
        document.getElementById('inp-clinker'),
        document.getElementById('inp-coal'),
        document.getElementById('inp-altfuel'),
        document.getElementById('inp-output'),
        document.getElementById('inp-mwh'),
        document.getElementById('inp-renew'),
        document.getElementById('inp-gridfactor')
    ].filter(Boolean);

    sliders.forEach(slider => {
        slider.addEventListener('input', calculateLocally);
    });

    document.querySelectorAll('[data-reset]').forEach(button => {
        button.addEventListener('click', () => resetCalculator(button.dataset.reset));
    });

    [document.getElementById('cement-suggestions-list'), document.getElementById('electricity-suggestions-list')]
        .filter(Boolean)
        .forEach(list => list.addEventListener('click', handleSuggestionAction));

    document.querySelectorAll('[data-save-scenario]').forEach(button => {
        button.addEventListener('click', () => saveScenario(button));
    });

    calculateLocally();
}

function readInputs() {
    return {
        clinker: numberValue(document.getElementById('inp-clinker')?.value, DEFAULTS.clinker),
        coal: numberValue(document.getElementById('inp-coal')?.value, DEFAULTS.coal),
        altfuel: numberValue(document.getElementById('inp-altfuel')?.value, DEFAULTS.altfuel),
        output: numberValue(document.getElementById('inp-output')?.value, DEFAULTS.output),
        mwh: numberValue(document.getElementById('inp-mwh')?.value, DEFAULTS.mwh),
        renew: numberValue(document.getElementById('inp-renew')?.value, DEFAULTS.renew),
        grid: numberValue(document.getElementById('inp-gridfactor')?.value, DEFAULTS.grid)
    };
}

function calculateLocally() {
    currentInputs = readInputs();
    updateInputLabels(currentInputs);
    latestResult = inferLocally(currentInputs);
    renderOutputs(latestResult, currentInputs);
}

function inferLocally(inputs) {
    const specificCoal = (inputs.coal * 1000) / inputs.output;
    const kwhPerTon = (inputs.mwh * 1000) / inputs.output;

    const predictedCement = Math.max(0,
        -771.4926
        + (538.4852 * inputs.clinker)
        + (23.5568 * inputs.coal)
        - (0.4235 * inputs.altfuel)
        + (0.7365 * inputs.output)
        + (2.3345 * specificCoal)
    );

    const predictedElectricity = Math.max(0,
        -48.9928
        + (0.6537 * inputs.mwh)
        - (0.8183 * inputs.renew)
        + (97.0 * inputs.grid)
        - (0.0063 * inputs.output)
        - (0.0607 * kwhPerTon)
    );

    const cementIntensity = predictedCement / inputs.output;
    const cementSaved = Math.max(0, 731.9 - predictedCement);
    const electricitySaved = Math.max(0, inputs.mwh * inputs.grid - predictedElectricity);
    const combined = predictedCement + predictedElectricity;

    return {
        predicted_cement_co2: predictedCement,
        cement_intensity: cementIntensity,
        cement_saved: cementSaved,
        predicted_elec_co2: predictedElectricity,
        specific_power_kwh: kwhPerTon,
        elec_saved: electricitySaved,
        combined_total_co2: combined,
        total_abatement_saved: cementSaved + electricitySaved
    };
}

function updateInputLabels(inputs) {
    setLabel('lbl-clinker', inputs.clinker.toFixed(3));
    setLabel('lbl-coal', `${inputs.coal.toFixed(1)} <small>tons</small>`);
    setLabel('lbl-altfuel', `${inputs.altfuel.toFixed(1)} <small>%</small>`);
    setLabel('lbl-output', `${Math.round(inputs.output).toLocaleString('en-US')} <small>tons</small>`);
    setLabel('lbl-mwh', `${inputs.mwh.toFixed(1)} <small>MWh</small>`);
    setLabel('lbl-renew', `${inputs.renew.toFixed(1)} <small>%</small>`);
    setLabel('lbl-gridfactor', `${inputs.grid.toFixed(3)} <small>t/MWh</small>`);

    document.querySelectorAll('input[type="range"]').forEach(updateRangeProgress);
}

function renderOutputs(data, inputs) {
    const cement = numberValue(data.predicted_cement_co2);
    const electricity = numberValue(data.predicted_elec_co2);
    const combined = numberValue(data.combined_total_co2, cement + electricity);
    const cementIntensity = numberValue(data.cement_intensity);
    const cementSaved = numberValue(data.cement_saved);
    const electricitySaved = numberValue(data.elec_saved);
    const totalSaved = numberValue(data.total_abatement_saved, cementSaved + electricitySaved);
    const kwhPerTon = numberValue(data.specific_power_kwh);
    const total = Math.max(combined, 0.001);
    const cementShare = (cement / total) * 100;
    const electricityShare = 100 - cementShare;

    setHtml('kpi-combined-co2', `${formatNumber(combined)} <small>tCO₂</small>`);
    setHtml('kpi-cement-co2', `${formatNumber(cement)} <small>tCO₂</small>`);
    setHtml('kpi-elec-co2', `${formatNumber(electricity)} <small>tCO₂</small>`);
    setHtml('kpi-abatement-total', `${formatNumber(totalSaved)} <small>tCO₂</small>`);

    setText('overview-combined-share', 'Cement and electricity combined');
    setText('overview-cement-share', `${cementShare.toFixed(1)}% of total emissions`);
    setText('overview-elec-share', `${electricityShare.toFixed(1)}% of total emissions`);
    setText('donut-total-value', formatNumber(combined));
    setText('donut-cement-percent', `${cementShare.toFixed(0)}%`);
    setText('donut-elec-percent', `${electricityShare.toFixed(0)}%`);

    setHtml('out-cement-co2', `${formatNumber(cement)} <small>tCO₂</small>`);
    setText('out-cement-intensity', `${cementIntensity.toFixed(3)} tCO₂/t`);
    setText('out-cement-saved', `${formatNumber(cementSaved)} t`);
    setText('cement-production-result', `${Math.round(inputs.output).toLocaleString('en-US')} t`);
    setWidth('cement-intensity-bar', clamp(((cementIntensity - 0.55) / 0.45) * 100, 3, 100));

    setHtml('out-elec-co2', `${formatNumber(electricity)} <small>tCO₂</small>`);
    setText('out-elec-kwh', `${kwhPerTon.toFixed(1)} kWh/t`);
    setText('out-elec-saved', `${formatNumber(electricitySaved)} t`);
    setText('electricity-renew-result', `${inputs.renew.toFixed(1)} %`);
    setText('electricity-production-context', `${Math.round(inputs.output).toLocaleString('en-US')} tons cement`);
    setWidth('electricity-intensity-bar', clamp(((kwhPerTon - 100) / 40) * 100, 3, 100));

    setText('overview-flow-cement-input', `${inputs.clinker.toFixed(3)} clinker · ${inputs.coal.toFixed(1)} t coal`);
    setText('overview-flow-power-input', `${inputs.mwh.toFixed(1)} MWh · ${inputs.renew.toFixed(1)}% clean`);
    setText('overview-flow-cement-output', `${formatNumber(cement)} tCO₂`);
    setText('overview-flow-power-output', `${formatNumber(electricity)} tCO₂`);

    setText('cement-flow-clinker', `${inputs.clinker.toFixed(3)} clinker factor`);
    setText('cement-flow-fuel', `${inputs.coal.toFixed(1)} t coal · ${inputs.altfuel.toFixed(1)}% alt fuel`);
    setText('cement-flow-output', `${formatNumber(cement)} tCO₂`);
    setText('electricity-flow-demand', `${inputs.mwh.toFixed(1)} MWh`);
    setText('electricity-flow-renew', `${inputs.renew.toFixed(1)}% renewable`);
    setText('electricity-flow-grid', `${inputs.grid.toFixed(3)} tCO₂/MWh`);
    setText('electricity-flow-output', `${formatNumber(electricity)} tCO₂`);

    renderCementSuggestions(inputs);
    renderElectricitySuggestions(inputs);
    updateDonut(cementShare);
}

function buildCementSuggestions(inputs) {
    const clinkerTarget = 0.68;
    const coalTarget = 11;

    if (inputs.clinker > 0.72) {
        return {
            title: 'Lower the clinker factor',
            description: `Move from ${inputs.clinker.toFixed(3)} to 0.680 with blended cement or slag.`,
            impact: `~${formatNumber((inputs.clinker - clinkerTarget) * 538.4852)} t`,
            icon: 'fa-cubes',
            action: { input: 'inp-clinker', value: clinkerTarget, label: 'Use 0.680' }
        };
    }

    return {
        title: 'Clinker target is on track',
        description: `Current factor ${inputs.clinker.toFixed(3)} is at or below the 0.720 action threshold.`,
        impact: 'On target',
        icon: 'fa-circle-check',
        positive: true
    };
}

function buildFuelSuggestion(inputs) {
    const fuelTarget = 30;
    if (inputs.altfuel < fuelTarget) {
        return {
            title: 'Increase alternative fuel',
            description: `Raise the current ${inputs.altfuel.toFixed(1)}% to 30% with RDF or biomass.`,
            impact: `~${formatNumber((fuelTarget - inputs.altfuel) * 0.4235)} t`,
            icon: 'fa-recycle',
            action: { input: 'inp-altfuel', value: fuelTarget, label: 'Use 30%' }
        };
    }

    return {
        title: 'Alternative fuel is on track',
        description: `${inputs.altfuel.toFixed(1)}% of kiln heat is already coming from lower-carbon fuels.`,
        impact: 'On target',
        icon: 'fa-circle-check',
        positive: true
    };
}

function buildCoalSuggestion(inputs) {
    if (inputs.coal > 12.5) {
        return {
            title: 'Tighten the kiln heat balance',
            description: 'Test 11.0 tons of coal while protecting clinker quality and output.',
            impact: `~${formatNumber((inputs.coal - coalTarget) * 23.5568)} t`,
            icon: 'fa-fire-flame-curved',
            action: { input: 'inp-coal', value: coalTarget, label: 'Use 11 t' }
        };
    }

    return {
        title: 'Fuel use is well controlled',
        description: `${inputs.coal.toFixed(1)} tons of coal is at or below the current plant scenario.`,
        impact: 'On target',
        icon: 'fa-circle-check',
        positive: true
    };
}

function buildRenewableSuggestion(inputs) {
    if (inputs.renew < 50) {
        return {
            title: 'Grow renewable power supply',
            description: `Increase clean power from ${inputs.renew.toFixed(1)}% to a 50% plant target.`,
            impact: `~${formatNumber((50 - inputs.renew) * 0.8183)} t`,
            icon: 'fa-solar-panel',
            action: { input: 'inp-renew', value: 50, label: 'Use 50%' }
        };
    }

    return {
        title: 'Renewable supply is on track',
        description: `${inputs.renew.toFixed(1)}% of power is already covered by renewable supply.`,
        impact: 'On target',
        icon: 'fa-circle-check',
        positive: true
    };
}

function buildEfficiencySuggestion(inputs) {
    const targetMwh = Math.round(clamp(inputs.output * 0.1, 70, 180));
    const kwhPerTon = (inputs.mwh * 1000) / inputs.output;

    if (kwhPerTon > 100) {
        return {
            title: 'Reduce power per ton',
            description: `Test ${targetMwh} MWh to reach the 100 kWh/t plant benchmark.`,
            impact: `~${formatNumber((inputs.mwh - targetMwh) * 0.6537)} t`,
            icon: 'fa-gauge-high',
            action: { input: 'inp-mwh', value: targetMwh, label: 'Use target' }
        };
    }

    return {
        title: 'Power intensity is on track',
        description: `${kwhPerTon.toFixed(1)} kWh/t is at or below the 100 kWh/t benchmark.`,
        impact: 'On target',
        icon: 'fa-circle-check',
        positive: true
    };
}

function buildGridSuggestion(inputs) {
    if (inputs.grid > 0.55) {
        return {
            title: 'Choose a cleaner grid mix',
            description: `Model a 0.550 tCO₂/MWh supplier or certificate-backed contract.`,
            impact: `~${formatNumber((inputs.grid - 0.55) * 97)} t`,
            icon: 'fa-tower-broadcast',
            action: { input: 'inp-gridfactor', value: 0.55, label: 'Use 0.550' }
        };
    }

    return {
        title: 'Grid intensity is on track',
        description: `${inputs.grid.toFixed(3)} tCO₂/MWh is at or below the cleaner-power target.`,
        impact: 'On target',
        icon: 'fa-circle-check',
        positive: true
    };
}

function renderCementSuggestions(inputs) {
    renderSuggestions(
        document.getElementById('cement-suggestions-list'),
        [buildCementSuggestions(inputs), buildFuelSuggestion(inputs), buildCoalSuggestion(inputs)]
    );
}

function renderElectricitySuggestions(inputs) {
    renderSuggestions(
        document.getElementById('electricity-suggestions-list'),
        [buildRenewableSuggestion(inputs), buildEfficiencySuggestion(inputs), buildGridSuggestion(inputs)]
    );
}

function renderSuggestions(container, suggestions) {
    if (!container) return;
    container.innerHTML = suggestions.map(item => {
        const action = item.action
            ? `<button type="button" class="suggestion-action" data-apply-input="${item.action.input}" data-target-value="${item.action.value}">${item.action.label}</button>`
            : `<span class="suggestion-target"><i class="fa-solid fa-check"></i>${item.impact}</span>`;

        return `
            <article class="suggestion-item">
                <span class="suggestion-icon"><i class="fa-solid ${item.icon}"></i></span>
                <div class="suggestion-copy">
                    <strong>${item.title}</strong>
                    <span>${item.description}</span>
                </div>
                <div class="suggestion-impact">
                    <strong>${item.impact}</strong>
                    ${action}
                </div>
            </article>
        `;
    }).join('');
}

function handleSuggestionAction(event) {
    const button = event.target.closest('[data-apply-input]');
    if (!button) return;

    const input = document.getElementById(button.dataset.applyInput);
    if (!input) return;

    const min = numberValue(input.min);
    const max = numberValue(input.max);
    const step = numberValue(input.step, 1) || 1;
    const requested = numberValue(button.dataset.targetValue);
    const stepped = Math.round(requested / step) * step;
    input.value = String(clamp(stepped, min, max));
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const label = input.closest('.control-group')?.querySelector('label')?.textContent || 'Input';
    showToast('Reduction target applied', `${label} was updated and the outputs recalculated.`);
}

function resetCalculator(section) {
    if (section === 'cement') {
        setInputValue('inp-clinker', DEFAULTS.clinker);
        setInputValue('inp-coal', DEFAULTS.coal);
        setInputValue('inp-altfuel', DEFAULTS.altfuel);
        setInputValue('inp-output', DEFAULTS.output);
    } else if (section === 'electricity') {
        setInputValue('inp-mwh', DEFAULTS.mwh);
        setInputValue('inp-renew', DEFAULTS.renew);
        setInputValue('inp-gridfactor', DEFAULTS.grid);
    }
    calculateLocally();
}

async function saveScenario(button) {
    if (!button || button.disabled) return;
    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…';

    const inputs = { ...currentInputs };
    try {
        const response = await fetch('/api/predict/unified', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clinker_factor: inputs.clinker,
                coal_consumed_tons: inputs.coal,
                alternative_fuel_pct: inputs.altfuel,
                cement_produced_tons: inputs.output,
                electricity_mwh: inputs.mwh,
                renewable_share_pct: inputs.renew,
                grid_emission_factor: inputs.grid
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || data.message || 'The scenario could not be saved.');

        latestResult = data;
        renderOutputs(data, inputs);
        showToast('Scenario saved', 'The inputs and model output were added to your recent calculations.');
        loadDbHistory();
    } catch (error) {
        showToast('Could not save scenario', error.message || 'Check the server connection and try again.', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

// ==========================================
// Data and charts
// ==========================================
async function loadInitialData() {
    try {
        let response = await fetch('/api/data');
        if (!response.ok) response = await fetch('/model_results.json');
        appData = await response.json();
    } catch (error) {
        appData = { daily_timeline: [], monthly_summary: [] };
    }

    prepareHistoricalLookups();
    renderHistoryTable(appData.daily_timeline || []);
    initCharts();
    renderHistoryChart();
    renderMonthlyOverview();
    renderModelAccuracy();
}

function prepareHistoricalLookups() {
    cementLookup = new Map();
    electricityLookup = new Map();
    const cementBatches = appData?.cement?.batches || [];
    const electricityRecords = appData?.electricity?.records || [];

    cementBatches.forEach(record => cementLookup.set(record.Batch_ID, record));
    electricityRecords.forEach(record => electricityLookup.set(record.Batch_ID, record));
}

function initCharts() {
    if (!window.Chart) return;
    window.Chart.defaults.font.family = 'Manrope, sans-serif';
    window.Chart.defaults.color = '#78857f';

    const donutCanvas = document.getElementById('emissions-donut');
    if (donutCanvas && !emissionsChart) {
        emissionsChart = new window.Chart(donutCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Cement', 'Electricity'],
                datasets: [{
                    data: [91, 9],
                    backgroundColor: ['#d97706', '#2878d0'],
                    borderWidth: 0,
                    hoverOffset: 0,
                    borderRadius: 4,
                    spacing: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '76%',
                rotation: -90,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                animation: { duration: 380 }
            }
        });
    }
}

function updateDonut(cementShare) {
    const electricityShare = Math.max(0, 100 - cementShare);
    if (emissionsChart) {
        emissionsChart.data.datasets[0].data = [cementShare, electricityShare];
        emissionsChart.update();
    }

    const wrap = document.getElementById('donut-wrap');
    if (wrap) {
        wrap.style.background = `conic-gradient(var(--cement) 0 ${cementShare}%, var(--power) ${cementShare}% 100%)`;
    }
}

function renderHistoryChart() {
    const timeline = appData?.daily_timeline || [];
    const rangeSelect = document.getElementById('history-range');
    const requestedRange = Number(rangeSelect?.value || 50);
    const rows = timeline.slice(-requestedRange);
    const rangeLabel = document.getElementById('history-range-label');
    if (rangeLabel) rangeLabel.textContent = `${rows.length} ${rows.length === 1 ? 'batch' : 'batches'}`;

    if (!window.Chart) return;
    historyChart?.destroy();

    const canvas = document.getElementById('chart-daily-mini');
    if (!canvas || !rows.length) return;

    historyChart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: rows.map(row => formatChartDate(row.Date)),
            datasets: [
                {
                    label: 'Cement CO₂',
                    data: rows.map(row => numberValue(row.Cement_CO2_Actual)),
                    borderColor: '#d97706',
                    backgroundColor: 'rgba(217, 119, 6, 0.055)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#d97706'
                },
                {
                    label: 'Electricity CO₂',
                    data: rows.map(row => numberValue(row.Elec_CO2_Actual)),
                    borderColor: '#2878d0',
                    backgroundColor: 'rgba(40, 120, 208, 0.035)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#2878d0'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    backgroundColor: '#17211c',
                    titleColor: '#ffffff',
                    bodyColor: '#dce6e0',
                    padding: 11,
                    cornerRadius: 9,
                    callbacks: {
                        label: context => `${context.dataset.label}: ${formatNumber(context.parsed.y)} tCO₂`
                    }
                }
            },
            scales: {
                x: {
                    border: { display: false },
                    grid: { display: false },
                    ticks: {
                        color: '#98a39d',
                        font: { size: 8, weight: 600 },
                        maxRotation: 0,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: '#edf1ee', drawTicks: false },
                    ticks: {
                        color: '#98a39d',
                        font: { size: 8, weight: 600 },
                        padding: 8,
                        callback: value => `${value} t`
                    }
                }
            }
        }
    });
}

function renderMonthlyOverview() {
    const monthly = getMonthlySummary();
    const summaryList = document.getElementById('monthly-summary-list');
    if (!summaryList) return;

    if (!monthly.length) {
        summaryList.innerHTML = '<div class="table-empty">No monthly release data is available.</div>';
        setText('monthly-latest-label', 'Latest month');
        setHtml('monthly-latest-total', '— <small>tCO₂</small>');
        setText('monthly-latest-days', '—');
        setText('monthly-change', '—');
        monthlyChart?.destroy();
        monthlyChart = null;
        return;
    }

    const ordered = [...monthly].sort((a, b) => String(a.Month).localeCompare(String(b.Month)));
    const latest = ordered[ordered.length - 1];
    const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
    const latestTotal = numberValue(latest.Combined_CO2_Tons);
    const previousTotal = previous ? numberValue(previous.Combined_CO2_Tons) : null;
    const change = previousTotal ? ((latestTotal - previousTotal) / previousTotal) * 100 : null;

    setText('monthly-latest-label', formatMonthLabel(latest.Month));
    setHtml('monthly-latest-total', `${formatNumber(latestTotal)} <small>tCO₂</small>`);
    setText('monthly-latest-days', `${numberValue(latest.Days_Count)} recorded days`);

    const changeElement = document.getElementById('monthly-change');
    if (changeElement) {
        changeElement.classList.toggle('is-up', change !== null && change > 0);
        changeElement.textContent = change === null
            ? 'First recorded month'
            : `${change <= 0 ? '↓' : '↑'} ${Math.abs(change).toFixed(1)}% vs ${formatMonthLabel(previous.Month)}`;
    }

    summaryList.innerHTML = [...ordered].reverse().map(month => `
        <article class="monthly-summary-item">
            <div class="monthly-summary-top">
                <strong>${escapeHtml(formatMonthLabel(month.Month))}</strong>
                <span>${numberValue(month.Days_Count)} days</span>
            </div>
            <div class="monthly-summary-total">${formatNumber(month.Combined_CO2_Tons)} <small>tCO₂</small></div>
            <div class="monthly-summary-split">
                <span><i class="cement"></i> Cement ${formatNumber(month.Cement_CO2_Tons)} t</span>
                <span><i class="power"></i> Power ${formatNumber(month.Elec_CO2_Tons)} t</span>
            </div>
            <div class="monthly-summary-meta">${formatNumber(month.Cement_Produced_Tons)} t cement produced · ${formatNumber(month.Electricity_MWh)} MWh used</div>
        </article>
    `).join('');

    if (!window.Chart) return;
    monthlyChart?.destroy();

    const canvas = document.getElementById('monthly-co2-chart');
    if (!canvas) return;

    monthlyChart = new window.Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ordered.map(month => formatMonthLabel(month.Month)),
            datasets: [
                {
                    label: 'Cement CO₂',
                    data: ordered.map(month => numberValue(month.Cement_CO2_Tons)),
                    backgroundColor: '#d97706',
                    borderRadius: 5,
                    borderSkipped: false,
                    maxBarThickness: 54
                },
                {
                    label: 'Electricity CO₂',
                    data: ordered.map(month => numberValue(month.Elec_CO2_Tons)),
                    backgroundColor: '#2878d0',
                    borderRadius: 5,
                    borderSkipped: false,
                    maxBarThickness: 54
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: true,
                    backgroundColor: '#17211c',
                    titleColor: '#ffffff',
                    bodyColor: '#dce6e0',
                    padding: 11,
                    cornerRadius: 9,
                    callbacks: {
                        label: context => `${context.dataset.label}: ${formatNumber(context.parsed.y)} tCO₂`,
                        footer: items => {
                            const total = items.reduce((sum, item) => sum + item.parsed.y, 0);
                            return `Total: ${formatNumber(total)} tCO₂`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    border: { display: false },
                    grid: { display: false },
                    ticks: {
                        color: '#78857f',
                        font: { size: 8, weight: 700 }
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: '#edf1ee', drawTicks: false },
                    ticks: {
                        color: '#98a39d',
                        font: { size: 8, weight: 600 },
                        padding: 8,
                        callback: value => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value
                    }
                }
            }
        }
    });
}

function getMonthlySummary() {
    if (Array.isArray(appData?.monthly_summary) && appData.monthly_summary.length) {
        return appData.monthly_summary;
    }

    const grouped = new Map();
    (appData?.daily_timeline || []).forEach(row => {
        const month = row.Month || String(row.Date || '').slice(0, 7);
        if (!month) return;
        if (!grouped.has(month)) {
            grouped.set(month, {
                Month: month,
                Days_Count: 0,
                Cement_Produced_Tons: 0,
                Cement_CO2_Tons: 0,
                Electricity_MWh: 0,
                Elec_CO2_Tons: 0,
                Combined_CO2_Tons: 0
            });
        }
        const summary = grouped.get(month);
        summary.Days_Count += 1;
        summary.Cement_Produced_Tons += numberValue(row.Cement_Output_Tons);
        summary.Cement_CO2_Tons += numberValue(row.Cement_CO2_Actual);
        summary.Electricity_MWh += numberValue(row.Electricity_MWh);
        summary.Elec_CO2_Tons += numberValue(row.Elec_CO2_Actual);
        summary.Combined_CO2_Tons += numberValue(row.Combined_Total_CO2_Actual);
    });

    return [...grouped.values()];
}

function renderModelAccuracy() {
    const cementTotal = appData?.cement?.results_total?.['Linear Regression'];
    const cementIntensity = appData?.cement?.results_intensity?.['Linear Regression'];
    const electricity = appData?.electricity?.results_elec?.['Linear Regression'];

    const metrics = [
        { key: 'cement', data: cementTotal, prefix: '' },
        { key: 'intensity', data: cementIntensity, prefix: '' },
        { key: 'electricity', data: electricity, prefix: '' }
    ];
    const available = metrics.filter(metric => numberValue(metric.data?.R2_Test, -1) >= 0);

    if (!available.length) {
        ['accuracy-overall', 'accuracy-cement-r2', 'accuracy-intensity-r2', 'accuracy-electricity-r2'].forEach(id => setText(id, '—'));
        setWidth('accuracy-meter-fill', 0);
        return;
    }

    const overall = available.reduce((sum, metric) => sum + numberValue(metric.data.R2_Test), 0) / available.length;
    setText('accuracy-overall', `${(overall * 100).toFixed(1)}%`);
    setWidth('accuracy-meter-fill', overall * 100);

    setText('accuracy-cement-r2', `${(numberValue(cementTotal?.R2_Test) * 100).toFixed(1)}%`);
    setText('accuracy-cement-detail', `RMSE ${formatNumber(cementTotal?.RMSE)} t · MAE ${formatNumber(cementTotal?.MAE)} t`);

    setText('accuracy-intensity-r2', `${(numberValue(cementIntensity?.R2_Test) * 100).toFixed(1)}%`);
    setText('accuracy-intensity-detail', `RMSE ${numberValue(cementIntensity?.RMSE).toFixed(3)} · MAE ${numberValue(cementIntensity?.MAE).toFixed(3)}`);

    setText('accuracy-electricity-r2', `${(numberValue(electricity?.R2_Test) * 100).toFixed(1)}%`);
    setText('accuracy-electricity-detail', `RMSE ${formatNumber(electricity?.RMSE)} t · MAE ${formatNumber(electricity?.MAE)} t`);
}

function renderHistoryTable(timeline) {
    const tbody = document.getElementById('daily-ledger-tbody');
    if (!tbody) return;

    const rows = [...(timeline || [])].reverse();
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No historical batches are available.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(row => {
        const cementInput = cementLookup.get(row.Batch_ID);
        const electricityInput = electricityLookup.get(row.Batch_ID);
        const inputSummary = cementInput
            ? `${cementInput.Clinker_Factor.toFixed(3)} clinker · ${cementInput.Coal_Consumed_Tons.toFixed(1)} t`
            : 'Input mix unavailable';
        const powerSummary = electricityInput
            ? `${electricityInput.Electricity_MWh.toFixed(1)} MWh · ${electricityInput.Renewable_Share_Pct.toFixed(1)}% RE`
            : `${formatNumber(row.Electricity_MWh)} MWh`;

        return `
            <tr>
                <td class="table-batch">
                    <strong>${escapeHtml(row.Batch_ID)}</strong>
                    <small>${escapeHtml(row.Date)}</small>
                </td>
                <td class="table-input">
                    <strong>${escapeHtml(inputSummary)}</strong>
                    <small>${escapeHtml(powerSummary)}</small>
                </td>
                <td class="table-cement">${formatNumber(row.Cement_CO2_Actual)} t</td>
                <td class="table-power">${formatNumber(row.Elec_CO2_Actual)} t</td>
                <td class="table-total">${formatNumber(row.Combined_Total_CO2_Actual)} t</td>
            </tr>
        `;
    }).join('');
}

function buildHistoryExportRows() {
    return (appData?.daily_timeline || []).map(row => {
        const cementInput = cementLookup.get(row.Batch_ID);
        const electricityInput = electricityLookup.get(row.Batch_ID);

        return {
            'Batch ID': row.Batch_ID || '',
            'Date': row.Date || '',
            'Clinker factor': cementInput ? numberValue(cementInput.Clinker_Factor) : '',
            'Coal consumed (t)': cementInput ? numberValue(cementInput.Coal_Consumed_Tons) : '',
            'Alternative fuel (%)': cementInput ? numberValue(cementInput.Alternative_Fuel_Substitution_Pct) : '',
            'Cement produced (t)': numberValue(row.Cement_Output_Tons),
            'Electricity (MWh)': electricityInput ? numberValue(electricityInput.Electricity_MWh) : numberValue(row.Electricity_MWh),
            'Renewable share (%)': electricityInput ? numberValue(electricityInput.Renewable_Share_Pct) : '',
            'Grid factor (tCO₂/MWh)': electricityInput ? numberValue(electricityInput.Grid_Emission_Factor) : '',
            'Cement CO₂ (t)': numberValue(row.Cement_CO2_Actual),
            'Electricity CO₂ (t)': numberValue(row.Elec_CO2_Actual),
            'Total CO₂ (t)': numberValue(row.Combined_Total_CO2_Actual)
        };
    });
}

function downloadHistory(format = 'csv') {
    const rows = buildHistoryExportRows();
    if (!rows.length) {
        showToast('Nothing to download', 'There are no historical batches available yet.', 'error');
        return;
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    if (format === 'xlsx' && window.XLSX) {
        const worksheet = window.XLSX.utils.json_to_sheet(rows);
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Carbon history');
        window.XLSX.writeFile(workbook, `carboniq-history-${dateStamp}.xlsx`);
        showToast('History downloaded', `${rows.length} batches exported as an Excel workbook.`);
        return;
    }

    if (format === 'xlsx' && !window.XLSX) {
        showToast('Excel export unavailable', 'Downloading the same history as CSV instead.');
    }

    const headers = Object.keys(rows[0]);
    const escapeCsv = value => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [
        headers.map(escapeCsv).join(','),
        ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(','))
    ].join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `carboniq-history-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (format !== 'xlsx') showToast('History downloaded', `${rows.length} batches exported as CSV.`);
}

function initHistoryControls() {
    const rangeSelect = document.getElementById('history-range');
    rangeSelect?.addEventListener('change', renderHistoryChart);

    const searchInput = document.getElementById('daily-ledger-search');
    searchInput?.addEventListener('input', event => {
        const query = event.target.value.trim().toLowerCase();
        const timeline = appData?.daily_timeline || [];
        const filtered = query
            ? timeline.filter(row => `${row.Batch_ID} ${row.Date}`.toLowerCase().includes(query))
            : timeline;
        renderHistoryTable(filtered);
    });

    document.getElementById('refresh-history-btn')?.addEventListener('click', loadDbHistory);
    document.getElementById('download-csv-btn')?.addEventListener('click', () => downloadHistory('csv'));
    document.getElementById('download-xlsx-btn')?.addEventListener('click', () => downloadHistory('xlsx'));
}

// ==========================================
// Saved calculation history
// ==========================================
async function loadDbHistory() {
    const container = document.getElementById('db-history-list');
    if (!container) return;

    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error('History unavailable');
        const history = await response.json();
        if (!history.length) {
            container.innerHTML = '<div class="table-empty">No saved calculations yet.</div>';
            return;
        }

        container.innerHTML = history.slice(0, 7).map(record => `
            <article class="saved-item">
                <div class="saved-item-top">
                    <div class="saved-item-user">
                        <span>${escapeHtml(initials(record.username))}</span>
                        <strong>${escapeHtml(record.username || 'Operator')}</strong>
                    </div>
                    <time>${escapeHtml(formatHistoryTime(record.created_at))}</time>
                </div>
                <div class="saved-item-summary" title="${escapeHtml(record.input_summary || '')}">${escapeHtml(record.input_summary || 'Unified plant scenario')}</div>
                <div class="saved-item-metrics">
                    <span>Total<strong>${formatNumber(record.predicted_co2)} t</strong></span>
                    <span>Avoided<strong>${formatNumber(record.abatement_saved)} t</strong></span>
                </div>
            </article>
        `).join('');
    } catch (error) {
        container.innerHTML = '<div class="table-empty">Saved calculations are temporarily unavailable.</div>';
    }
}

// ==========================================
// Shared UI helpers
// ==========================================
function showToast(title, message, type = 'success') {
    const toast = document.getElementById('db-log-toast');
    if (!toast) return;
    clearTimeout(toastTimer);

    const titleElement = toast.querySelector('strong');
    const messageElement = document.getElementById('toast-message');
    const iconElement = toast.querySelector('.toast-icon i');
    titleElement.textContent = title;
    messageElement.textContent = message;
    toast.classList.toggle('error', type === 'error');
    iconElement.className = type === 'error' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-check';
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4300);
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = String(value);
}

function updateRangeProgress(input) {
    const min = numberValue(input.min);
    const max = numberValue(input.max);
    const value = numberValue(input.value);
    const percentage = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty('--range-progress', `${clamp(percentage, 0, 100)}%`);
}

function setWidth(id, width) {
    const element = document.getElementById(id);
    if (element) element.style.width = `${clamp(width, 0, 100)}%`;
}

function setLabel(id, html) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
}

function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

function setHtml(id, html) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
}

function numberValue(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
    return numberValue(value).toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
}

function formatMonthLabel(value) {
    if (!value) return 'Unknown month';
    const match = String(value).match(/^(\d{4})-(\d{1,2})/);
    if (!match) return String(value);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
}

function formatChartDate(value) {
    if (!value) return '';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function formatHistoryTime(value) {
    if (!value) return 'Recently';
    const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }).format(date);
}

function initials(value) {
    return String(value || 'OP')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

document.getElementById('db-log-toast')?.querySelector('.toast-close')?.addEventListener('click', () => {
    document.getElementById('db-log-toast')?.classList.remove('show');
});
